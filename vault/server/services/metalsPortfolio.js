'use strict';

const { pool } = require('../db');
const marketData = require('./marketData');

function num(v) {
  return Number(v) || 0;
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

function getDateInTz(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function getPurchases(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM metal_purchases WHERE "userId"=$1 ORDER BY "purchasedAt" DESC, id DESC`,
    [userId]
  );
  return rows;
}

async function hasMetalHoldings(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM metal_purchases WHERE "userId"=$1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

/** Last spot snapshot strictly before today's calendar date in workspace TZ. */
async function getSpotBaseline(metal, tz) {
  const today = getDateInTz(tz);
  const { rows } = await pool.query(
    `SELECT "audPerOz", "recordedAt" FROM metal_spot_snapshots
     WHERE metal=$1 AND ("recordedAt" AT TIME ZONE $2)::date < $3::date
     ORDER BY "recordedAt" DESC LIMIT 1`,
    [metal, tz, today]
  );
  if (!rows[0]) return null;
  return { audPerOz: num(rows[0].audPerOz), recordedAt: rows[0].recordedAt };
}

async function recordSpotSnapshot(metal = 'XAU') {
  if (!marketData.canFetchGoldSpot()) return null;
  try {
    const spot = await marketData.getGoldSpotAud({ force: false });
    if (!spot?.audPerOz) return null;
    await pool.query(
      `INSERT INTO metal_spot_snapshots (metal, "audPerOz", "recordedAt") VALUES ($1, $2, NOW())`,
      [metal, spot.audPerOz]
    );
    return spot;
  } catch (err) {
    console.warn('[metalsPortfolio] spot snapshot failed:', err.message);
    return null;
  }
}

async function buildMetalsDashboard(userId, tz = 'Australia/Sydney') {
  const purchases = await getPurchases(userId);
  if (!purchases.length) {
    return {
      positions: [],
      totalOz: 0,
      totalCostAud: 0,
      holdingsValueAud: 0,
      totalValueAud: 0,
      spot: null,
      quotedAt: null,
      portfolioMove: null,
    };
  }

  let spot = null;
  let spotError = null;
  try {
    if (marketData.canFetchGoldSpot()) {
      spot = await marketData.getGoldSpotAud({ force: false });
    } else {
      spotError = 'METAL_PRICE_API_KEY not set';
    }
  } catch (err) {
    spotError = err.message;
  }

  const audPerOz = spot?.audPerOz != null ? num(spot.audPerOz) : null;
  const baseline = audPerOz != null ? await getSpotBaseline('XAU', tz) : null;
  const previousCloseAudPerOz = baseline?.audPerOz ?? null;
  const spotDayChangePct = audPerOz != null && previousCloseAudPerOz != null && previousCloseAudPerOz > 0
    ? round2(((audPerOz - previousCloseAudPerOz) / previousCloseAudPerOz) * 100)
    : null;

  const positions = purchases.map((p) => {
    const weightOz = num(p.weightOz);
    const paidAud = num(p.paidAud);
    const metal = String(p.metal || 'XAU').toUpperCase();
    const label = p.description ? String(p.description) : `${metal} holding`;
    const valueAud = audPerOz != null ? round2(weightOz * audPerOz) : null;
    const dayChangeAud = audPerOz != null && previousCloseAudPerOz != null
      ? round2(weightOz * (audPerOz - previousCloseAudPerOz))
      : null;
    const pnlAud = valueAud != null ? round2(valueAud - paidAud) : null;
    const pnlPct = paidAud > 0 && pnlAud != null ? round2((pnlAud / paidAud) * 100) : null;

    return {
      id: p.id,
      metal,
      label,
      symbol: `M${p.id}`,
      exchange: 'SPOT',
      weightOz,
      quantity: weightOz,
      paidAud: round2(paidAud),
      priceAud: audPerOz != null ? round2(audPerOz) : null,
      previousCloseAud: previousCloseAudPerOz != null ? round2(previousCloseAudPerOz) : null,
      dayChangePct: spotDayChangePct,
      dayChangeAud,
      valueAud,
      costAud: round2(paidAud),
      pnlAud,
      pnlPct,
      purchasedAt: p.purchasedAt,
      sectorBenchmark: 'Gold spot (XAU/AUD)',
      sectorBenchmarkPct: spotDayChangePct,
      vsSectorPct: 0,
      relativeToSector: spotDayChangePct != null ? 'matched' : 'unknown',
    };
  });

  const totalOz = purchases.reduce((s, p) => s + num(p.weightOz), 0);
  const totalCostAud = round2(purchases.reduce((s, p) => s + num(p.paidAud), 0));
  const holdingsValueAud = audPerOz != null ? round2(totalOz * audPerOz) : null;
  const unrealizedPnlAud = holdingsValueAud != null ? round2(holdingsValueAud - totalCostAud) : null;
  const unrealizedPnlPct = totalCostAud > 0 && unrealizedPnlAud != null
    ? round2((unrealizedPnlAud / totalCostAud) * 100)
    : null;

  let portfolioMove = null;
  if (audPerOz != null && previousCloseAudPerOz != null && totalOz > 0) {
    const startValueAud = totalOz * previousCloseAudPerOz;
    const currentValueAud = totalOz * audPerOz;
    const changeAud = currentValueAud - startValueAud;
    portfolioMove = {
      startValueAud: round2(startValueAud),
      currentValueAud: round2(currentValueAud),
      changeAud: round2(changeAud),
      changePct: round2((changeAud / startValueAud) * 100),
      priced: positions.length,
    };
  }

  return {
    positions,
    totalOz: round2(totalOz),
    totalCostAud,
    holdingsValueAud,
    totalValueAud: holdingsValueAud,
    cashAud: 0,
    unrealizedPnlAud,
    unrealizedPnlPct,
    spot: spot ? { audPerOz: round2(spot.audPerOz), priceAt: spot.priceAt } : null,
    spotDayChangePct,
    previousCloseAudPerOz: previousCloseAudPerOz != null ? round2(previousCloseAudPerOz) : null,
    portfolioMove,
    quotedAt: spot?.priceAt || null,
    spotError,
    baselineSource: baseline ? 'prior_day_snapshot' : null,
  };
}

module.exports = {
  getPurchases,
  buildMetalsDashboard,
  recordSpotSnapshot,
  hasMetalHoldings,
};
