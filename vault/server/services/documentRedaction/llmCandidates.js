'use strict';

/**
 * Local-LLM redaction candidate proposals.
 * Model MUST come from resolveDocumentRedactionModels().local — never hardcoded.
 */

const crypto = require('crypto');
const { callModel } = require('../callModel');
const { findOccurrences, locateInParagraph } = require('./docxParse');
const { normalizeCategoryLabel } = require('./categories');

const SYSTEM = `You are a document redaction analyst running on a local machine.
Given document excerpts and the user's redaction brief, propose redaction candidates.
Return ONLY valid JSON (no markdown fences) with this shape:
{
  "candidates": [
    {
      "entityText": "exact substring from the excerpt",
      "categoryLabel": "short category from: Person name, Organisation, Bank name, Banking product, Interest rate, Financial figure, Capacity amount, Credit card limit, Loan amount, Repayment, Buffer, Email, Phone, Address, Date, Account number, ABN",
      "paragraphId": "id from the excerpt headers",
      "confidence": 0.0,
      "rationale": "why this should be redacted given the brief",
      "suggestedReplacement": "synthetic but plausible replacement (never placeholders like $[redacted] or $X,XXX)"
    }
  ]
}
Rules:
- entityText MUST appear verbatim in the cited paragraph.
- Prefer specific people, orgs, amounts, IDs, locations that match the brief.
- Prefer specific categories (e.g. Capacity amount, Loan amount) over generic Financial figure when the context is clear.
- Do not invent text that is not in the excerpt.
- Use unique synthetic replacements (not black bars or $[redacted]).
- confidence is 0-1.`;

function newId() {
  return crypto.randomUUID();
}

function chunkParagraphs(paragraphs, maxChars = 6000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const p of paragraphs || []) {
    const add = (p.text || '').length + (p.paragraphId || '').length + 32;
    if (current.length && size + add > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += add;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function formatChunk(paragraphs) {
  return paragraphs.map((p) => (
    `[${p.paragraphId}] (${p.part})\n${p.text}`
  )).join('\n\n');
}

function parseJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  let jsonText = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.candidates)) return parsed.candidates;
  return [];
}

function resolveLocations(ir, byId, item) {
  const entityText = String(item.entityText || item.quote || '').trim();
  if (!entityText) return [];

  const paragraphId = item.paragraphId ? String(item.paragraphId).trim() : null;
  if (paragraphId && byId.has(paragraphId)) {
    const p = byId.get(paragraphId);
    const idx = p.text.indexOf(entityText);
    if (idx >= 0) {
      return [locateInParagraph(p, idx, idx + entityText.length, entityText)];
    }
  }
  return findOccurrences(ir, entityText);
}

/**
 * @param {object} opts
 * @param {object} opts.ir
 * @param {string} opts.brief
 * @param {string} opts.modelId — from local slot resolver
 * @param {string} opts.jobId
 * @param {function} [opts.onProgress] — called (chunkIndex, totalChunks) after each chunk resolves
 */
async function extractLlmCandidates({ ir, brief, modelId, jobId, onProgress }) {
  if (!modelId) {
    const err = new Error('Local model id required for LLM candidate extraction');
    err.status = 400;
    throw err;
  }

  const byId = new Map((ir.paragraphs || []).map((p) => [p.paragraphId, p]));
  const chunks = chunkParagraphs(ir.paragraphs || []);
  const out = [];
  const errors = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const userPrompt = [
      `Redaction brief (follow this intent; free-form, not a fixed taxonomy):\n${brief}`,
      '',
      `Document excerpt ${i + 1}/${chunks.length}:`,
      formatChunk(chunks[i]),
      '',
      'Return JSON only.',
    ].join('\n');

    try {
      const text = await callModel(modelId, userPrompt, {
        system: SYSTEM,
        maxTokens: 4000,
      });
      const items = parseJsonPayload(text);
      for (const item of items) {
        const entityText = String(item.entityText || '').trim();
        if (!entityText) continue;
        const locations = resolveLocations(ir, byId, item);
        if (!locations.length) continue;
        const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0.5));
        out.push({
          id: newId(),
          jobId,
          source: 'local_llm',
          sourceLabel: 'llm',
          categoryLabel: normalizeCategoryLabel(item.categoryLabel || 'sensitive'),
          entityKey: null,
          surfaceForms: [entityText],
          locations,
          confidence,
          score: confidence,
          scoreBreakdown: { llm: confidence },
          suggestedReplacement: String(item.suggestedReplacement || `REDACTED_${out.length + 1}`).trim(),
          decision: 'pending',
          decidedBy: null,
          rationale: String(item.rationale || '').trim() || undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      errors.push({ chunk: i + 1, message: err.message || String(err) });
      console.warn(`[document-redaction] LLM chunk ${i + 1} failed:`, err.message);
    }

    if (typeof onProgress === 'function') {
      try {
        onProgress(i + 1, chunks.length);
      } catch { /* progress reporting must never break extraction */ }
    }
  }

  return { candidates: out, errors, chunks: chunks.length, modelId };
}

module.exports = {
  extractLlmCandidates,
  chunkParagraphs,
  parseJsonPayload,
};
