'use strict';

const { pool } = require('../db');
const sharesPortfolio = require('./sharesPortfolio');
const metalsPortfolio = require('./metalsPortfolio');
const marketData = require('./marketData');
const {
  ALERT_PEAK_TRIGGER_OFF_PCT,
  ALERT_AVG_COST_TRIGGER_OFF_PCT,
  ALERT_PROXIMITY_PP,
  loadHighWaterMarks,
  loadPeakPriceContext,
  mergeHighWaterMarks,
  buildShareAlertRows,
  buildMetalsAlertRows,
} = require('./portfolioAlerts');

const INDEX_PROXIES = {
  nasdaq: { symbol: String(process.env.OBS_INDEX_NASDAQ || 'QQQ').toUpperCase(), exchange: 'NASDAQ', label: 'Nasdaq' },
  sox: { symbol: String(process.env.OBS_INDEX_SOX || 'SOXX').toUpperCase(), exchange: 'NASDAQ', label: 'SOX' },
  asx: { symbol: String(process.env.OBS_INDEX_ASX || 'STW').toUpperCase(), exchange: 'ASX', label: 'ASX 200' },
};

const SEMI_SYMBOLS = new Set([
  'TSM', 'NVDA', 'ASML', 'AMD', 'AVGO', 'INTC', 'MU', 'QCOM', 'ARM', 'SMCI', 'LRCX', 'KLAC', 'AMAT',
]);

const VALID_DAYS = [1, 7, 30, 90];

function parseDays(raw) {
  const n = Number(raw);
  return VALID_DAYS.includes(n) ? n : 30;
}

function num(v) {
  return Number(v) || 0;
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function holdingKey(symbol, exchange) {
  return `${symbol}:${exchange || ''}`;
}

function getDateInTz(tz, offsetDays = 0) {
  const d = offsetDays
    ? new Date(Date.now() - offsetDays * 24 * 60 * 60 * 1000)
    : new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

async function getWorkspaceTimezone() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    return rows[0]?.value?.trim() || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

function sectorBenchmarkFor(symbol, exchange) {
  const sym = String(symbol || '').toUpperCase();
  const ex = String(exchange || '').toUpperCase();
  if (ex === 'ASX') return { label: 'ASX 200', key: 'asx' };
  if (SEMI_SYMBOLS.has(sym)) return { label: 'SOX', key: 'sox' };
  return { label: 'Nasdaq', key: 'nasdaq' };
}

async function fetchIndexPct(proxy) {
  try {
    if (!marketData.canFetchExchange(proxy.exchange)) return null;
    const q = await marketData.getQuote(proxy.symbol, proxy.exchange);
    if (!q?.current || !q?.previousClose) return null;
    return round2(((q.current - q.previousClose) / q.previousClose) * 100);
  } catch {
    return null;
  }
}

function computePortfolioDayMovement(positions) {
  let startValueAud = 0;
  let currentValueAud = 0;
  let priced = 0;
  for (const p of positions || []) {
    if (p.priceAud == null || p.previousCloseAud == null) continue;
    const qty = num(p.quantity);
    startValueAud += num(p.previousCloseAud) * qty;
    currentValueAud += num(p.priceAud) * qty;
    priced += 1;
  }
  if (priced === 0 || startValueAud <= 0) return null;
  const changeAud = currentValueAud - startValueAud;
  return {
    startValueAud: round2(startValueAud),
    currentValueAud: round2(currentValueAud),
    changeAud: round2(changeAud),
    changePct: round2((changeAud / startValueAud) * 100),
    priced,
  };
}

function enrichHoldings(dash, indexPcts) {
  const holdingsValue = dash.holdingsValueAud || 0;
  return dash.positions.map((p) => {
    const qty = num(p.quantity);
    const sector = sectorBenchmarkFor(p.symbol, p.exchange);
    const sectorPct = indexPcts[sector.key] ?? null;
    const dayChangePct = p.dayChangePct != null ? round2(p.dayChangePct) : null;
    const dayChangeAud = p.dayChangeAud != null
      ? round2(p.dayChangeAud)
      : (p.priceAud != null && p.previousCloseAud != null
        ? round2((num(p.priceAud) - num(p.previousCloseAud)) * qty)
        : null);
    const vsSector = (dayChangePct != null && sectorPct != null)
      ? round2(dayChangePct - sectorPct)
      : null;
    let relativeToSector = 'unknown';
    if (vsSector != null) {
      if (Math.abs(vsSector) < 0.25) relativeToSector = 'matched';
      else relativeToSector = vsSector > 0 ? 'beat' : 'lagged';
    }
    return {
      symbol: p.symbol,
      exchange: p.exchange,
      key: holdingKey(p.symbol, p.exchange),
      quantity: qty,
      priceAud: p.priceAud != null ? round2(p.priceAud) : null,
      previousCloseAud: p.previousCloseAud != null ? round2(p.previousCloseAud) : null,
      avgCostAud: p.avgCostAud != null ? round2(p.avgCostAud) : null,
      costBasisAud: p.costBasisAud != null ? round2(p.costBasisAud) : null,
      dayChangePct,
      dayChangeAud,
      valueAud: p.valueAud != null ? round2(p.valueAud) : null,
      weightPct: p.valueAud != null && holdingsValue > 0 ? round2((p.valueAud / holdingsValue) * 100) : null,
      totalReturnPct: p.pnlPct != null ? round2(p.pnlPct) : null,
      pnlAud: p.pnlAud != null ? round2(p.pnlAud) : null,
      sectorBenchmark: sector.label,
      sectorBenchmarkKey: sector.key,
      sectorBenchmarkPct: sectorPct,
      vsSectorPct: vsSector,
      relativeToSector,
    };
  });
}

function buildAllocationByBenchmark(enriched, holdingsValueAud) {
  const buckets = {};
  for (const h of enriched) {
    if (!h.valueAud || h.valueAud <= 0) continue;
    const label = h.sectorBenchmark || 'Other';
    if (!buckets[label]) buckets[label] = { label, valueAud: 0, symbols: [] };
    buckets[label].valueAud += h.valueAud;
    buckets[label].symbols.push(h.symbol);
  }
  return Object.values(buckets)
    .map((b) => ({
      ...b,
      valueAud: round2(b.valueAud),
      pct: holdingsValueAud > 0 ? round2((b.valueAud / holdingsValueAud) * 100) : 0,
    }))
    .sort((a, b) => b.valueAud - a.valueAud);
}

async function loadTrailingMetrics(userId, holdings, windowDays = 5) {
  const symbols = [...new Set(holdings.map((h) => h.symbol).filter(Boolean))];
  if (!symbols.length) return [];

  const cutoff = new Date(Date.now() - (windowDays + 3) * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (symbol) symbol, "priceAud", "recordedAt"
     FROM share_symbol_snapshots
     WHERE "userId"=$1 AND symbol = ANY($2::text[]) AND "recordedAt" >= $3
     ORDER BY symbol, "recordedAt" ASC`,
    [userId, symbols, cutoff]
  );
  const startBySym = Object.fromEntries(
    rows.map((r) => [r.symbol, { priceAud: num(r.priceAud), recordedAt: r.recordedAt }])
  );

  return holdings.map((h) => {
    const start = startBySym[h.symbol];
    const current = h.priceAud;
    if (!start?.priceAud || !current || start.priceAud <= 0) {
      return {
        symbol: h.symbol,
        exchange: h.exchange,
        key: h.key,
        dataAvailable: false,
        windowDays,
      };
    }
    return {
      symbol: h.symbol,
      exchange: h.exchange,
      key: h.key,
      dataAvailable: true,
      windowDays,
      trailingPct: round2(((current - start.priceAud) / start.priceAud) * 100),
      startRecordedAt: start.recordedAt,
    };
  }).sort((a, b) => Math.abs(b.trailingPct || 0) - Math.abs(a.trailingPct || 0));
}

async function loadUpcomingEarnings(holdings, today, tz, windowDays = 90) {
  const future = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);
  const to = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(future);
  const events = [];
  const seen = new Set();
  for (const h of holdings || []) {
    const ex = String(h.exchange || '').toUpperCase();
    if (ex !== 'NYSE' && ex !== 'NASDAQ') continue;
    if (!h.symbol || seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    try {
      const cal = await marketData.getEarningsCalendar(h.symbol, today, to);
      for (const e of cal || []) {
        events.push({
          symbol: h.symbol,
          exchange: h.exchange,
          weightPct: h.weightPct,
          date: e.date,
          hour: e.hour,
          quarter: e.quarter,
          year: e.year,
          epsEstimate: e.epsEstimate,
        });
      }
    } catch { /* skip */ }
  }
  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return events;
}

function parseHeadlines(val) {
  if (!val) return {};
  if (typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return {};
}

async function loadObservationHistory(userId, days) {
  const cutoff = getDateInTz(await getWorkspaceTimezone(), days);
  const { rows } = await pool.query(
    `SELECT date, headlines FROM share_news_briefings
     WHERE "userId"=$1 AND type='observation' AND date >= $2
     ORDER BY date ASC`,
    [userId, cutoff]
  );
  return rows.map((r) => {
    const h = parseHeadlines(r.headlines);
    return {
      date: String(r.date).slice(0, 10),
      portfolioChangePct: h.portfolioMove?.changePct ?? null,
      nasdaqPct: h.nasdaqPct ?? null,
      soxPct: h.soxPct ?? null,
      asxPct: h.asxPct ?? null,
      metalsChangePct: h.metalsPortfolioMove?.changePct ?? null,
      movers: h.movers || [],
      unexplainedMoveHistory: h.unexplainedMoveHistory || {},
    };
  });
}

function buildNormalizedPerformance(observationHistory) {
  if (!observationHistory.length) return [];
  let port = 100;
  let nasdaq = 100;
  let sox = 100;
  let asx = 100;
  const out = [];
  for (const row of observationHistory) {
    if (row.portfolioChangePct != null) port *= 1 + row.portfolioChangePct / 100;
    if (row.nasdaqPct != null) nasdaq *= 1 + row.nasdaqPct / 100;
    if (row.soxPct != null) sox *= 1 + row.soxPct / 100;
    if (row.asxPct != null) asx *= 1 + row.asxPct / 100;
    out.push({
      date: row.date,
      portfolio: round2(port),
      nasdaq: round2(nasdaq),
      sox: round2(sox),
      asx: round2(asx),
    });
  }
  return out;
}

async function buildMoveHeatmap(userId, days, unexplainedHistory = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `SELECT symbol, "priceAud", "recordedAt"
     FROM share_symbol_snapshots
     WHERE "userId"=$1 AND "recordedAt" >= $2
     ORDER BY symbol, "recordedAt" ASC`,
    [userId, since]
  );

  const bySymDate = {};
  for (const r of rows) {
    const date = String(r.recordedAt).slice(0, 10);
    const sym = r.symbol;
    if (!bySymDate[sym]) bySymDate[sym] = {};
    bySymDate[sym][date] = num(r.priceAud);
  }

  const unexplainedSet = new Set();
  for (const [sym, entries] of Object.entries(unexplainedHistory || {})) {
    for (const e of entries || []) {
      unexplainedSet.add(`${sym}:${e.date}`);
    }
  }

  const symbols = Object.keys(bySymDate).sort();
  const dateSet = new Set();
  const cells = [];

  for (const sym of symbols) {
    const dates = Object.keys(bySymDate[sym]).sort();
    let prevPrice = null;
    for (const date of dates) {
      dateSet.add(date);
      const price = bySymDate[sym][date];
      let dayChangePct = null;
      if (prevPrice != null && prevPrice > 0) {
        dayChangePct = round2(((price - prevPrice) / prevPrice) * 100);
      }
      if (dayChangePct != null && Math.abs(dayChangePct) >= 0.5) {
        cells.push({
          symbol: sym,
          date,
          dayChangePct,
          unexplained: unexplainedSet.has(`${sym}:${date}`),
        });
      }
      prevPrice = price;
    }
  }

  return {
    symbols,
    dates: [...dateSet].sort(),
    cells,
  };
}

function buildPatternSummary(enriched, unexplainedHistory) {
  const material = enriched.filter(
    (h) => Math.abs(h.dayChangePct ?? 0) >= 1 || Math.abs(h.vsSectorPct ?? 0) >= 2
  );
  const lagging = enriched.filter((h) => h.relativeToSector === 'lagged');
  const recurring = [];
  for (const [sym, entries] of Object.entries(unexplainedHistory || {})) {
    const recent = (entries || []).slice(-5);
    if (recent.length >= 2) recurring.push({ symbol: sym, count: recent.length, entries: recent });
  }
  return {
    materialMoverCount: material.length,
    laggingCount: lagging.length,
    laggingSymbols: lagging.map((h) => h.symbol),
    recurringUnexplained: recurring,
    alertThresholds: {
      peakOffPct: ALERT_PEAK_TRIGGER_OFF_PCT,
      avgCostOffPct: ALERT_AVG_COST_TRIGGER_OFF_PCT,
      proximityPp: ALERT_PROXIMITY_PP,
    },
  };
}

function downsamplePortfolioSnapshots(rows, days) {
  if (days <= 1) return rows;
  const byDay = new Map();
  for (const r of rows) {
    const day = String(r.recordedAt).slice(0, 10);
    byDay.set(day, r);
  }
  return [...byDay.values()].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
}

async function getChartData(userId, rawDays = 30) {
  const days = parseDays(rawDays);
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);
  const since = days <= 1
    ? 'CURRENT_DATE'
    : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sinceParam = days <= 1 ? null : since;

  const [dash, metalsDash, portfolioRows, symbolRows, observationHistory] = await Promise.all([
    sharesPortfolio.buildDashboard(userId),
    metalsPortfolio.buildMetalsDashboard(userId, tz),
    pool.query(
      days <= 1
        ? `SELECT "totalValueAud", "holdingsValueAud", "cashAud", "costBasisAud", "recordedAt"
           FROM share_portfolio_snapshots
           WHERE "userId"=$1 AND "recordedAt" >= CURRENT_DATE
           ORDER BY "recordedAt" ASC`
        : `SELECT "totalValueAud", "holdingsValueAud", "cashAud", "costBasisAud", "recordedAt"
           FROM share_portfolio_snapshots
           WHERE "userId"=$1 AND "recordedAt" >= $2
           ORDER BY "recordedAt" ASC`,
      days <= 1 ? [userId] : [userId, sinceParam]
    ),
    pool.query(
      days <= 1
        ? `SELECT symbol, "priceAud", "valueAud", quantity, "recordedAt"
           FROM share_symbol_snapshots
           WHERE "userId"=$1 AND "recordedAt" >= CURRENT_DATE
           ORDER BY "recordedAt" ASC`
        : `SELECT symbol, "priceAud", "valueAud", quantity, "recordedAt"
           FROM share_symbol_snapshots
           WHERE "userId"=$1 AND "recordedAt" >= $2
           ORDER BY "recordedAt" ASC`,
      days <= 1 ? [userId] : [userId, sinceParam]
    ),
    loadObservationHistory(userId, days),
  ]);

  const [nasdaqPct, soxPct, asxPct] = await Promise.all([
    fetchIndexPct(INDEX_PROXIES.nasdaq),
    fetchIndexPct(INDEX_PROXIES.sox),
    fetchIndexPct(INDEX_PROXIES.asx),
  ]);
  const indexPcts = { nasdaq: nasdaqPct, sox: soxPct, asx: asxPct };

  const enriched = enrichHoldings(dash, indexPcts);
  const portfolioMove = computePortfolioDayMovement(dash.positions);

  const priorMarks = await loadHighWaterMarks(userId);
  const peakContext = dash.positions.length
    ? await loadPeakPriceContext(userId, dash.positions)
    : { snapshotPeaks: {}, maxBuyPrices: {} };
  const highWaterMarks = mergeHighWaterMarks(
    priorMarks,
    dash.positions,
    metalsDash.spot?.audPerOz ?? null,
    today,
    peakContext
  );
  const alertRows = [
    ...buildShareAlertRows(dash.positions, highWaterMarks),
    ...buildMetalsAlertRows(metalsDash.positions, highWaterMarks, metalsDash.spot?.audPerOz ?? null),
  ].sort((a, b) => (a.pctOffPeak ?? 0) - (b.pctOffPeak ?? 0));

  const [trailingReturns, earningsTimeline] = await Promise.all([
    loadTrailingMetrics(userId, enriched, 5),
    loadUpcomingEarnings(enriched, today, tz, 90),
  ]);

  const latestObs = observationHistory[observationHistory.length - 1];
  const unexplainedHistory = latestObs?.unexplainedMoveHistory || {};
  const moveHeatmap = await buildMoveHeatmap(userId, Math.min(days, 14), unexplainedHistory);

  const portfolioSnapshots = downsamplePortfolioSnapshots(portfolioRows.rows, days).map((r) => ({
    recordedAt: r.recordedAt,
    totalValueAud: num(r.totalValueAud),
    holdingsValueAud: num(r.holdingsValueAud),
    cashAud: num(r.cashAud),
    costBasisAud: num(r.costBasisAud),
    pnlPct: num(r.costBasisAud) > 0
      ? round2(((num(r.holdingsValueAud) - num(r.costBasisAud)) / num(r.costBasisAud)) * 100)
      : 0,
  }));

  const bySymbol = {};
  for (const r of symbolRows.rows) {
    const pos = enriched.find((h) => h.symbol === r.symbol);
    const key = pos?.key || holdingKey(r.symbol, '');
    if (!bySymbol[key]) bySymbol[key] = [];
    bySymbol[key].push({
      recordedAt: r.recordedAt,
      priceAud: num(r.priceAud),
      valueAud: num(r.valueAud),
      quantity: num(r.quantity),
    });
  }

  const allocation = enriched
    .filter((h) => h.valueAud != null && h.valueAud > 0)
    .map((h) => ({
      symbol: h.symbol,
      exchange: h.exchange,
      sectorBenchmark: h.sectorBenchmark,
      valueAud: h.valueAud,
      pct: dash.holdingsValueAud > 0 ? round2((h.valueAud / dash.holdingsValueAud) * 100) : 0,
    }));

  const dayMovers = [...enriched]
    .filter((h) => h.dayChangePct != null)
    .sort((a, b) => Math.abs(b.dayChangePct) - Math.abs(a.dayChangePct));

  const benchmarksToday = [
    { label: 'Your holdings', pct: portfolioMove?.changePct ?? null, kind: 'portfolio' },
    { label: 'Nasdaq', pct: nasdaqPct, kind: 'nasdaq' },
    { label: 'SOX', pct: soxPct, kind: 'sox' },
    { label: 'ASX 200', pct: asxPct, kind: 'asx' },
  ].filter((b) => b.pct != null || b.kind === 'portfolio');

  let metalsSpotHistory = [];
  if (days > 1 && sinceParam) {
    const { rows: spotRows } = await pool.query(
      `SELECT "audPerOz", "recordedAt" FROM metal_spot_snapshots
       WHERE metal='XAU' AND "recordedAt" >= $1 ORDER BY "recordedAt" ASC`,
      [sinceParam]
    );
    const byDay = new Map();
    for (const r of spotRows) {
      const day = String(r.recordedAt).slice(0, 10);
      byDay.set(day, { recordedAt: r.recordedAt, audPerOz: num(r.audPerOz) });
    }
    metalsSpotHistory = [...byDay.values()].sort(
      (a, b) => new Date(a.recordedAt) - new Date(b.recordedAt)
    );
  }

  return {
    days,
    asOf: dash.quotedAt,
    benchmarksToday,
    portfolioMove,
    indexPcts,
    dayMovers,
    alertRows,
    trailingReturns,
    allocation,
    allocationByBenchmark: buildAllocationByBenchmark(enriched, dash.holdingsValueAud),
    holdingPnl: enriched.map((h) => ({
      symbol: h.symbol,
      exchange: h.exchange,
      key: h.key,
      pnlPct: h.totalReturnPct,
      pnlAud: h.pnlAud,
      valueAud: h.valueAud,
    })),
    patternSummary: buildPatternSummary(enriched, unexplainedHistory),
    moveHeatmap,
    earningsTimeline,
    observationHistory,
    normalizedPerformance: buildNormalizedPerformance(observationHistory),
    portfolioSnapshots,
    bySymbol,
    portfolioLine: portfolioSnapshots,
    metals: {
      hasHoldings: metalsDash.positions.length > 0,
      portfolioMove: metalsDash.portfolioMove,
      spotDayChangePct: metalsDash.spotDayChangePct,
      holdingsValueAud: metalsDash.holdingsValueAud,
      unrealizedPnlPct: metalsDash.unrealizedPnlPct,
      positions: metalsDash.positions,
      alertRows: buildMetalsAlertRows(metalsDash.positions, highWaterMarks, metalsDash.spot?.audPerOz ?? null),
      spotHistory: metalsSpotHistory,
    },
  };
}

module.exports = {
  getChartData,
  parseDays,
  VALID_DAYS,
};
