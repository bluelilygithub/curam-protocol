'use strict';

// Contract Review — "Ask about this contract" Q&A. Stateless (no DB table,
// no persisted history) — same pattern as PDF Tools' "chat over an uploaded
// file" (docs/pdf-agent.md): one question in, one grounded answer out.
// Every answer that claims the contract addresses the question must carry
// an exact quote, verified the same way every other stage grounds a claim
// (grounding.js's verifyQuote) — a claim that fails verification is marked
// unverified, never silently shown as if it were confirmed. When the
// contract genuinely doesn't address the question, the model is asked to
// say so plainly instead of guessing.

const { pool } = require('../../db');
const { resolveContractReviewModel } = require('../contractReviewModelResolver');
const { callModel } = require('../callModel');
const { parseModelJson } = require('../../utils/parseModelJson');
const { verifyQuote } = require('./grounding');
const { recordRawOutput } = require('./rawOutputs');
const { LLM_CALL_TIMEOUT_MS } = require('./costTracking');

const PROMPT_VERSION = 'qa-v1';

function buildPrompt(extractedText, question) {
  return `You are answering a question about ONE contract, using ONLY the contract text below — never outside knowledge, never assumptions about what a "normal" contract would say.

Contract text:
${extractedText}

Question: ${question}

If the contract's text answers this, give the answer AND the EXACT quote (verbatim, copied exactly as it appears above, no paraphrasing) that supports it — this will be located and verified programmatically, so it must match the source exactly.
If the contract does NOT address this question at all, say so plainly (e.g. "This contract doesn't specify a notice period for this.") instead of guessing or inferring from what's typical.

Respond as JSON:
{
  "answeredByContract": true | false,
  "answer": "<plain-English answer, or an explanation of what the contract doesn't cover>",
  "quotedText": "<EXACT verbatim quote from the text above that supports the answer, or null if answeredByContract is false>"
}
Respond with ONLY valid JSON — no markdown fences, no commentary before or after.`;
}

/**
 * @param {number} reviewId - which review's document text to answer against
 * @param {string} question
 * @param {number} userId
 * @returns {Promise<{answeredByContract: boolean, answer: string, quote: {text: string, verificationStatus: string}|null}>}
 */
async function askAboutContract(reviewId, question, userId) {
  const q = String(question || '').trim();
  if (!q) throw new Error('A question is required');
  if (q.length > 1000) throw new Error('Question is too long (max 1000 characters)');

  const { rows: [row] } = await pool.query(
    `SELECT r.id, d."extractedText" FROM contract_reviews r JOIN contract_documents d ON d.id = r."documentId" WHERE r.id=$1`,
    [reviewId]
  );
  if (!row) throw new Error(`Review ${reviewId} not found`);
  if (!row.extractedText) throw new Error('This document has no extracted text to ask about yet.');

  const { modelId: resolved } = await resolveContractReviewModel(userId);
  if (!resolved) {
    throw new Error('No Contract Review model is configured for this workspace — set one in Settings → AI & Chat → Contract Review model.');
  }

  const prompt = buildPrompt(row.extractedText, q);
  const text = await callModel(resolved, prompt, { maxTokens: 800, timeoutMs: LLM_CALL_TIMEOUT_MS });
  const parsed = parseModelJson(text);
  await recordRawOutput({
    reviewId, stage: 'qa', modelId: resolved, promptVersion: PROMPT_VERSION,
    rawResponse: { question: q, prompt: prompt.slice(0, 500), text, parsed },
  });

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Could not get a usable answer from the model — try rephrasing the question.');
  }

  const answeredByContract = parsed.answeredByContract === true;
  const answer = String(parsed.answer || '').trim()
    || (answeredByContract ? 'The contract addresses this, but no explanation was returned.' : "This contract doesn't address that question.");

  let quote = null;
  if (answeredByContract && parsed.quotedText) {
    const verification = verifyQuote(row.extractedText, String(parsed.quotedText));
    quote = { text: String(parsed.quotedText).trim(), verificationStatus: verification.verificationStatus };
  }

  return { answeredByContract, answer, quote };
}

module.exports = { askAboutContract };
