'use strict';

const { pool } = require('../db');
const marketData = require('./marketData');

/**
 * In-memory quote cache — avoids burning Alpha Vantage's 25 req/day limit when
 * the user opens the page multiple times, and lets the US cron use stale ASX
 * quotes (and vice versa) without calling the wrong API.
 */
const quoteCache = new Map(); // key: `${symbol}:${exchange}` → { data, at }
const QUOTE_CACHE_USER_MS = 15 * 60 * 1000; // 15 min for user-facing requests

function num(v) {
  return Number(v) || 0;
}

/** Stored trade prices are AUD; legacy USD rows still use fxRateToAud */
function tradeProceedsAud(t) {
  const subtotal = num(t.quantity) * num(t.pricePerShare) + num(t.feesAud);
  if (t.currency === 'USD' && num(t.fxRateToAud) > 0) {
    return subtotal * num(t.fxRateToAud);
  }
  return subtotal;
}

/**
 * Process all trades in chronological order, computing:
 *  - open holdings (quantity > 0)
 *  - realized P&L for every sell (using average-cost method)
 */
function computeHoldingsAndRealized(trades) {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradedAt) - new Date(b.tradedAt) || a.id - b.id
  );
  const map = {};
  const realized = [];

  for (const t of sorted) {
    const key = `${t.symbol}:${t.exchange}`;
    if (!map[key]) {
      map[key] = { symbol: t.symbol, exchange: t.exchange, quantity: 0, costBasisAud: 0 };
    }
    const h = map[key];
    const qty = num(t.quantity);
    const priceAud = num(t.pricePerShare);
    const feesAud = num(t.feesAud);

    if (t.side === 'buy') {
      h.quantity += qty;
      h.costBasisAud += qty * priceAud + feesAud;
    } else {
      if (h.quantity <= 0) continue;
      const avg = h.costBasisAud / h.quantity;
      const sellQty = Math.min(qty, h.quantity);
      const costAud = avg * sellQty;
      // Sell proceeds: price × qty minus fees (fees reduce what you receive)
      const proceedsAud = sellQty * priceAud - feesAud;
      const pnlAud = proceedsAud - costAud;

      realized.push({
        tradeId: t.id,
        symbol: t.symbol,
        exchange: t.exchange,
        quantity: sellQty,
        sellPriceAud: priceAud,
        avgCostAud: avg,
        proceedsAud,
        costAud,
        pnlAud,
        pnlPct: costAud > 0 ? (pnlAud / costAud) * 100 : null,
        tradedAt: t.tradedAt,
      });

      h.costBasisAud -= costAud;
      h.quantity -= sellQty;
      if (h.quantity < 1e-8) {
        h.quantity = 0;
        h.costBasisAud = 0;
      }
    }
  }

  return {
    holdings: Object.values(map).filter((h) => h.quantity > 0),
    realized,
  };
}

/** Convenience wrapper — returns open holdings only (used by cron + chart). */
function computeHoldings(trades) {
  return computeHoldingsAndRealized(trades).holdings;
}

function computeCashFromActivity(trades, ledgerRows) {
  let cash = 0;
  for (const row of ledgerRows) {
    const amt = num(row.amountAud);
    cash += row.type === 'deposit' ? amt : -amt;
  }
  for (const t of trades) {
    const aud = tradeProceedsAud(t);
    if (t.side === 'buy') cash -= aud;
    else cash += aud;
  }
  return cash;
}

/**
 * Fetch quotes for a list of holdings.
 *
 * @param {Array}    holdings       - from computeHoldings()
 * @param {string[]|null} exchangeFilter - if set, only fetch fresh prices for
 *   these exchanges (e.g. ['ASX'] for the ASX cron run); stale cache is used
 *   for all other exchanges so we don't burn the wrong API's quota.
 *   Pass null for user-facing calls — all exchanges are refreshed but a 15-min
 *   cache prevents hammering Alpha Vantage on repeated page loads.
 */
async function fetchQuotesForHoldings(holdings, exchangeFilter = null) {
  if (holdings.length === 0) {
    return { quotes: {}, usdAud: null, quoteError: null };
  }
  let usdAud;
  try {
    usdAud = await marketData.getUsdToAudRate();
  } catch (err) {
    return { quotes: {}, usdAud: null, quoteError: err.message };
  }

  const quotes = {};
  const errors = [];

  for (const h of holdings) {
    const key = `${h.symbol}:${h.exchange}`;
    const ex = marketData.normalizeExchange(h.exchange);
    const inFilter = !exchangeFilter || exchangeFilter.includes(ex);

    if (!inFilter) {
      // Not being polled this run — use whatever is in cache (may be stale)
      const cached = quoteCache.get(key);
      if (cached) quotes[key] = cached.data;
      continue;
    }

    // For user-facing requests (no filter) honour a 15-min cache to avoid
    // burning Alpha Vantage's 25-req/day limit on repeated page loads.
    if (!exchangeFilter) {
      const cached = quoteCache.get(key);
      if (cached && Date.now() - cached.at < QUOTE_CACHE_USER_MS) {
        quotes[key] = cached.data;
        continue;
      }
    }

    try {
      const q = await marketData.getQuote(h.symbol, h.exchange);
      const priceAud = marketData.priceToAud(q.current, q.currency, usdAud);
      const prevAud = marketData.priceToAud(q.previousClose, q.currency, usdAud);
      const qdata = {
        priceAud,
        previousCloseAud: prevAud,
        dayChangePct: prevAud > 0 ? ((priceAud - prevAud) / prevAud) * 100 : 0,
        nativePrice: q.current,
        currency: q.currency,
        source: q.source,
      };
      quotes[key] = qdata;
      quoteCache.set(key, { data: qdata, at: Date.now() });
    } catch (err) {
      errors.push(`${h.symbol} (${h.exchange}): ${err.message}`);
      // Fall back to stale cache rather than leaving the position priceless
      const cached = quoteCache.get(key);
      if (cached) quotes[key] = cached.data;
    }
  }

  return {
    quotes,
    usdAud,
    quoteError: errors.length ? errors.join(' · ') : null,
  };
}

async function getTradesAndLedger(userId) {
  const [tradesRes, ledgerRes] = await Promise.all([
    pool.query(
      `SELECT * FROM share_trades WHERE "userId"=$1 ORDER BY "tradedAt" DESC, id DESC`,
      [userId]
    ),
    pool.query(
      `SELECT * FROM share_cash_ledger WHERE "userId"=$1 ORDER BY "createdAt" DESC, id DESC`,
      [userId]
    ),
  ]);
  return { trades: tradesRes.rows, ledger: ledgerRes.rows };
}

async function buildDashboard(userId, exchangeFilter = null) {
  const { trades, ledger } = await getTradesAndLedger(userId);
  const { holdings, realized } = computeHoldingsAndRealized(trades);
  const cashAud = computeCashFromActivity(trades, ledger);
  const { quotes, usdAud, quoteError } = await fetchQuotesForHoldings(holdings, exchangeFilter);

  let holdingsValueAud = 0;
  let costBasisAud = 0;
  const positions = holdings.map((h) => {
    const key = `${h.symbol}:${h.exchange}`;
    const q = quotes[key];
    const qty = num(h.quantity);
    const cost = num(h.costBasisAud);
    costBasisAud += cost;
    const priceAud = q?.priceAud ?? null;
    const valueAud = priceAud != null ? qty * priceAud : null;
    if (valueAud != null) holdingsValueAud += valueAud;
    const pnlAud = valueAud != null ? valueAud - cost : null;
    const pnlPct = cost > 0 && pnlAud != null ? (pnlAud / cost) * 100 : null;
    return {
      symbol: h.symbol,
      exchange: h.exchange,
      quantity: qty,
      costBasisAud: cost,
      avgCostAud: qty > 0 ? cost / qty : 0,
      priceAud,
      valueAud,
      pnlAud,
      pnlPct,
      dayChangePct: q?.dayChangePct ?? null,
    };
  });

  const totalValueAud = holdingsValueAud + cashAud;
  const unrealizedPnlAud = holdingsValueAud - costBasisAud;
  const unrealizedPnlPct = costBasisAud > 0 ? (unrealizedPnlAud / costBasisAud) * 100 : null;

  const totalRealizedPnlAud = realized.reduce((s, r) => s + r.pnlAud, 0);

  return {
    positions,
    realized: realized.sort((a, b) => new Date(b.tradedAt) - new Date(a.tradedAt)),
    cashAud,
    holdingsValueAud,
    totalValueAud,
    costBasisAud,
    unrealizedPnlAud: holdings.length ? unrealizedPnlAud : null,
    unrealizedPnlPct: holdings.length ? unrealizedPnlPct : null,
    totalRealizedPnlAud: realized.length ? totalRealizedPnlAud : null,
    usdAud,
    quoteError,
    quotesAvailable: marketData.canFetchQuotes(),
  };
}

async function recordSnapshots(userId, exchangeFilter = null) {
  const dash = await buildDashboard(userId, exchangeFilter);
  const now = new Date();
  await pool.query(
    `INSERT INTO share_portfolio_snapshots
      ("userId", "totalValueAud", "holdingsValueAud", "cashAud", "costBasisAud", "recordedAt")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      dash.totalValueAud,
      dash.holdingsValueAud,
      dash.cashAud,
      dash.costBasisAud,
      now,
    ]
  );

  for (const p of dash.positions) {
    if (p.priceAud == null || p.valueAud == null) continue;
    await pool.query(
      `INSERT INTO share_symbol_snapshots
        ("userId", symbol, "priceAud", "valueAud", quantity, "recordedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, p.symbol, p.priceAud, p.valueAud, p.quantity, now]
    );
  }

  return dash;
}

async function getChartData(userId) {
  const [portfolioRows, symbolRows, dash] = await Promise.all([
    pool.query(
      `SELECT "totalValueAud", "holdingsValueAud", "cashAud", "costBasisAud", "recordedAt"
       FROM share_portfolio_snapshots
       WHERE "userId"=$1 AND "recordedAt" >= CURRENT_DATE
       ORDER BY "recordedAt" ASC`,
      [userId]
    ),
    pool.query(
      `SELECT symbol, "priceAud", "valueAud", quantity, "recordedAt"
       FROM share_symbol_snapshots
       WHERE "userId"=$1 AND "recordedAt" >= CURRENT_DATE
       ORDER BY "recordedAt" ASC`,
      [userId]
    ),
    buildDashboard(userId),
  ]);

  const portfolioLine = portfolioRows.rows.map((r) => ({
    recordedAt: r.recordedAt,
    totalValueAud: num(r.totalValueAud),
    holdingsValueAud: num(r.holdingsValueAud),
    cashAud: num(r.cashAud),
    costBasisAud: num(r.costBasisAud),
    pnlPct:
      num(r.costBasisAud) > 0
        ? ((num(r.holdingsValueAud) - num(r.costBasisAud)) / num(r.costBasisAud)) * 100
        : 0,
  }));

  const bySymbol = {};
  for (const r of symbolRows.rows) {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
    bySymbol[r.symbol].push({
      recordedAt: r.recordedAt,
      priceAud: num(r.priceAud),
      valueAud: num(r.valueAud),
      quantity: num(r.quantity),
    });
  }

  const allocation = dash.positions
    .filter((p) => p.valueAud != null && p.valueAud > 0)
    .map((p) => ({
      symbol: p.symbol,
      exchange: p.exchange,
      valueAud: p.valueAud,
      pct: dash.holdingsValueAud > 0 ? (p.valueAud / dash.holdingsValueAud) * 100 : 0,
    }));

  const holdingPnl = dash.positions.map((p) => ({
    symbol: p.symbol,
    exchange: p.exchange,
    pnlPct: p.pnlPct,
    pnlAud: p.pnlAud,
    valueAud: p.valueAud,
  }));

  return { portfolioLine, bySymbol, allocation, holdingPnl };
}

module.exports = {
  computeHoldings,
  computeCashFromActivity,
  tradeProceedsAud,
  buildDashboard,
  recordSnapshots,
  getChartData,
  getTradesAndLedger,
};
