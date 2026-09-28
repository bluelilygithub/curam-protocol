'use strict';

// Contract Review — "What changed" view between a document revision and its
// previous version's current review. This is a stateless, on-demand
// comparison, NOT the spec's deferred contract_clauses.priorClauseId/
// redlineOutcome lineage system (see docs/contract-review-spec.md's
// Decisions Log, "known gap" item 9) — that system requires real
// cross-review lineage matching written back onto immutable rows at
// segmentation time, a genuinely separate, larger piece of work. This
// answers the practical "what changed" need directly by computing the diff
// fresh each time it's requested, matched by numberLabel first (most
// reliable) then text similarity for anything unmatched (renumbered/
// reordered/unlabeled clauses) — nothing is written back to any row.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');

const SIMILARITY_THRESHOLD = 0.5;

function normalizeWords(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function jaccardSimilarity(aWords, bWords) {
  const aSet = new Set(aWords);
  const bSet = new Set(bWords);
  let intersection = 0;
  for (const w of aSet) if (bSet.has(w)) intersection += 1;
  const union = aSet.size + bSet.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Matches old-review clauses to new-review clauses: exact numberLabel
 * first (the reliable signal when a document keeps its numbering), then
 * text-similarity for whatever's left (a renumbered or reordered clause).
 * Anything left unmatched on the old side is 'removed'; on the new side is
 * 'added'. */
function matchClauses(oldClauses, newClauses) {
  const oldRemaining = new Map(oldClauses.map((c) => [c.id, c]));
  const newRemaining = new Map(newClauses.map((c) => [c.id, c]));
  const pairs = [];

  for (const nc of newClauses) {
    if (!nc.numberLabel) continue;
    const oc = [...oldRemaining.values()].find((o) => o.numberLabel === nc.numberLabel);
    if (oc) {
      pairs.push({ old: oc, new: nc });
      oldRemaining.delete(oc.id);
      newRemaining.delete(nc.id);
    }
  }

  for (const nc of [...newRemaining.values()]) {
    const nWords = normalizeWords(nc.text);
    let best = null;
    let bestScore = 0;
    for (const oc of oldRemaining.values()) {
      const score = jaccardSimilarity(nWords, normalizeWords(oc.text));
      if (score > bestScore) { bestScore = score; best = oc; }
    }
    if (best && bestScore >= SIMILARITY_THRESHOLD) {
      pairs.push({ old: best, new: nc });
      oldRemaining.delete(best.id);
      newRemaining.delete(nc.id);
    }
  }

  for (const oc of oldRemaining.values()) pairs.push({ old: oc, new: null });
  for (const nc of newRemaining.values()) pairs.push({ old: null, new: nc });
  return pairs;
}

/** Simple LCS-based word-level diff — good enough for a legal clause's
 * length (a paragraph or two), not built for huge documents. */
function wordDiff(oldText, newText) {
  const a = String(oldText || '').split(/(\s+)/).filter((t) => t !== '');
  const b = String(newText || '').split(/(\s+)/).filter((t) => t !== '');
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ type: 'equal', text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'remove', text: a[i] }); i += 1; }
    else { ops.push({ type: 'add', text: b[j] }); j += 1; }
  }
  while (i < m) { ops.push({ type: 'remove', text: a[i] }); i += 1; }
  while (j < n) { ops.push({ type: 'add', text: b[j] }); j += 1; }
  return ops;
}

/** A short plain-English gloss on top of the structural diff — degrades
 * gracefully (returns null, doesn't throw) if no model is configured or the
 * call fails, since the structural diff (added/removed/changed + word diff)
 * is already useful on its own and this is generated fresh per request, not
 * written to any immutable row. */
async function generateChangeSummary(diffItems, reviewId, userId) {
  const changed = diffItems.filter((d) => d.status !== 'unchanged');
  if (!changed.length) return 'No clauses changed between these two versions.';

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  if (!resolved) return null;

  const lines = changed.map((d) => {
    if (d.status === 'added') return `ADDED ${d.numberLabel || '(unlabeled)'}: ${d.newText.slice(0, 300)}`;
    if (d.status === 'removed') return `REMOVED ${d.numberLabel || '(unlabeled)'} (was ${d.oldRiskLevel || 'unscored'}): ${d.oldText.slice(0, 300)}`;
    return `CHANGED ${d.numberLabel || '(unlabeled)'} (was ${d.oldRiskLevel || 'unscored'}, now ${d.newRiskLevel || 'unscored'}):\nOLD: ${d.oldText.slice(0, 300)}\nNEW: ${d.newText.slice(0, 300)}`;
  }).join('\n\n');

  const prompt = `Below is a list of clause changes between two drafts of the same contract. Write a short (3-6 sentence) plain-English summary of what changed overall, and specifically call out whether any clause that was previously "risky" is no longer risky in the new version (addressed) or is still risky (not addressed).

${lines}

Respond as JSON: {"summary": "<plain text>"}
Respond with ONLY valid JSON — no markdown fences, no commentary before or after.`;

  try {
    const text = await callModel(resolved, prompt, { maxTokens: 700, timeoutMs: LLM_CALL_TIMEOUT_MS });
    const parsed = parseModelJson(text);
    await recordRawOutput({ reviewId, stage: 'compare', modelId: resolved, promptVersion: 'compare-v1', rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
    return parsed?.summary ? String(parsed.summary).trim() : null;
  } catch (err) {
    await recordRawOutput({ reviewId, stage: 'compare', modelId: resolved, promptVersion: 'compare-v1', rawResponse: { error: err.message } });
    return null;
  }
}

/** Loads both reviews' clauses and returns the matched, sorted diff —
 * shared by the quick adjacent-version "What changed" view and the full
 * Compare-revisions tab below. Pure structural diff, no LLM call. */
async function buildDiff(oldReviewId, newReviewId) {
  const [{ rows: oldClauses }, { rows: newClauses }] = await Promise.all([
    pool.query(`SELECT id, ordinal, "numberLabel", text, "riskLevel" FROM contract_clauses WHERE "reviewId"=$1 AND "isContextOnly"=FALSE ORDER BY ordinal`, [oldReviewId]),
    pool.query(`SELECT id, ordinal, "numberLabel", text, "riskLevel" FROM contract_clauses WHERE "reviewId"=$1 AND "isContextOnly"=FALSE ORDER BY ordinal`, [newReviewId]),
  ]);

  const pairs = matchClauses(oldClauses, newClauses);
  const diffItems = pairs.map(({ old: oc, new: nc }) => {
    if (!oc) return { status: 'added', numberLabel: nc.numberLabel, newText: nc.text, newRiskLevel: nc.riskLevel, newOrdinal: nc.ordinal };
    if (!nc) return { status: 'removed', numberLabel: oc.numberLabel, oldText: oc.text, oldRiskLevel: oc.riskLevel, oldOrdinal: oc.ordinal };
    if (oc.text === nc.text) return { status: 'unchanged', numberLabel: nc.numberLabel, riskLevel: nc.riskLevel, text: nc.text, oldOrdinal: oc.ordinal, newOrdinal: nc.ordinal };
    return {
      status: 'changed', numberLabel: nc.numberLabel,
      oldText: oc.text, newText: nc.text, oldRiskLevel: oc.riskLevel, newRiskLevel: nc.riskLevel,
      oldOrdinal: oc.ordinal, newOrdinal: nc.ordinal,
      diff: wordDiff(oc.text, nc.text),
    };
  });
  // Stable read order: added/removed/changed first (what a reviewer
  // actually needs to look at), unchanged clauses last.
  const order = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  diffItems.sort((a, b) => order[a.status] - order[b.status]);
  return diffItems;
}

/** Re-orders a diff into actual document reading order (the new document's
 * clause order, with removed-only clauses interleaved back in near the
 * surviving clause they originally followed) — buildDiff's own order above
 * is deliberately status-grouped (changes first) for the condensed view, but
 * a side-by-side "two documents" view needs to read top-to-bottom like the
 * real contract, not with every change front-loaded. Removed clauses sort
 * just after the nearest preceding clause that survived into the new
 * version, via a fractional key so several consecutive removals between the
 * same two survivors still land in their own original order. */
function toDocumentOrder(diffItems) {
  const survivedByOldOrdinal = new Map();
  for (const d of diffItems) {
    if (d.oldOrdinal != null && d.newOrdinal != null) survivedByOldOrdinal.set(d.oldOrdinal, d.newOrdinal);
  }
  const keyed = diffItems.map((d) => {
    if (d.newOrdinal != null) return { d, key: d.newOrdinal };
    let anchorNewOrdinal = 0;
    for (let o = d.oldOrdinal - 1; o >= 1; o -= 1) {
      if (survivedByOldOrdinal.has(o)) { anchorNewOrdinal = survivedByOldOrdinal.get(o); break; }
    }
    return { d, key: anchorNewOrdinal + d.oldOrdinal * 1e-6 };
  });
  keyed.sort((a, b) => a.key - b.key);
  return keyed.map((k) => k.d);
}

/**
 * @param {number} documentId - the revision to compare (must have a
 *   parentDocumentId and a completed review of its own)
 * @param {number} userId
 * @returns {Promise<{diffItems: Array, summary: string|null}>}
 */
async function compareToPreviousVersion(documentId, userId) {
  const { rows: [doc] } = await pool.query(`SELECT "parentDocumentId" FROM contract_documents WHERE id=$1`, [documentId]);
  if (!doc) throw new Error(`Document ${documentId} not found`);
  if (!doc.parentDocumentId) throw new Error('This document has no previous version to compare against');

  const { rows: [currentReview] } = await pool.query(
    `SELECT id FROM contract_reviews WHERE "documentId"=$1 AND status='complete' ORDER BY "createdAt" DESC LIMIT 1`,
    [documentId]
  );
  if (!currentReview) throw new Error('This document has no completed review yet');

  const { rows: [priorReview] } = await pool.query(
    `SELECT id FROM contract_reviews WHERE "documentId"=$1 AND status='complete' ORDER BY "createdAt" DESC LIMIT 1`,
    [doc.parentDocumentId]
  );
  if (!priorReview) throw new Error('The previous version has no completed review to compare against');

  const diffItems = await buildDiff(priorReview.id, currentReview.id);
  const summary = await generateChangeSummary(diffItems, currentReview.id, userId);
  return { diffItems, summary };
}

// Deterministic — never asks the model to re-derive a risk classification it
// already scored (and verified/grounded) during the original review. 'new_risk'
// covers both a brand-new risky/unclear clause and a removed clause is always
// 'improved' (a risk that existed no longer does) or 'unchanged' if it was
// never risky to begin with.
const RISK_RANK = { standard: 0, unclear: 1, risky: 2 };
function computeRiskImpact(item) {
  if (item.status === 'unchanged') return 'unchanged';
  if (item.status === 'added') return (RISK_RANK[item.newRiskLevel] ?? 0) >= 1 ? 'new_risk' : 'unchanged';
  if (item.status === 'removed') return (RISK_RANK[item.oldRiskLevel] ?? 0) >= 1 ? 'improved' : 'unchanged';
  const o = RISK_RANK[item.oldRiskLevel] ?? 0, n = RISK_RANK[item.newRiskLevel] ?? 0;
  if (o === n) return 'unchanged';
  return n < o ? 'improved' : 'worsened';
}

/** The two genuinely interpretive fields a UX review asked for — which party
 * a wording change favors, and what to do about it — layered on top of the
 * DETERMINISTIC riskImpact above rather than replacing it. Advisory only,
 * same convention as suggestedRedline elsewhere in this feature: never
 * treated as authoritative, always shown alongside (never instead of) the
 * actual clause text. Degrades gracefully (all items get riskImpact only)
 * if no model is configured or the call fails. */
async function analyzeChangeImpact(diffItems, { reviewId, userId, partyName, partyRole }) {
  const actionable = diffItems.filter((d) => d.status !== 'unchanged');
  if (!actionable.length) return new Map();

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  if (!resolved) return new Map();

  const perspective = partyName ? `${partyName} (${partyRole || 'unspecified role'})` : 'an unspecified party';
  const lines = actionable.map((d, i) => {
    if (d.status === 'added') return `[${i}] ADDED ${d.numberLabel || '(unlabeled)'} (${d.newRiskLevel || 'unscored'}): ${d.newText.slice(0, 400)}`;
    if (d.status === 'removed') return `[${i}] REMOVED ${d.numberLabel || '(unlabeled)'} (was ${d.oldRiskLevel || 'unscored'}): ${d.oldText.slice(0, 400)}`;
    return `[${i}] CHANGED ${d.numberLabel || '(unlabeled)'} (${d.oldRiskLevel || 'unscored'} -> ${d.newRiskLevel || 'unscored'}):\nOLD: ${d.oldText.slice(0, 400)}\nNEW: ${d.newText.slice(0, 400)}`;
  }).join('\n\n');

  const prompt = `You are assisting ${perspective} in reviewing changes between two drafts of a contract. Below is a numbered list of clause-level changes. For EACH numbered item, judge it specifically from ${perspective}'s perspective:
- partyImpact: one short sentence (max ~15 words) on who benefits or assumes more responsibility as a result of this specific change, from ${perspective}'s point of view.
- recommendedAction: exactly one of "accept" (fine as-is), "negotiate" (push back / propose different wording), or "investigate" (unclear enough to need more context or advice before deciding).
- recommendedActionNote: one short sentence (max ~15 words) on why.

${lines}

Respond as JSON: {"items": [{"index": 0, "partyImpact": "...", "recommendedAction": "accept|negotiate|investigate", "recommendedActionNote": "..."}, ...]} — one entry per numbered item above, in any order.
Respond with ONLY valid JSON — no markdown fences, no commentary before or after.`;

  try {
    const text = await callModel(resolved, prompt, { maxTokens: 1500, timeoutMs: LLM_CALL_TIMEOUT_MS });
    const parsed = parseModelJson(text);
    await recordRawOutput({ reviewId, stage: 'compare_impact', modelId: resolved, promptVersion: 'compare-impact-v1', rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
    const byIndex = new Map();
    const VALID_ACTIONS = new Set(['accept', 'negotiate', 'investigate']);
    for (const item of (parsed?.items || [])) {
      const idx = Number(item?.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= actionable.length) continue;
      byIndex.set(actionable[idx], {
        partyImpact: item.partyImpact ? String(item.partyImpact).trim().slice(0, 300) : null,
        recommendedAction: VALID_ACTIONS.has(item.recommendedAction) ? item.recommendedAction : null,
        recommendedActionNote: item.recommendedActionNote ? String(item.recommendedActionNote).trim().slice(0, 300) : null,
      });
    }
    return byIndex;
  } catch (err) {
    await recordRawOutput({ reviewId, stage: 'compare_impact', modelId: resolved, promptVersion: 'compare-impact-v1', rawResponse: { error: err.message } });
    return new Map();
  }
}

/** Full Compare-revisions tab: any two reviews under the same contract (not
 * just adjacent parent/child versions), enriched with deterministic
 * riskImpact plus advisory partyImpact/recommendedAction. Both review ids
 * are verified to belong to contractId here — a route-level
 * assertContractAccess alone isn't enough, since a review id from a
 * DIFFERENT contract the same user owns would otherwise slip through
 * unchecked (the same class of gap fixed in ContractService.recordCorrection). */
async function compareReviewsFull({ contractId, oldReviewId, newReviewId, userId }) {
  const { rows } = await pool.query(
    `SELECT r.id, r."userPartyId", r.status, d."contractId", d.id AS "documentId", d.version, d.filename,
            p.name AS "partyName", p.role AS "partyRole"
     FROM contract_reviews r
     JOIN contract_documents d ON d.id = r."documentId"
     LEFT JOIN contract_parties p ON p.id = r."userPartyId"
     WHERE r.id = ANY($1::int[])`,
    [[oldReviewId, newReviewId]]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const oldReview = byId.get(Number(oldReviewId));
  const newReview = byId.get(Number(newReviewId));
  if (!oldReview || !newReview) throw new Error('One or both reviews were not found');
  if (oldReview.contractId !== contractId || newReview.contractId !== contractId) {
    throw new Error('Both reviews must belong to this contract');
  }
  if (oldReview.status !== 'complete' || newReview.status !== 'complete') {
    throw new Error('Both reviews must be complete before comparing');
  }

  const diffItems = await buildDiff(oldReview.id, newReview.id);
  for (const item of diffItems) item.riskImpact = computeRiskImpact(item);

  const perspectiveMismatch = oldReview.userPartyId !== newReview.userPartyId;
  // Independent LLM calls over the same already-computed diffItems — run
  // concurrently rather than paying the sum of both round-trips.
  const [impactByItem, summary] = await Promise.all([
    analyzeChangeImpact(diffItems, { reviewId: newReview.id, userId, partyName: newReview.partyName, partyRole: newReview.partyRole }),
    generateChangeSummary(diffItems, newReview.id, userId),
  ]);
  for (const item of diffItems) {
    const impact = impactByItem.get(item);
    item.partyImpact = impact?.partyImpact || null;
    item.recommendedAction = impact?.recommendedAction || null;
    item.recommendedActionNote = impact?.recommendedActionNote || null;
  }

  return {
    diffItems,
    diffItemsDocumentOrder: toDocumentOrder(diffItems),
    summary,
    perspectiveMismatch,
    oldReview: { id: oldReview.id, documentId: oldReview.documentId, version: oldReview.version, filename: oldReview.filename, partyName: oldReview.partyName, partyRole: oldReview.partyRole },
    newReview: { id: newReview.id, documentId: newReview.documentId, version: newReview.version, filename: newReview.filename, partyName: newReview.partyName, partyRole: newReview.partyRole },
  };
}

module.exports = { compareToPreviousVersion, compareReviewsFull, computeRiskImpact, matchClauses, wordDiff };
