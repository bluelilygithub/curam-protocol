'use strict';

/**
 * Open-ended Q&A over fetched lender documents.
 * Structurally quarantined: must not import scenario / orchestrate / calc.
 */

const { INSIGHT_DISCLAIMER } = require('./disclaimer');
const {
  fetchProductDocuments,
  corpusFromDocuments,
} = require('./fetchDocument');

const INSIGHT_SYSTEM = `You analyse Australian home-loan T&Cs / PDS / fee documents for a consumer tool.

Rules (non-negotiable):
1. Answer ONLY from the DOCUMENT TEXT provided. Do not use general knowledge to fill gaps.
2. Every substantive claim MUST include a short source_quote_or_paraphrase taken from the document and a document_section_or_location (page marker like "[Page 12]", heading, clause number, or "kind=terms" if that is all you have).
3. If the documents do not address the question, say so plainly. Put that in uncited_gaps — do NOT invent an answer and present it as fact.
4. If marketing-style language conflicts with denser PDS wording in the same corpus, report the disagreement explicitly in findings (do not pick a winner silently).
5. You are not giving financial or legal advice.

Return ONLY valid JSON with this shape:
{
  "findings": [
    {
      "claim": "string",
      "source_quote_or_paraphrase": "string from the document",
      "document_section_or_location": "string"
    }
  ],
  "uncited_gaps": ["things asked that are not addressed in the accessible documents"],
  "notes": "optional short meta note"
}`;

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function resolveInsightModel(opts = {}) {
  if (opts.modelId) return opts.modelId;
  if (opts.userId) {
    const { getModelsForUser } = require('../../modelResolver');
    const models = await getModelsForUser(opts.userId);
    if (models.standard) return models.standard;
    if (models.light) return models.light;
  }
  if (process.env.PROPERTY_SCENARIO_INSIGHT_MODEL) {
    return process.env.PROPERTY_SCENARIO_INSIGHT_MODEL;
  }
  if (process.env.PROPERTY_SCENARIO_MODEL) return process.env.PROPERTY_SCENARIO_MODEL;
  if (process.env.ANTHROPIC_API_KEY) return 'claude-sonnet-4-6';
  throw new Error('No model configured for document insights');
}

function normalizeFindings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      claim: String(f.claim || '').trim(),
      source_quote_or_paraphrase: String(f.source_quote_or_paraphrase || '').trim(),
      document_section_or_location: String(f.document_section_or_location || '').trim() || null,
    }))
    .filter((f) => f.claim);
}

/**
 * Drop findings that have no citation material — treat as uncited gaps instead.
 */
function enforceCitations(findings, uncitedGaps) {
  const kept = [];
  const gaps = [...(uncitedGaps || [])];
  findings.forEach((f) => {
    if (!f.source_quote_or_paraphrase) {
      gaps.push(`Uncited claim removed (no document quote): ${f.claim}`);
      return;
    }
    kept.push(f);
  });
  return { findings: kept, uncited_gaps: gaps };
}

/**
 * @param {object} input
 * @param {object} input.product — CDR-normalized lender row (must include links)
 * @param {string} input.question
 * @param {number} [input.userId]
 * @param {string} [input.modelId]
 * @param {boolean} [input.forceRefresh]
 * @param {{ callModel?: Function, fetchProductDocuments?: Function }} [deps]
 * @returns {Promise<object>} Insight
 */
async function buildInsight(input = {}, deps = {}) {
  const product = input.product;
  const question = String(input.question || '').trim();
  const productId = product?.id || product?.product_id || null;
  const retrievedAt = new Date().toISOString();

  if (!product || typeof product !== 'object') {
    return {
      ok: false,
      product_id: productId,
      question,
      findings: [],
      uncited_gaps: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'invalid_request',
      message: 'product is required',
    };
  }
  if (!question) {
    return {
      ok: false,
      product_id: productId,
      question: '',
      findings: [],
      uncited_gaps: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'invalid_request',
      message: 'question is required',
    };
  }

  const fetchDocs = deps.fetchProductDocuments || fetchProductDocuments;
  const pack = await fetchDocs(product, { forceRefresh: input.forceRefresh });

  if (!pack.ok) {
    return {
      ok: false,
      product_id: productId,
      product_name: product.name || product.product || null,
      lender: product.lender || null,
      question,
      findings: [],
      uncited_gaps: [],
      documents_attempted: pack.documents || [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: pack.error || 'document_unavailable',
      message: pack.message || "Couldn't retrieve this document",
    };
  }

  const corpus = corpusFromDocuments(pack);
  if (!corpus || corpus.length < 40) {
    return {
      ok: false,
      product_id: productId,
      product_name: product.name || product.product || null,
      lender: product.lender || null,
      question,
      findings: [],
      uncited_gaps: [],
      documents_attempted: pack.documents,
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'empty_corpus',
      message: "Couldn't retrieve usable document text for analysis",
    };
  }

  const call = deps.callModel || require('../../callModel').callModel;
  let modelId;
  try {
    modelId = deps.callModel
      ? (input.modelId || 'injected-model')
      : await resolveInsightModel(input);
  } catch (err) {
    return {
      ok: false,
      product_id: productId,
      question,
      findings: [],
      uncited_gaps: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'model_unavailable',
      message: err.message || String(err),
    };
  }

  const userPrompt = [
    `Product: ${product.lender || '?'} — ${product.name || product.product || productId}`,
    `CDR headline rate (context only — do not treat as document text): ${product.rate ?? 'n/a'}%`,
    `Question: ${question}`,
    '',
    'DOCUMENT CORPUS:',
    corpus,
  ].join('\n');

  let rawText;
  try {
    const result = await call(modelId, userPrompt, {
      system: INSIGHT_SYSTEM,
      maxTokens: 2500,
      returnUsage: true,
    });
    rawText = typeof result === 'string' ? result : result.text;
    if (input.userId && result && typeof result === 'object') {
      try {
        const { logUsage } = require('../../../utils/logUsage');
        logUsage({
          userId: input.userId,
          model: result.model || modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          feature: 'property_scenario_insight',
        });
      } catch {
        /* optional */
      }
    }
  } catch (err) {
    return {
      ok: false,
      product_id: productId,
      question,
      findings: [],
      uncited_gaps: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'model_failed',
      message: err.message || String(err),
    };
  }

  const parsed = parseJsonLoose(rawText);
  if (!parsed) {
    return {
      ok: false,
      product_id: productId,
      question,
      findings: [],
      uncited_gaps: ['Model did not return valid JSON — no claims accepted'],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'parse_failed',
      message: 'Insight model returned malformed output',
    };
  }

  const normalized = normalizeFindings(parsed.findings);
  const gaps = Array.isArray(parsed.uncited_gaps)
    ? parsed.uncited_gaps.map((g) => String(g || '').trim()).filter(Boolean)
    : [];
  const enforced = enforceCitations(normalized, gaps);

  return {
    ok: true,
    product_id: productId,
    product_name: product.name || product.product || null,
    lender: product.lender || null,
    question,
    findings: enforced.findings,
    uncited_gaps: enforced.uncited_gaps.length
      ? enforced.uncited_gaps
      : (enforced.findings.length ? [] : ['Not addressed in the document I could access']),
    documents_used: (pack.documents || [])
      .filter((d) => d.ok)
      .map((d) => ({ kind: d.kind, url: d.url, format: d.format, pages: d.pages, cache_hit: d.cache_hit })),
    documents_failed: (pack.documents || [])
      .filter((d) => !d.ok)
      .map((d) => ({ kind: d.kind, url: d.url, message: d.message })),
    notes: parsed.notes ? String(parsed.notes) : null,
    disclaimer: INSIGHT_DISCLAIMER,
    retrieved_at: retrievedAt,
  };
}

module.exports = {
  buildInsight,
  INSIGHT_SYSTEM,
  enforceCitations,
  normalizeFindings,
  parseJsonLoose,
  resolveInsightModel,
};
