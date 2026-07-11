'use strict';

const { pool } = require('../db');

const HWM_SETTINGS_KEY = 'shares_high_water_marks';
const ALERT_PEAK_TRIGGER_OFF_PCT = 10;
const ALERT_AVG_COST_TRIGGER_OFF_PCT = 4;
const ALERT_PROXIMITY_PP = 1;
const HWM_SPOT_KEY = 'XAU:SPOT';

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function holdingKey(symbol, exchange) {
  return `${symbol}:${exchange || ''}`;
}

function pctOffReference(current, reference) {
  const c = Number(current);
  const r = Number(reference);
  if (!Number.isFinite(c) || !Number.isFinite(r) || r <= 0) return null;
  return round2(((c - r) / r) * 100);
}

function computeAlertFlag(pctOffPeak, pctOffAvgCost) {
  const peakTrig = pctOffPeak != null && pctOffPeak <= -ALERT_PEAK_TRIGGER_OFF_PCT;
  const costTrig = pctOffAvgCost != null && pctOffAvgCost <= -ALERT_AVG_COST_TRIGGER_OFF_PCT;
  const peakWarn = pctOffPeak != null
    && pctOffPeak > -ALERT_PEAK_TRIGGER_OFF_PCT
    && pctOffPeak <= -(ALERT_PEAK_TRIGGER_OFF_PCT - ALERT_PROXIMITY_PP);
  const costWarn = pctOffAvgCost != null
    && pctOffAvgCost > -ALERT_AVG_COST_TRIGGER_OFF_PCT
    && pctOffAvgCost <= -(ALERT_AVG_COST_TRIGGER_OFF_PCT - ALERT_PROXIMITY_PP);
  if (peakTrig || costTrig) return '🔴';
  if (peakWarn || costWarn) return '⚠️';
  return '';
}

function formatPctOffDisplay(pct) {
  if (pct == null) return '—';
  if (pct >= -0.005) return '0.00%';
  return `${Math.abs(pct).toFixed(2)}%`;
}

function mergeHighWaterMarks(priorMarks, shareHoldings, metalsSpotAud, asOfDate, { snapshotPeaks = {}, maxBuyPrices = {} } = {}) {
  const marks = { ...(priorMarks || {}) };
  for (const h of shareHoldings || []) {
    const price = Number(h.priceAud);
    if (!Number.isFinite(price) || price <= 0) continue;
    const key = holdingKey(h.symbol, h.exchange);
    const prev = marks[key]?.peakAud;
    const snapPeak = snapshotPeaks[key];
    const buyPeak = maxBuyPrices[key];
    const candidates = [price, prev, snapPeak, buyPeak].filter((v) => Number.isFinite(v) && v > 0);
    marks[key] = {
      peakAud: Math.max(...candidates),
      asOf: asOfDate,
    };
  }
  const spot = Number(metalsSpotAud);
  if (Number.isFinite(spot) && spot > 0) {
    const prev = marks[HWM_SPOT_KEY]?.peakAud;
    const candidates = [spot, prev].filter((v) => Number.isFinite(v) && v > 0);
    marks[HWM_SPOT_KEY] = {
      peakAud: Math.max(...candidates),
      asOf: asOfDate,
    };
  }
  return marks;
}

async function loadPeakPriceContext(userId, holdings) {
  const snapshotPeaks = {};
  const maxBuyPrices = {};
  if (!holdings?.length) return { snapshotPeaks, maxBuyPrices };

  const symbols = [...new Set(holdings.map((h) => h.symbol))];
  const [snapRes, buyRes] = await Promise.all([
    pool.query(
      `SELECT symbol, MAX("priceAud") AS peak FROM share_symbol_snapshots
       WHERE "userId"=$1 AND symbol = ANY($2::text[])
       GROUP BY symbol`,
      [userId, symbols]
    ),
    pool.query(
      `SELECT symbol, exchange, MAX("pricePerShare") AS peak_buy FROM share_trades
       WHERE "userId"=$1 AND side='buy' AND symbol = ANY($2::text[])
       GROUP BY symbol, exchange`,
      [userId, symbols]
    ),
  ]);

  for (const h of holdings) {
    const key = holdingKey(h.symbol, h.exchange);
    const snapRow = snapRes.rows.find((r) => r.symbol === h.symbol);
    if (snapRow?.peak != null) snapshotPeaks[key] = Number(snapRow.peak);
  }
  for (const r of buyRes.rows) {
    maxBuyPrices[holdingKey(r.symbol, r.exchange)] = Number(r.peak_buy);
  }
  return { snapshotPeaks, maxBuyPrices };
}

async function loadHighWaterMarks(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key=$2`,
      [userId, HWM_SETTINGS_KEY]
    );
    if (rows[0]?.value) {
      const parsed = JSON.parse(rows[0].value);
      if (parsed?.marks && typeof parsed.marks === 'object') return parsed.marks;
    }
  } catch {
    /* fall through */
  }
  try {
    const { rows } = await pool.query(
      `SELECT headlines FROM share_news_briefings
       WHERE "userId"=$1 AND type='observation'
       ORDER BY date DESC, "createdAt" DESC LIMIT 1`,
      [userId]
    );
    const headlines = rows[0]?.headlines;
    if (headlines && typeof headlines === 'object' && headlines.highWaterMarks) {
      return headlines.highWaterMarks;
    }
    if (typeof headlines === 'string') {
      const parsed = JSON.parse(headlines);
      return parsed?.highWaterMarks || {};
    }
  } catch {
    /* empty */
  }
  return {};
}

async function saveHighWaterMarks(userId, marks) {
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3)
     ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value`,
    [userId, HWM_SETTINGS_KEY, JSON.stringify({ marks, updatedAt: new Date().toISOString() })]
  );
}

function buildShareAlertRows(positions, highWaterMarks) {
  return (positions || []).map((p) => {
    const key = holdingKey(p.symbol, p.exchange);
    const peakAud = highWaterMarks[key]?.peakAud ?? p.priceAud;
    const avgCost = p.avgCostAud != null
      ? Number(p.avgCostAud)
      : (p.costBasisAud != null && p.quantity ? Number(p.costBasisAud) / Number(p.quantity) : null);
    const pctOffPeak = pctOffReference(p.priceAud, peakAud);
    const pctOffAvgCost = pctOffReference(p.priceAud, avgCost);
    return {
      label: p.symbol,
      exchange: p.exchange,
      key,
      currentAud: p.priceAud != null ? round2(p.priceAud) : null,
      peakAud: peakAud != null ? round2(Number(peakAud)) : null,
      avgCostAud: avgCost != null ? round2(avgCost) : null,
      pctOffPeak,
      pctOffAvgCost,
      flag: computeAlertFlag(pctOffPeak, pctOffAvgCost),
      kind: 'share',
    };
  });
}

function buildMetalsAlertRows(metalsPositions, highWaterMarks, spotAud) {
  const peakSpot = highWaterMarks[HWM_SPOT_KEY]?.peakAud ?? spotAud;
  return (metalsPositions || []).map((p) => {
    const avgCostPerOz = p.weightOz > 0 ? Number(p.paidAud) / Number(p.weightOz) : null;
    const current = p.priceAud ?? spotAud;
    const pctOffPeak = pctOffReference(current, peakSpot);
    const pctOffAvgCost = pctOffReference(current, avgCostPerOz);
    return {
      label: p.label || p.metal || 'XAU',
      exchange: 'SPOT',
      key: p.symbol,
      currentAud: current != null ? round2(Number(current)) : null,
      peakAud: peakSpot != null ? round2(Number(peakSpot)) : null,
      avgCostAud: avgCostPerOz != null ? round2(avgCostPerOz) : null,
      pctOffPeak,
      pctOffAvgCost,
      flag: computeAlertFlag(pctOffPeak, pctOffAvgCost),
      kind: 'metal',
    };
  });
}

/** Load prior HWM, merge with current prices, persist, return alert rows. */
async function refreshHighWaterMarksAndAlerts(userId, {
  sharePositions = [],
  metalsPositions = [],
  metalsSpotAud = null,
  asOfDate,
}) {
  const priorMarks = await loadHighWaterMarks(userId);
  const peakContext = sharePositions.length
    ? await loadPeakPriceContext(userId, sharePositions)
    : { snapshotPeaks: {}, maxBuyPrices: {} };
  const highWaterMarks = mergeHighWaterMarks(
    priorMarks,
    sharePositions,
    metalsSpotAud,
    asOfDate,
    peakContext
  );
  await saveHighWaterMarks(userId, highWaterMarks);
  const shareAlerts = buildShareAlertRows(sharePositions, highWaterMarks);
  const metalsAlerts = buildMetalsAlertRows(metalsPositions, highWaterMarks, metalsSpotAud);
  return {
    highWaterMarks,
    shareAlerts,
    metalsAlerts,
    alertByKey: Object.fromEntries(
      [...shareAlerts, ...metalsAlerts].map((a) => [a.key, a])
    ),
  };
}

module.exports = {
  HWM_SETTINGS_KEY,
  HWM_SPOT_KEY,
  ALERT_PEAK_TRIGGER_OFF_PCT,
  ALERT_AVG_COST_TRIGGER_OFF_PCT,
  ALERT_PROXIMITY_PP,
  holdingKey,
  pctOffReference,
  computeAlertFlag,
  formatPctOffDisplay,
  mergeHighWaterMarks,
  loadPeakPriceContext,
  loadHighWaterMarks,
  saveHighWaterMarks,
  buildShareAlertRows,
  buildMetalsAlertRows,
  refreshHighWaterMarksAndAlerts,
};
