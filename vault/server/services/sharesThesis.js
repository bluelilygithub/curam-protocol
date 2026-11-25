'use strict';

// Shares → Thesis tab: one written thesis per holding (why I own it, 3-7 testable assumptions, red lines, valuation anchors) and a
// "Check" that asks a model whether the stored evidence still supports it. Idea borrowed from the thesis-tracker / thesis-drift skills of
// github.com/xbtlin/ai-berkshire (MIT), rewritten for Vault. See docs/shares-thesis.md.
//
// Rules this file enforces in code, not only in the prompt:
//  - The check never says buy, sell or hold and never predicts a price (the prompt forbids it and the verdict words cannot carry it).
//  - A rating other than "intact" or "unclear" must come with evidence; without it the rating is downgraded to "unclear".
//  - The health score and the verdict are worked out here from the ratings, never taken from the model.
//  - A price move alone is not evidence against a business assumption (prompt rule; the drift dimension "valuation" is the place for price).

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser, pickTextModel } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const sharesPortfolio = require('./sharesPortfolio');
const { getBriefingsForUser, getWorkspaceTimezone, getDateInTz, sectorBenchmarkFor } = require('./sharesNewsService');
const scorecard = require('./sharesSignalScorecard');
const { getFundamentals } = require('./marketData');
const { capture, makeFingerprint } = require('./SuggestionService');

const MAX_ITEMS = 7;
const RATINGS = ['intact', 'weakening', 'impaired', 'broken', 'unclear'];
const DEDUCT = { weakening: 1, impaired: 2, broken: 3 };
const RED_LINE_DEDUCT = 3;
const DRIFT_DIMENSIONS = ['valuation', 'assumptions', 'red lines', 'management', 'moat'];
const DRIFT_CHANGES = ['improved', 'unchanged', 'weakened', 'unclear'];

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Clean what the form sends. Returns { value } or { error }. */
function sanitizeThesisInput(body) {
  const b = body || {};
  const symbol = str(b.symbol, 20).toUpperCase();
  const exchange = str(b.exchange, 10).toUpperCase();
  if (!symbol) return { error: 'symbol is required' };
  const thesis = str(b.thesis, 600);
  const list = (arr, fields) => (Array.isArray(arr) ? arr : [])
    .slice(0, MAX_ITEMS)
    .map((it) => {
      const o = {};
      for (const [k, max] of Object.entries(fields)) o[k] = str(typeof it === 'string' && k === 'text' ? it : it?.[k], max);
      return o;
    })
    .filter((o) => o.text);
  const assumptions = list(b.assumptions, { text: 300, how: 200 });
  const redLines = list(b.redLines, { text: 300 });
  const a = b.anchors || {};
  const anchors = { optimistic: str(a.optimistic, 200), neutral: str(a.neutral, 200), pessimistic: str(a.pessimistic, 200) };
  const mirror = String(b.mirror == null ? '' : b.mirror).trim().slice(0, 1500);
  if (!thesis && !assumptions.length) return { error: 'write the thesis or at least one assumption' };
  const newRevision = b.newRevision === true;
  const revisionNote = str(b.revisionNote, 300);
  return { value: { symbol, exchange, thesis, assumptions, redLines, anchors, mirror, newRevision, revisionNote } };
}

/**
 * Turn the model's reply into a validated check. `thesis` is the stored thesis (the ratings must line up with its assumptions and red lines).
 * Never throws: anything unreadable becomes "unclear".
 */
function parseCheckReply(text, thesis) {
  const assumptions = thesis?.assumptions || [];
  const redLines = thesis?.redLines || [];
  let obj = null;
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { obj = null; }
  }
  obj = obj && typeof obj === 'object' ? obj : {};

  const ratings = assumptions.map((a, i) => {
    const found = (Array.isArray(obj.assumptions) ? obj.assumptions : []).find((r) => Number(r?.n) === i + 1) || {};
    let rating = RATINGS.includes(found.rating) ? found.rating : 'unclear';
    const evidence = str(found.evidence, 400);
    if (rating !== 'intact' && rating !== 'unclear' && !evidence) rating = 'unclear'; // no evidence, no change
    return { n: i + 1, text: a.text, rating, evidence };
  });

  const redLineHits = [];
  redLines.forEach((rl, i) => {
    const found = (Array.isArray(obj.redLines) ? obj.redLines : []).find((r) => Number(r?.n) === i + 1) || {};
    const evidence = str(found.evidence, 400);
    if (found.triggered === true && evidence) redLineHits.push({ n: i + 1, text: rl.text, evidence });
  });

  const drift = [];
  for (const dim of DRIFT_DIMENSIONS) {
    const found = (Array.isArray(obj.drift) ? obj.drift : []).find((d) => str(d?.dimension, 30).toLowerCase() === dim);
    if (!found) continue;
    let change = DRIFT_CHANGES.includes(found.change) ? found.change : 'unclear';
    const evidence = str(found.evidence, 400);
    if ((change === 'improved' || change === 'weakened') && !evidence) change = 'unclear';
    drift.push({ dimension: dim, change, evidence });
  }

  return {
    ratings,
    redLineHits,
    drift,
    summary: str(obj.summary, 1200),
    watchNext: str(obj.watchNext, 600),
    // Multi-paragraph, so keep line breaks (str() would flatten them).
    feedback: String(obj.feedback == null ? '' : obj.feedback).trim().slice(0, 3000),
  };
}

/** Health out of 10 and the overall verdict, from the ratings. Deterministic. */
function scoreCheck({ ratings = [], redLineHits = [] }) {
  let score = 10;
  for (const r of ratings) score -= DEDUCT[r.rating] || 0;
  score -= redLineHits.length * RED_LINE_DEDUCT;
  score = Math.max(0, score);
  const has = (w) => ratings.some((r) => r.rating === w);
  let verdict;
  if (!ratings.length) verdict = 'unclear';
  else if (redLineHits.length) verdict = 'red-line';
  else if (has('broken')) verdict = 'broken';
  else if (has('impaired') || score <= 5) verdict = 'impaired';
  else if (has('weakening')) verdict = 'weakening';
  else if (ratings.every((r) => r.rating === 'unclear')) verdict = 'unclear';
  else verdict = 'intact';
  return { healthScore: ratings.length ? score : null, verdict };
}

const SYSTEM_PROMPT = `You check whether a share investor's own written thesis still holds, using ONLY the evidence pack provided.

Rules:
1. Judge the thesis, not the share price. A price fall or rise is NOT evidence about a business assumption. Price belongs only in the "valuation" drift dimension.
2. Rate each numbered assumption: intact, weakening, impaired, broken or unclear. Use "unclear" whenever the pack has nothing relevant. Never guess. Any rating other than intact or unclear MUST quote the specific evidence from the pack (a briefing date and what it said, a trade, a figure).
3. A red line is triggered only if the pack shows it happening. Quote the evidence. Otherwise it is not triggered.
4. Never say buy, sell, hold, add or trim. Never predict a price. Never give tax advice.
5. If a PREVIOUS CHECK is given, compare to it. For each dimension (valuation, assumptions, red lines, management, moat) say improved, unchanged, weakened or unclear. Different wording alone is not a change; only changed evidence is.
6. Do not invent figures. Amounts are AUD unless noted. The pack comes from the app's stored data, news briefings and, for US shares, a FUNDAMENTALS block of reported figures from a data provider (margins, growth, valuation ratios, recent quarterly margins). Quote those figures as evidence where an assumption is about them; valuation ratios belong to the "valuation" drift dimension. The pack holds no company filings, guidance or management commentary, so say "unclear" rather than pretend to have read them.
7. Keep every evidence field under 300 characters and the summary under 6 sentences, in plain words.
8. "feedback" is your review of the CURRENT REVISION of the thesis itself, for the investor to reconsider it. In 2-4 short paragraphs (separate them with a blank line):
   - Is it clear and testable? Name any assumption that is vague, untestable or missing.
   - If EARLIER REVISIONS are given, refer to them by number ("revision 2 said ..."). Say what changed and whether the change follows new evidence or looks like moving the goalposts (an assumption softened, or a red line dropped, after evidence turned against it).
   - How the holding sits in the PORTFOLIO (its weight, overlap with other holdings) and how the MARKET CONDITIONS in the pack bear on the assumptions.
   - Questions worth answering before the next revision.
   Rule 4 still applies: frame it as questions and risks to weigh, never as an instruction to buy, sell or resize.
9. If a DEBATE is given, it is two one-sided arguments (a bear case and a bull case), NOT evidence. Weigh them, then rate only on what the evidence pack itself shows; a point either side makes without a pack item behind it counts for nothing. Where the bear case finds real evidence against an assumption, do not wave it away.
10. The TRACK RECORD shows how this app's past calls turned out: the share against its index 30 and 90 days later. It is calibration, NOT evidence about the business: never change a rating because of it. In "feedback", if past thesis concerns or news signals for this holding were mostly right or mostly wrong, say so in one sentence and word your summary with matching confidence. Under 5 scored calls, say the record is too small to read anything into.

Reply with ONLY one JSON object, no other text:
{"assumptions":[{"n":1,"rating":"intact|weakening|impaired|broken|unclear","evidence":"..."}],
 "redLines":[{"n":1,"triggered":false,"evidence":""}],
 "drift":[{"dimension":"valuation|assumptions|red lines|management|moat","change":"improved|unchanged|weakened|unclear","evidence":"..."}],
 "summary":"...","watchNext":"what to look at before the next check","feedback":"..."}`;

// Bull vs bear stress test before the check (the researcher debate from TradingAgents, arXiv 2412.20138, Apache-2.0; rewritten, not copied).
// Each side sees the same evidence pack and argues one way; the check above then judges. Framed against the thesis, never as a trade call.
const DEBATE_SYSTEM = {
  bear: 'argue as hard as the evidence allows that each assumption is weakening or broken and that each red line is close to being hit',
  bull: 'argue as hard as the evidence allows that each assumption still holds and that no red line is near',
};
function debateSystem(side) {
  return `You are the ${side.toUpperCase()} side in a stress test of a share investor's own written thesis. Using ONLY the evidence pack, ${DEBATE_SYSTEM[side]}.
Rules: cite each point to a pack item (a briefing date and what it said, a trade, a figure). If the pack has nothing for an assumption, say "nothing in the pack" rather than invent. A price move alone is not evidence about the business. Never say buy, sell, hold, add or trim, and never predict a price.
Reply in plain text: one short paragraph per numbered assumption ("1. ..."), then one line per red line ("R1. ..."). Under 300 words.`;
}

/** The debate block appended to the check prompt. Pure. */
function formatDebate({ bear, bull }) {
  if (!bear && !bull) return '';
  return `\n\n=== DEBATE (arguments, not evidence; see rule 9) ===\n-- BEAR CASE --\n${bear || '(not available)'}\n\n-- BULL CASE --\n${bull || '(not available)'}`;
}

const fmtAud = (n) => (n == null || Number.isNaN(Number(n)) ? 'n/a' : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtPct = (n) => (n == null || Number.isNaN(Number(n)) ? 'n/a' : `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`);
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/** The text the model sees. Pure: pass in what was loaded. */
function buildCheckPrompt({ thesis, position, trades, briefings, previous, today, revisions = [], portfolio = null, market = [], fundamentals = null }) {
  const L = [];
  L.push(`TODAY: ${today}`);
  L.push(`\n=== THE INVESTOR'S THESIS FOR ${thesis.symbol}${thesis.exchange ? `/${thesis.exchange}` : ''} (CURRENT REVISION ${thesis.revision || 1}) ===`);
  if (thesis.revisionNote) L.push(`What the investor said changed in this revision: ${thesis.revisionNote}`);
  L.push(`Why I own it: ${thesis.thesis || '(not written)'}`);
  L.push('Assumptions to test:');
  thesis.assumptions.forEach((a, i) => L.push(`  ${i + 1}. ${a.text}${a.how ? ` (how to verify: ${a.how})` : ''}`));
  if (!thesis.assumptions.length) L.push('  (none written)');
  L.push('Red lines (reasons the thesis is broken):');
  thesis.redLines.forEach((r, i) => L.push(`  ${i + 1}. ${r.text}`));
  if (!thesis.redLines.length) L.push('  (none written)');
  const an = thesis.anchors || {};
  if (an.optimistic || an.neutral || an.pessimistic) {
    L.push(`Valuation anchors: optimistic: ${an.optimistic || 'n/a'} | neutral: ${an.neutral || 'n/a'} | pessimistic: ${an.pessimistic || 'n/a'}`);
  }

  L.push('\n=== THE HOLDING NOW ===');
  if (position) {
    L.push(`qty=${position.quantity}, avgCost=${fmtAud(position.avgCostAud)}, price=${fmtAud(position.priceAud)}, value=${fmtAud(position.valueAud)}, unrealised=${fmtAud(position.pnlAud)} (${fmtPct(position.pnlPct)}), today=${fmtPct(position.dayChangePct)}`);
  } else {
    L.push('(not currently held, or no quote)');
  }

  if (portfolio?.totalValueAud > 0) {
    const total = portfolio.totalValueAud;
    const pct = (v) => `${((Number(v) || 0) / total * 100).toFixed(1)}%`;
    const held = (portfolio.positions || []).filter((p) => p.valueAud != null).sort((a, b) => b.valueAud - a.valueAud);
    L.push('\n=== PORTFOLIO ===');
    L.push(`total=${fmtAud(total)}, cash=${fmtAud(portfolio.cashAud)} (${pct(portfolio.cashAud)}), holdings=${held.length}${position?.valueAud != null ? `, ${thesis.symbol} weight=${pct(position.valueAud)}` : ''}`);
    L.push(`Largest holdings: ${held.slice(0, 8).map((p) => `${p.symbol} ${pct(p.valueAud)}`).join(', ') || '(none)'}`);
  }

  L.push('\n=== MARKET CONDITIONS (portfolio-level briefings, newest first) ===');
  if (!market.length) L.push('(none stored)');
  for (const b of market.slice(0, 5)) L.push(`${day(b.date)} ${b.type === 'monthly_summary' ? 'MONTHLY SUMMARY' : `signal=${b.signal || 'n/a'}`} — ${String(b.content || '').slice(0, 600)}`);

  if (revisions.length) {
    L.push(`\n=== EARLIER REVISIONS OF THIS THESIS (${revisions.length}, newest first) ===`);
    for (const r of revisions.slice(0, 5)) {
      L.push(`-- Revision ${r.revision} (written ${day(r.createdAt)})${r.note ? ` note: ${r.note}` : ''}`);
      L.push(`   Why: ${r.thesis || '(not written)'}`);
      (r.assumptions || []).forEach((a, i) => L.push(`   A${i + 1}. ${a.text}`));
      (r.redLines || []).forEach((x, i) => L.push(`   R${i + 1}. ${x.text}`));
    }
  }

  L.push(`\n=== TRADES IN ${thesis.symbol} (${trades.length}) ===`);
  if (!trades.length) L.push('(none)');
  for (const t of trades.slice(0, 30)) L.push(`${day(t.tradedAt)} ${String(t.side).toUpperCase()} ${t.quantity} @ ${fmtAud(t.pricePerShare)}`);

  L.push(`\n=== FUNDAMENTALS FOR ${thesis.symbol} (reported figures${fundamentals?.source ? ` from ${fundamentals.source}` : ''}, fetched ${today}; not filings) ===`);
  if (!fundamentals) L.push('(not available: figures are fetched for US shares only)');
  else {
    const fmt = (f) => (f.unit === '%' ? `${f.value.toFixed(1)}%` : f.unit === 'm' ? Math.round(f.value).toLocaleString('en-US') : `${f.value.toFixed(2)}x`);
    for (const f of fundamentals.figures || []) L.push(`${f.label}: ${fmt(f)}`);
    for (const t of fundamentals.trends || []) L.push(`${t.label} by quarter (newest first): ${t.points.map((p) => `${p.period} ${p.pct.toFixed(1)}%`).join(', ')}`);
  }

  L.push(`\n=== NEWS BRIEFINGS FOR ${thesis.symbol} (newest first, up to 20) ===`);
  if (!briefings.length) L.push('(none stored)');
  for (const b of briefings.slice(0, 20)) {
    L.push(`${day(b.date)} signal=${b.signal || 'n/a'} dayMove=${fmtPct(b.priceChangePct)} — ${String(b.content || '').slice(0, 400)}`);
  }

  if (previous) {
    L.push(`\n=== PREVIOUS CHECK (${day(previous.createdAt)}) ===`);
    L.push(`Verdict: ${previous.verdict}; health ${previous.healthScore}/10`);
    for (const r of previous.ratings || []) L.push(`  assumption ${r.n}: ${r.rating}${r.evidence ? ` — ${r.evidence}` : ''}`);
    if (previous.summary) L.push(`Summary then: ${previous.summary}`);
    const snap = previous.thesisSnapshot || {};
    if (snap.thesis && snap.thesis !== thesis.thesis) L.push(`Note: the investor rewrote the thesis text since then. It said: ${snap.thesis}`);
  } else {
    L.push('\n=== PREVIOUS CHECK ===\n(none: this is the first check, so leave "drift" as an empty list)');
  }
  return L.join('\n');
}

// ---- database ----

function mapThesis(r) {
  if (!r) return null;
  const j = (v, d) => (typeof v === 'string' ? JSON.parse(v) : v ?? d);
  return {
    id: r.id, symbol: r.symbol, exchange: r.exchange, thesis: r.thesis,
    assumptions: j(r.assumptions, []), redLines: j(r.redLines, []), anchors: j(r.anchors, {}), mirror: r.mirror,
    revision: r.revision || 1, revisionNote: r.revisionNote || '',
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function mapRevision(r) {
  const j = (v, d) => (typeof v === 'string' ? JSON.parse(v) : v ?? d);
  return {
    id: r.id, thesisId: r.thesisId, revision: r.revision, thesis: r.thesis, note: r.note,
    assumptions: j(r.assumptions, []), redLines: j(r.redLines, []), anchors: j(r.anchors, {}), mirror: r.mirror, createdAt: r.createdAt,
  };
}

function mapCheck(r) {
  if (!r) return null;
  const j = (v, d) => (typeof v === 'string' ? JSON.parse(v) : v ?? d);
  return {
    id: r.id, thesisId: r.thesisId, verdict: r.verdict, healthScore: r.healthScore,
    ratings: j(r.ratings, []), redLineHits: j(r.redLineHits, []), drift: j(r.drift, []),
    summary: r.summary, watchNext: r.watchNext, feedback: r.feedback || '', revision: r.revision ?? null,
    bearCase: r.bearCase || '', bullCase: r.bullCase || '',
    thesisSnapshot: j(r.thesisSnapshot, {}), model: r.model, createdAt: r.createdAt,
  };
}

/** All theses with their latest check, plus the open holdings that have no thesis yet. */
async function listTheses(userId) {
  const { rows } = await pool.query(`SELECT * FROM share_theses WHERE "userId"=$1 ORDER BY symbol, exchange`, [userId]);
  const latest = await pool.query(
    `SELECT DISTINCT ON ("thesisId") * FROM share_thesis_checks WHERE "userId"=$1 ORDER BY "thesisId", "createdAt" DESC`,
    [userId]
  );
  const byThesis = new Map(latest.rows.map((c) => [c.thesisId, mapCheck(c)]));
  const theses = rows.map((r) => ({ ...mapThesis(r), latestCheck: byThesis.get(r.id) || null }));
  let untracked = [];
  try {
    const dash = await sharesPortfolio.buildDashboard(userId);
    const have = new Set(theses.map((t) => `${t.symbol}:${t.exchange}`));
    untracked = (dash.positions || [])
      .filter((p) => !have.has(`${p.symbol}:${p.exchange}`))
      .map((p) => ({ symbol: p.symbol, exchange: p.exchange }));
  } catch (err) {
    console.warn('[sharesThesis] could not list holdings:', err.message);
  }
  return { theses, untracked };
}

async function listChecks(userId, thesisId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM share_thesis_checks WHERE "userId"=$1 AND "thesisId"=$2 ORDER BY "createdAt" DESC LIMIT $3`,
    [userId, thesisId, Math.min(Math.max(Number(limit) || 20, 1), 100)]
  );
  return rows.map(mapCheck);
}

/** Earlier (archived) revisions of a thesis, newest first. The current revision lives on share_theses. */
async function listRevisions(userId, thesisId) {
  const { rows } = await pool.query(
    `SELECT * FROM share_thesis_revisions WHERE "userId"=$1 AND "thesisId"=$2 ORDER BY revision DESC`,
    [userId, thesisId]
  );
  return rows.map(mapRevision);
}

/**
 * Create or replace the thesis for a holding. Returns the saved thesis.
 * With `newRevision`, the current wording is archived to share_thesis_revisions and the new one becomes revision N+1;
 * without it the current revision is edited in place (for typo fixes).
 */
async function saveThesis(userId, clean) {
  if (clean.newRevision) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const cur = (await db.query(
        `SELECT * FROM share_theses WHERE "userId"=$1 AND symbol=$2 AND exchange=$3 FOR UPDATE`,
        [userId, clean.symbol, clean.exchange]
      )).rows[0];
      if (cur) {
        await db.query(
          `INSERT INTO share_thesis_revisions ("thesisId","userId",revision,thesis,assumptions,"redLines",anchors,mirror,note,"createdAt")
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)`,
          [cur.id, userId, cur.revision || 1, cur.thesis, JSON.stringify(cur.assumptions ?? []), JSON.stringify(cur.redLines ?? []),
            JSON.stringify(cur.anchors ?? {}), cur.mirror, cur.revisionNote || '', cur.updatedAt]
        );
        const { rows } = await db.query(
          `UPDATE share_theses SET thesis=$2, assumptions=$3::jsonb, "redLines"=$4::jsonb, anchors=$5::jsonb, mirror=$6,
             revision=revision+1, "revisionNote"=$7, "updatedAt"=NOW()
           WHERE id=$1 RETURNING *`,
          [cur.id, clean.thesis, JSON.stringify(clean.assumptions), JSON.stringify(clean.redLines), JSON.stringify(clean.anchors),
            clean.mirror, clean.revisionNote]
        );
        await db.query('COMMIT');
        return mapThesis(rows[0]);
      }
      await db.query('ROLLBACK'); // nothing to archive yet: a plain create below
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  }
  const { rows } = await pool.query(
    `INSERT INTO share_theses ("userId", symbol, exchange, thesis, assumptions, "redLines", anchors, mirror)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
     ON CONFLICT ("userId", symbol, exchange) DO UPDATE SET
       thesis=EXCLUDED.thesis, assumptions=EXCLUDED.assumptions, "redLines"=EXCLUDED."redLines",
       anchors=EXCLUDED.anchors, mirror=EXCLUDED.mirror, "updatedAt"=NOW()
     RETURNING *`,
    [userId, clean.symbol, clean.exchange, clean.thesis, JSON.stringify(clean.assumptions), JSON.stringify(clean.redLines),
      JSON.stringify(clean.anchors), clean.mirror]
  );
  return mapThesis(rows[0]);
}

/** Run a check now: gather the stored evidence, ask the model, validate, score, save. */
async function runCheck(userId, thesisId) {
  const tr = await pool.query(`SELECT * FROM share_theses WHERE id=$1 AND "userId"=$2`, [thesisId, userId]);
  const thesis = mapThesis(tr.rows[0]);
  if (!thesis) throw Object.assign(new Error('Thesis not found'), { status: 404 });
  if (!thesis.assumptions.length) throw Object.assign(new Error('Add at least one assumption to check.'), { status: 400 });

  const tiers = await getModelsForUser(userId);
  const modelId = pickTextModel(tiers, 'standard');
  if (!modelId) throw new Error('No model configured — check vault_models in Settings');

  const [dash, tradeData, briefings, prevRows, revisions, allCalls, tz, fundamentals] = await Promise.all([
    sharesPortfolio.buildDashboard(userId),
    sharesPortfolio.getTradesAndLedger(userId),
    getBriefingsForUser(userId),
    pool.query(`SELECT * FROM share_thesis_checks WHERE "thesisId"=$1 AND "userId"=$2 ORDER BY "createdAt" DESC LIMIT 1`, [thesisId, userId]),
    listRevisions(userId, thesisId),
    scorecard.loadCalls(userId),
    getWorkspaceTimezone(),
    getFundamentals(thesis.symbol, thesis.exchange),
  ]);
  const same = (x) => String(x.symbol).toUpperCase() === thesis.symbol && String(x.exchange || '').toUpperCase() === thesis.exchange;
  const position = (dash.positions || []).find(same) || null;
  const trades = (tradeData.trades || []).filter(same);
  const dailies = (briefings || []).filter((b) => b.type === 'daily' && b.symbol && same(b));
  const previous = mapCheck(prevRows.rows[0]);
  const market = (briefings || []).filter((b) => !b.symbol && (b.type === 'daily' || b.type === 'monthly_summary'));

  const prompt = buildCheckPrompt({
    thesis, position, trades, briefings: dailies, previous, today: new Date().toISOString().slice(0, 10),
    revisions, portfolio: dash, market, fundamentals,
  });
  // shortcut: one parallel round (each side does not answer the other); add a rebuttal round if the cases read as talking past each other.
  const sides = await Promise.allSettled(['bear', 'bull'].map((side) =>
    callModel(modelId, prompt, { maxTokens: 1200, system: debateSystem(side), returnUsage: true })));
  const debate = {};
  sides.forEach((s, i) => {
    const side = i ? 'bull' : 'bear';
    if (s.status !== 'fulfilled') return console.warn(`[sharesThesis] ${side} case failed:`, s.reason?.message); // check still runs without it
    logUsage({ userId, model: modelId, inputTokens: s.value.inputTokens, outputTokens: s.value.outputTokens, latencyMs: s.value.latencyMs, feature: 'shares_thesis_debate' });
    debate[side] = String(s.value.text || '').trim().slice(0, 3000);
  });

  const trackRecord = scorecard.formatTrackRecord(
    scorecard.summarise(allCalls), scorecard.summarise(allCalls.filter(same)), thesis.symbol);
  const result = await callModel(modelId, prompt + formatDebate(debate) + trackRecord, { maxTokens: 4000, system: SYSTEM_PROMPT, returnUsage: true });
  logUsage({ userId, model: modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs, feature: 'shares_thesis_check' });

  const parsed = parseCheckReply(result.text, thesis);
  if (!previous) parsed.drift = []; // nothing to compare with on a first check
  const { healthScore, verdict } = scoreCheck(parsed);

  const ins = await pool.query(
    `INSERT INTO share_thesis_checks ("thesisId","userId",verdict,"healthScore",ratings,"redLineHits",drift,summary,"watchNext","thesisSnapshot",model,feedback,revision,"bearCase","bullCase")
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13,$14,$15) RETURNING *`,
    [thesisId, userId, verdict, healthScore, JSON.stringify(parsed.ratings), JSON.stringify(parsed.redLineHits), JSON.stringify(parsed.drift),
      parsed.summary, parsed.watchNext, JSON.stringify({ thesis: thesis.thesis, assumptions: thesis.assumptions, redLines: thesis.redLines }), modelId,
      parsed.feedback, thesis.revision, debate.bear || '', debate.bull || '']
  );
  const check = mapCheck(ins.rows[0]);

  // Signal scorecard: the verdict is a call to score later (unclear is not). Never fails the check.
  await scorecard.recordCall({
    userId, source: 'thesis', symbol: thesis.symbol, exchange: thesis.exchange, call: scorecard.thesisCall(verdict),
    priceAud: position?.priceAud, calledOn: getDateInTz(tz), benchKey: sectorBenchmarkFor(thesis.symbol, thesis.exchange).key,
  }).catch((err) => console.warn('[sharesThesis] scorecard record:', err.message));

  // A triggered red line or a broken/impaired thesis is something to triage: put it in the suggestions inbox.
  if (['red-line', 'broken', 'impaired'].includes(verdict)) {
    await capture({
      userId, source: 'sharesThesis', category: 'alert',
      fingerprint: makeFingerprint('sharesThesis', `${thesis.symbol}:${thesis.exchange}:${verdict}:${day(check.createdAt)}`),
      title: `${thesis.symbol} thesis check: ${verdict}`,
      body: `${parsed.summary || 'See the Thesis tab.'}${parsed.redLineHits.length ? `\nRed line hit: ${parsed.redLineHits.map((h) => h.text).join('; ')}` : ''}`,
      context: 'Shares → Thesis. This says whether your own thesis still holds, not whether to buy or sell.',
    }).catch(() => {});
  }
  return check;
}

module.exports = {
  RATINGS, DRIFT_DIMENSIONS, SYSTEM_PROMPT,
  sanitizeThesisInput, parseCheckReply, scoreCheck, buildCheckPrompt, debateSystem, formatDebate,
  listTheses, listChecks, listRevisions, saveThesis, runCheck, mapThesis,
};
