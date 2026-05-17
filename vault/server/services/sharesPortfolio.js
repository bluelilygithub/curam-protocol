'use strict';

const { pool } = require('../db');
const finnhub = require('./finnhub');

function num(v) {
  return Number(v) || 0;
}

function tradeProceedsAud(t) {
  const fx = t.currency === 'USD' ? num(t.fxRateToAud) : 1;
  return num(t.quantity) * num(t.pricePerShare) * fx + num(t.feesAud);
}

function computeHoldings(trades) {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradedAt) - new Date(b.tradedAt) || a.id - b.id
  );
  const map = {};
  for (const t of sorted) {
    const key = `${t.symbol}:${t.exchange}`;
    if (!map[key]) {
      map[key] = {
        symbol: t.symbol,
        exchange: t.exchange,
        quantity: 0,
        costBasisAud: 0,
      };
    }
    const h = map[key];
    const aud = tradeProceedsAud(t);
    const qty = num(t.quantity);
    if (t.side === 'buy') {
      h.quantity += qty;
      h.costBasisAud += aud;
    } else {
      if (h.quantity <= 0) continue;
      const avg = h.costBasisAud / h.quantity;
      const sellQty = Math.min(qty, h.quantity);
      h.costBasisAud -= avg * sellQty;
      h.quantity -= sellQty;
      if (h.quantity < 1e-8) {
        h.quantity = 0;
        h.costBasisAud = 0;
      }
    }
  }
  return Object.values(map).filter(h => h.quantity > 0);
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

async function fetchQuotesForHoldings(holdings) {
  if (!finnhub.isConfigured() || holdings.length === 0) {
    return { quotes: {}, usdAud: null, quoteError: finnhub.isConfigured() ? null : 'NO_API_KEY' };
  }
  let usdAud;
  try {
    usdAud = await finnhub.getUsdToAudRate();
  } catch (err) {
    return { quotes: {}, usdAud: null, quoteError: err.message };
  }

  const quotes = {};
  let quoteError = null;
  for (const h of holdings) {
    try {
      const q = await finnhub.getQuote(h.symbol, h.exchange);
      const priceAud = finnhub.priceToAud(q.current, q.currency, usdAud);
      const prevAud = finnhub.priceToAud(q.previousClose, q.currency, usdAud);
      quotes[`${h.symbol}:${h.exchange}`] = {
        priceAud,
        previousCloseAud: prevAud,
        dayChangePct: prevAud > 0 ? ((priceAud - prevAud) / prevAud) * 100 : 0,
        nativePrice: q.current,
        currency: q.currency,
      };
    } catch (err) {
      quoteError = quoteError || err.message;
    }
  }
  return { quotes, usdAud, quoteError };
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

async function buildDashboard(userId) {
  const { trades, ledger } = await getTradesAndLedger(userId);
  const holdings = computeHoldings(trades);
  const cashAud = computeCashFromActivity(trades, ledger);
  const { quotes, usdAud, quoteError } = await fetchQuotesForHoldings(holdings);

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

  return {
    positions,
    cashAud,
    holdingsValueAud,
    totalValueAud,
    costBasisAud,
    unrealizedPnlAud: holdings.length ? unrealizedPnlAud : null,
    unrealizedPnlPct: holdings.length ? unrealizedPnlPct : null,
    usdAud,
    quoteError,
    finnhubConfigured: finnhub.isConfigured(),
  };
}

async function recordSnapshots(userId) {
  const dash = await buildDashboard(userId);
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
