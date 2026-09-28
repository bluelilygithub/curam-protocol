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

  const [{ rows: oldClauses }, { rows: newClauses }] = await Promise.all([
    pool.query(`SELECT id, "numberLabel", text, "riskLevel" FROM contract_clauses WHERE "reviewId"=$1 AND "isContextOnly"=FALSE ORDER BY ordinal`, [priorReview.id]),
    pool.query(`SELECT id, "numberLabel", text, "riskLevel" FROM contract_clauses WHERE "reviewId"=$1 AND "isContextOnly"=FALSE ORDER BY ordinal`, [currentReview.id]),
  ]);

  const pairs = matchClauses(oldClauses, newClauses);
  const diffItems = pairs.map(({ old: oc, new: nc }) => {
    if (!oc) return { status: 'added', numberLabel: nc.numberLabel, newText: nc.text, newRiskLevel: nc.riskLevel };
    if (!nc) return { status: 'removed', numberLabel: oc.numberLabel, oldText: oc.text, oldRiskLevel: oc.riskLevel };
    if (oc.text === nc.text) return { status: 'unchanged', numberLabel: nc.numberLabel, riskLevel: nc.riskLevel };
    return {
      status: 'changed', numberLabel: nc.numberLabel,
      oldText: oc.text, newText: nc.text, oldRiskLevel: oc.riskLevel, newRiskLevel: nc.riskLevel,
      diff: wordDiff(oc.text, nc.text),
    };
  });
  // Stable read order: added/removed/changed first (what a reviewer
  // actually needs to look at), unchanged clauses last.
  const order = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  diffItems.sort((a, b) => order[a.status] - order[b.status]);

  const summary = await generateChangeSummary(diffItems, currentReview.id, userId);
  return { diffItems, summary };
}

module.exports = { compareToPreviousVersion, matchClauses, wordDiff };
