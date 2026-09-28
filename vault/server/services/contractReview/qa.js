'use strict';

// Contract Review — "Ask about this contract" Q&A. Stateless (no DB table,
// no persisted history) — same pattern as PDF Tools' "chat over an uploaded
// file" (docs/pdf-agent.md). Contract-scoped (not review-scoped): searches
// every document/revision under the contract, not just one review, since
// "the contract is the project" — the question might be about an earlier
// draft, or about how something changed between versions.
//
// Every answer that claims the contract addresses the question must carry
// an exact quote, verified the same way every other stage grounds a claim
// (grounding.js's verifyQuote) against the SPECIFIC document version it was
// drawn from — never against the combined multi-document blob, which could
// "verify" a quote that actually came from a different version than the one
// named. When the documents genuinely don't address the question, the model
// is asked to say so plainly instead of guessing.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { verifyQuote } = require('./grounding');
const { recordRawOutput } = require('./rawOutputs');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');

const PROMPT_VERSION = 'qa-v2';

function buildPrompt(docSections, question) {
  return `You are answering a question about a contract that may have multiple documents (amendments, exhibits, schedules) and multiple revisions (drafts). Use ONLY the text below — never outside knowledge, never assumptions about what a "normal" contract would say.

${docSections.join('\n\n')}

Question: ${question}

If the text answers this, give the answer AND:
- the EXACT quote (verbatim, copied exactly as it appears above, no paraphrasing) that supports it — this will be located and verified programmatically, so it must match the source exactly.
- which document version that quote came from (the version number shown in that document's "===" header above).
- if the answer references a risk judgment (a clause the review flagged as risky/unclear), name whose perspective (party name/role) that judgment was assessed from — shown in that document's "Risk assessment" notes, if present.

If the documents do NOT address this question at all, say so plainly (e.g. "None of these documents specify a notice period for this.") instead of guessing or inferring from what's typical.

Respond as JSON:
{
  "answeredByContract": true | false,
  "answer": "<plain-English answer, or an explanation of what isn't covered>",
  "documentVersion": <the version number the quote came from, or null>,
  "quotedText": "<EXACT verbatim quote from the text above, or null if answeredByContract is false>",
  "perspectiveNote": "<which party's perspective a referenced risk judgment was assessed from, or null if not applicable>"
}
Respond with ONLY valid JSON — no markdown fences, no commentary before or after.`;
}

/**
 * @param {number} contractId
 * @param {string} question
 * @param {number} userId
 * @returns {Promise<{answeredByContract: boolean, answer: string, documentVersion: number|null, perspectiveNote: string|null, quote: {text: string, verificationStatus: string}|null}>}
 */
async function askAboutContract(contractId, question, userId) {
  const q = String(question || '').trim();
  if (!q) throw new Error('A question is required');
  if (q.length > 1000) throw new Error('Question is too long (max 1000 characters)');

  const { rows: docs } = await pool.query(
    `SELECT id, filename, version, kind, "extractedText" FROM contract_documents WHERE "contractId"=$1 AND "extractedText" IS NOT NULL ORDER BY version ASC`,
    [contractId]
  );
  if (!docs.length) throw new Error('No documents with extracted text found for this contract yet.');

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  if (!resolved) {
    throw new Error('No Contract Review model is configured for this workspace — set one in Settings → AI & Chat → Contract Review model.');
  }

  // Each document's own current review's flagged (non-standard) clauses,
  // with whose perspective they were assessed from — gives the model
  // material to answer risk-related questions and cite perspective, per
  // document, rather than only raw contract text.
  const docSections = [];
  const latestReviewId = new Map(); // documentId -> reviewId, for recordRawOutput
  for (const doc of docs) {
    const { rows: [review] } = await pool.query(
      `SELECT r.id, p.name AS "partyName", p.role AS "partyRole"
       FROM contract_reviews r LEFT JOIN contract_parties p ON p.id = r."userPartyId"
       WHERE r."documentId"=$1 AND r.status='complete' ORDER BY r."createdAt" DESC LIMIT 1`,
      [doc.id]
    );
    let riskNotes = '';
    if (review) {
      latestReviewId.set(doc.id, review.id);
      const { rows: clauses } = await pool.query(
        `SELECT "numberLabel", "riskLevel", "whyItMatters" FROM contract_clauses WHERE "reviewId"=$1 AND "riskLevel" IS NOT NULL AND "riskLevel" != 'standard' ORDER BY ordinal`,
        [review.id]
      );
      if (clauses.length) {
        riskNotes = `\nRisk assessment for this document (reviewed from ${review.partyName || 'an unconfirmed party'}'s perspective as ${review.partyRole || 'an unresolved role'}):\n`
          + clauses.map((c) => `- ${c.numberLabel || '(unlabeled)'}: ${c.riskLevel}${c.whyItMatters ? ' — ' + c.whyItMatters : ''}`).join('\n');
      }
    }
    docSections.push(`=== Document: "${doc.filename}" (version ${doc.version}, ${doc.kind}) ===\n${doc.extractedText}${riskNotes}`);
  }

  const prompt = buildPrompt(docSections, q);
  const text = await callModel(resolved, prompt, { maxTokens: 800, timeoutMs: LLM_CALL_TIMEOUT_MS });
  const parsed = parseModelJson(text);
  // Logged against the most recent document's review purely as a place to
  // look it up later (contract_review_raw_outputs.reviewId is NOT NULL) —
  // this call isn't scoped to one review; if no document has a completed
  // review yet, there's nowhere to attach the log, so it's skipped rather
  // than failing the whole question over a missing audit record.
  const anyReviewId = [...latestReviewId.values()].pop() || null;
  if (anyReviewId) {
    await recordRawOutput({
      reviewId: anyReviewId, stage: 'qa', modelId: resolved, promptVersion: PROMPT_VERSION,
      rawResponse: { contractId, question: q, prompt: prompt.slice(0, 500), text, parsed },
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Could not get a usable answer from the model — try rephrasing the question.');
  }

  const answeredByContract = parsed.answeredByContract === true;
  const answer = String(parsed.answer || '').trim()
    || (answeredByContract ? 'The documents address this, but no explanation was returned.' : "None of these documents address that question.");
  const documentVersion = Number.isFinite(Number(parsed.documentVersion)) ? Number(parsed.documentVersion) : null;
  const perspectiveNote = parsed.perspectiveNote ? String(parsed.perspectiveNote).trim() : null;

  let quote = null;
  if (answeredByContract && parsed.quotedText) {
    // Verify against the SPECIFIC document version named, not the combined
    // blob — a quote genuinely present in one version but misattributed to
    // another must not "verify" just because the text happens to appear
    // somewhere else in the combined text too.
    const namedDoc = documentVersion != null ? docs.find((d) => d.version === documentVersion) : null;
    const haystack = namedDoc ? namedDoc.extractedText : docSections.join('\n\n');
    const verification = verifyQuote(haystack, String(parsed.quotedText));
    quote = { text: String(parsed.quotedText).trim(), verificationStatus: verification.verificationStatus };
  }

  return { answeredByContract, answer, documentVersion, perspectiveNote, quote };
}

module.exports = { askAboutContract };
