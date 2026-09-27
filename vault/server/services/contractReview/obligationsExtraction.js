'use strict';

// Contract Review — Pipeline stage 8 (Obligations extraction). Ambiguous
// timing -> recorded with the clearest available shape (anchor+offset over a
// guessed absolute date), never invented. Ambiguous/unattributable obligor
// -> left null, never guessed (UI shows "obligor unresolved").

const crypto = require('crypto');
const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { recordRawOutput } = require('./rawOutputs');
const { verifyQuote } = require('./grounding');
const { normalizeName } = require('./partiesKeyTerms');
const { trackCost, LLM_CALL_TIMEOUT_MS } = require('./costTracking');
const { obligationsPrompt, PROMPT_VERSION } = require('./prompts/v1');

const ANCHOR_EVENTS = new Set(['effective_date', 'renewal_date', 'invoice_date', 'termination', 'custom']);
const OBLIGATION_TYPES = new Set(['payment', 'notice', 'renewal', 'delivery', 'reporting', 'other']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Finds the prior document in this document's chain (via parentDocumentId)
 * and, if it has a completed review, returns its obligations for lineage
 * matching. Heuristic: normalized-description match, same spirit as clause
 * lineage matching (spec: "heuristic-matched... number label, heading, text
 * similarity" for clauses — obligations use description text similarity). */
async function findPriorObligations(documentId) {
  const { rows: [doc] } = await pool.query(`SELECT "parentDocumentId" FROM contract_documents WHERE id=$1`, [documentId]);
  if (!doc || !doc.parentDocumentId) return [];
  const { rows: [priorReview] } = await pool.query(
    `SELECT id FROM contract_reviews WHERE "documentId"=$1 AND status='complete' ORDER BY "createdAt" DESC LIMIT 1`,
    [doc.parentDocumentId]
  );
  if (!priorReview) return [];
  const { rows } = await pool.query(`SELECT * FROM contract_obligations WHERE "reviewId"=$1`, [priorReview.id]);
  return rows;
}

function normalizeDescription(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function matchLineage(description, priorObligations) {
  const norm = normalizeDescription(description);
  const match = priorObligations.find((o) => normalizeDescription(o.description) === norm);
  return match ? match.lineageId : crypto.randomUUID();
}

async function extractObligations(reviewId, { contractId, documentId, extractedText, userId, costTracker }) {
  const { rows: parties } = await pool.query(`SELECT * FROM contract_parties WHERE "contractId"=$1`, [contractId]);
  const partyByNorm = new Map(parties.map((p) => [normalizeName(p.name), p]));

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  const modelId = resolved || 'none';
  let rawObligations = [];

  if (resolved) {
    try {
      const prompt = obligationsPrompt(extractedText, parties.map((p) => p.name));
      const result = await callModel(resolved, prompt, { maxTokens: 2000, returnUsage: true, timeoutMs: LLM_CALL_TIMEOUT_MS });
      const text = result.text;
      if (costTracker) await trackCost(costTracker, reviewId, modelId, result);
      const parsed = parseModelJson(text);
      await recordRawOutput({ reviewId, stage: 'extracting_obligations', modelId, promptVersion: PROMPT_VERSION, rawResponse: { prompt: prompt.slice(0, 500), text, parsed } });
      if (parsed && Array.isArray(parsed.obligations)) rawObligations = parsed.obligations;
    } catch (err) {
      // Any failure aborts the whole review now — see definitionsExtraction.js's header comment for why.
      await recordRawOutput({ reviewId, stage: 'extracting_obligations', modelId, promptVersion: PROMPT_VERSION, rawResponse: { error: err.message } });
      throw err;
    }
  }

  const priorObligations = await findPriorObligations(documentId);
  const inserted = [];

  for (const raw of rawObligations) {
    const description = String(raw?.description || '').trim();
    if (!description) continue;
    const type = OBLIGATION_TYPES.has(raw?.type) ? raw.type : 'other';
    const obligorPartyId = raw?.obligorName ? (partyByNorm.get(normalizeName(raw.obligorName))?.id || null) : null;

    // Precedence when the model returns more than one shape at once (it's
    // asked for exactly one, but real responses sometimes redundantly fill
    // in more — confirmed live: a monthly rent obligation came back with
    // BOTH a valid rrule AND anchorEvent:'custom'/offsetDays for the same
    // "day of month" fact). rrule wins first — it's only ever present when
    // the model recognized genuine recurrence language, the strongest
    // signal of the three. absoluteDate is checked last, matching the
    // spec's own "anchor+offset over a guessed absolute date" preference.
    const rrule = raw?.rrule ? String(raw.rrule).slice(0, 200) : null;
    const anchorEvent = !rrule && ANCHOR_EVENTS.has(raw?.anchorEvent) ? raw.anchorEvent : null;
    const absoluteDate = !rrule && !anchorEvent && DATE_RE.test(raw?.absoluteDate) ? raw.absoluteDate : null;
    const anchorCustomLabel = anchorEvent === 'custom' && raw?.anchorCustomLabel ? String(raw.anchorCustomLabel).slice(0, 200) : null;
    // raw?.offsetDays != null guards against Number(null) === 0 being
    // treated as a real, finite offset — a real bug found alongside the
    // above (an obligation with no stated offset was getting offsetDays=0
    // instead of null, inventing a value that was never in the source).
    const offsetDays = anchorEvent && raw?.offsetDays != null && Number.isFinite(Number(raw.offsetDays)) ? Math.round(Number(raw.offsetDays)) : null;

    const amount = Number.isFinite(Number(raw?.amount)) && raw?.amount != null ? Number(raw.amount) : null;
    const currency = typeof raw?.currency === 'string' && raw.currency.trim() ? raw.currency.trim().slice(0, 3).toUpperCase() : null;

    const quotedTextRaw = raw?.quotedText ? String(raw.quotedText).trim() : null;
    let spanStart = null, spanEnd = null, verificationStatus = null;
    if (quotedTextRaw) {
      ({ spanStart, spanEnd, verificationStatus } = verifyQuote(extractedText, quotedTextRaw));
    }

    const lineageId = matchLineage(description, priorObligations);

    const { rows } = await pool.query(
      `INSERT INTO contract_obligations
         ("reviewId", "contractId", "lineageId", "obligorPartyId", type, description,
          "absoluteDate", "anchorEvent", "anchorCustomLabel", "offsetDays", rrule,
          amount, currency, "quotedText", "spanStart", "spanEnd", "verificationStatus")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [reviewId, contractId, lineageId, obligorPartyId, type, description,
        absoluteDate, anchorEvent, anchorCustomLabel, offsetDays, rrule,
        amount, currency, quotedTextRaw, spanStart, spanEnd, verificationStatus]
    );
    inserted.push(rows[0]);
  }
  return inserted;
}

module.exports = { extractObligations };
