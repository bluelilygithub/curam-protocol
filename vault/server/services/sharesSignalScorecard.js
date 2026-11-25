'use strict';

// Signal scorecard (roadmap step 10): every directional call the Shares app makes is recorded with the price at the time, then scored
// 30 and 90 days later against the stored price and the holding's index. The record goes back into thesis checks as calibration.
// Idea: the reflection memory in TradingAgents (arXiv 2412.20138, Apache-2.0); rewritten for Vault, nothing copied. See docs/shares-scorecard.md.
//
// Calls recorded:
//   source 'briefing': the daily news briefing's per-holding signal, 'bullish' or 'bearish' (watch/neutral have no direction).
//   source 'thesis':   a thesis check verdict, 'concern' (weakening, impaired, broken, red line) or 'intact'. 'unclear' is not a call.
// Right means: bullish/intact → the share beat its index; bearish/concern → it lagged. Without an index price, the plain return is used.
// Prices come only from share_symbol_snapshots and share_benchmark_closes (no paid API calls).

const { pool } = require('../db');
const { BENCHMARKS } = require('./sharesBenchmarks');
const { captureIf, makeFingerprint } = require('./SuggestionService');

const HORIZONS = [30, 90];
const UP_CALLS = new Set(['bullish', 'intact']);
const DOWN_CALLS = new Set(['bearish', 'concern']);
const LATE_DAYS = 10; // no price this long after the target day → give up on that horizon ('no-price')
const LABEL = { 'briefing:bullish': 'News signal: bullish', 'briefing:bearish': 'News signal: bearish', 'thesis:concern': 'Thesis check: concern', 'thesis:intact': 'Thesis check: intact' };

/** Thesis verdict → call word, or null when the verdict is not a call. */
function thesisCall(verdict) {
  if (verdict === 'intact') return 'intact';
  if (['weakening', 'impaired', 'broken', 'red-line'].includes(verdict)) return 'concern';
  return null;
}

/** Was the call right? `ret` and `bench` are fractions (0.05 = +5%); bench may be null. Null when it cannot be judged. */
function judge(call, ret, bench) {
  if (ret == null || !Number.isFinite(ret)) return null;
  const edge = bench != null && Number.isFinite(bench) ? ret - bench : ret;
  if (UP_CALLS.has(call)) return edge > 0;
  if (DOWN_CALLS.has(call)) return edge < 0;
  return null;
}

/** Record (or, the same day, replace) one call. Skips silently without a price: there is nothing to score against. */
async function recordCall({ userId, source, symbol, exchange, call, priceAud, calledOn, benchKey }) {
  if (!call || !(Number(priceAud) > 0) || !calledOn) return;
  const benchSymbol = BENCHMARKS[benchKey]?.symbol || null;
  let benchAud = null;
  if (benchSymbol) {
    const b = await pool.query(
      `SELECT "closeAud" FROM share_benchmark_closes WHERE symbol=$1 AND "closeAud" IS NOT NULL
         AND "tradingDay" <= $2::date AND "tradingDay" > $2::date - 7 ORDER BY "tradingDay" DESC LIMIT 1`,
      [benchSymbol, calledOn]
    );
    benchAud = b.rows[0] ? Number(b.rows[0].closeAud) : null;
  }
  await pool.query(
    `INSERT INTO share_signal_calls ("userId", source, symbol, exchange, "calledOn", call, "priceAud", "benchSymbol", "benchAud")
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9)
     ON CONFLICT ("userId", source, symbol, exchange, "calledOn") DO UPDATE SET
       call=EXCLUDED.call, "priceAud"=EXCLUDED."priceAud", "benchSymbol"=EXCLUDED."benchSymbol", "benchAud"=EXCLUDED."benchAud",
       ret30=NULL, bench30=NULL, s30='pending', ret90=NULL, bench90=NULL, s90='pending'`,
    [userId, source, String(symbol).toUpperCase(), String(exchange || '').toUpperCase(), calledOn, call, Number(priceAud), benchSymbol, benchAud]
  );
}

/** Score every call whose 30- or 90-day mark has passed. `today` is YYYY-MM-DD in the workspace time zone. Returns how many were scored. */
async function scoreDue(userId, today) {
  let scored = 0;
  for (const h of HORIZONS) {
    const { rows } = await pool.query(
      `SELECT id, symbol, call, "priceAud", "benchSymbol", "benchAud", ("calledOn" + $3::int)::text AS target
         FROM share_signal_calls WHERE "userId"=$1 AND s${h}='pending' AND "calledOn" + $3::int <= $2::date`,
      [userId, today, h]
    );
    for (const r of rows) {
      const p = await pool.query(
        `SELECT "priceAud" FROM share_symbol_snapshots WHERE "userId"=$1 AND symbol=$2
           AND "recordedAt" >= $3::date AND "recordedAt" < $3::date + 7 ORDER BY "recordedAt" LIMIT 1`,
        [userId, r.symbol, r.target]
      );
      if (!p.rows[0]) {
        // shortcut: a holding sold before the mark has no snapshots, so it ends as 'no-price'; fetch a historical quote if that matters.
        const late = (new Date(today) - new Date(r.target)) / 86400000 >= LATE_DAYS;
        if (late) await pool.query(`UPDATE share_signal_calls SET s${h}='no-price' WHERE id=$1`, [r.id]);
        continue;
      }
      const ret = Number(p.rows[0].priceAud) / Number(r.priceAud) - 1;
      let bench = null;
      if (r.benchSymbol && r.benchAud > 0) {
        const b = await pool.query(
          `SELECT "closeAud" FROM share_benchmark_closes WHERE symbol=$1 AND "closeAud" IS NOT NULL
             AND "tradingDay" <= $2::date AND "tradingDay" > $2::date - 7 ORDER BY "tradingDay" DESC LIMIT 1`,
          [r.benchSymbol, r.target]
        );
        if (b.rows[0]) bench = Number(b.rows[0].closeAud) / Number(r.benchAud) - 1;
      }
      await pool.query(`UPDATE share_signal_calls SET ret${h}=$2, bench${h}=$3, s${h}='scored' WHERE id=$1`, [r.id, ret, bench]);
      scored += 1;
    }
  }

  // A news signal that is right less than 40% of the time over 20+ calls is worth knowing about.
  const card = summarise(await loadCalls(userId));
  const g = card.groups.filter((x) => x.source === 'briefing');
  const n = g.reduce((s, x) => s + x.h30.n, 0);
  const hits = g.reduce((s, x) => s + x.h30.hits, 0);
  await captureIf(n >= 20 && hits / n < 0.4, {
    userId, source: 'sharesScorecard', category: 'alert',
    fingerprint: makeFingerprint('sharesScorecard', `briefing-accuracy:${today.slice(0, 7)}`),
    title: `News signals right only ${Math.round((hits / n) * 100)}% of the time after 30 days`,
    body: `${hits} of ${n} bullish/bearish news signals matched how the share did against its index 30 days later. Read them as a summary of the day's news, not a guide to what comes next. See Shares → Thesis → Track record.`,
  }).catch(() => {});
  return scored;
}

async function loadCalls(userId, { symbol, exchange } = {}) {
  const params = [userId];
  let where = '"userId"=$1';
  if (symbol) { params.push(String(symbol).toUpperCase(), String(exchange || '').toUpperCase()); where += ' AND symbol=$2 AND exchange=$3'; }
  const { rows } = await pool.query(`SELECT * FROM share_signal_calls WHERE ${where} ORDER BY "calledOn" DESC LIMIT 5000`, params);
  return rows;
}

/** Group calls by source and call word, with right/wrong counts and average edge per horizon. Pure. */
function summarise(rows) {
  const map = new Map();
  let pending = 0;
  for (const r of rows) {
    const key = `${r.source}:${r.call}`;
    if (!map.has(key)) map.set(key, { source: r.source, call: r.call, label: LABEL[key] || key, total: 0, h30: null, h90: null, _e: {} });
    const g = map.get(key);
    g.total += 1;
    if (r.s30 === 'pending') pending += 1;
    for (const h of HORIZONS) {
      const acc = g._e[h] || (g._e[h] = { n: 0, hits: 0, edges: [] });
      if (r[`s${h}`] !== 'scored') continue;
      const ret = r[`ret${h}`] == null ? null : Number(r[`ret${h}`]);
      const bench = r[`bench${h}`] == null ? null : Number(r[`bench${h}`]);
      const hit = judge(r.call, ret, bench);
      if (hit == null) continue;
      acc.n += 1;
      if (hit) acc.hits += 1;
      acc.edges.push(bench == null ? ret : ret - bench);
    }
  }
  const groups = [...map.values()].map(({ _e, ...g }) => {
    for (const h of HORIZONS) {
      const a = _e[h] || { n: 0, hits: 0, edges: [] };
      g[`h${h}`] = { n: a.n, hits: a.hits, hitRate: a.n ? a.hits / a.n : null, avgEdgePct: a.n ? (a.edges.reduce((s, x) => s + x, 0) / a.n) * 100 : null };
    }
    return g;
  }).sort((a, b) => a.label.localeCompare(b.label));
  return { groups, pending, total: rows.length };
}

/** The block the thesis check sees. Pure. */
function formatTrackRecord(all, mine, symbol) {
  const line = (g) => HORIZONS.map((h) => {
    const x = g[`h${h}`];
    return x.n ? `${h}d: ${x.hits}/${x.n} right (${Math.round(x.hitRate * 100)}%), avg ${x.avgEdgePct >= 0 ? '+' : ''}${x.avgEdgePct.toFixed(1)}% vs index` : `${h}d: none scored`;
  }).join('; ');
  const L = ['\n\n=== TRACK RECORD OF THIS APP\'S PAST CALLS (calibration, not evidence; see rule 10) ==='];
  const block = (title, card) => {
    L.push(title);
    const scored = card.groups.filter((g) => g.h30.n || g.h90.n);
    if (!scored.length) L.push('  (nothing scored yet)');
    for (const g of scored) L.push(`  ${g.label}: ${line(g)}`);
  };
  block(`For ${symbol}:`, mine);
  block('All holdings:', all);
  return L.join('\n');
}

module.exports = { HORIZONS, thesisCall, judge, recordCall, scoreDue, loadCalls, summarise, formatTrackRecord };
