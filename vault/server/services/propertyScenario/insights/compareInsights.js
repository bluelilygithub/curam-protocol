'use strict';

/**
 * Multi-product comparative insight over fetched lender documents.
 * Structurally quarantined: must not import scenario / orchestrate / calc.
 */

const { INSIGHT_DISCLAIMER } = require('./disclaimer');
const {
  fetchProductDocuments,
  corpusFromDocuments,
} = require('./fetchDocument');
const {
  normalizeFindings,
  enforceCitations,
  parseJsonLoose,
  resolveInsightModel,
} = require('./buildInsight');

const COMPARE_SYSTEM = `You compare Australian home-loan T&Cs / PDS / fee documents across multiple products.

Rules (non-negotiable):
1. Answer ONLY from the DOCUMENT TEXT blocks provided for each product. Do not invent terms.
2. Every substantive claim MUST cite which product it belongs to and include source_quote_or_paraphrase plus document_section_or_location.
3. If documents disagree with each other, or a document disagrees with the CDR headline summary noted for a product, surface the disagreement explicitly in findings — do not silently pick one as correct.
4. If a question cannot be answered from the accessible documents for one or more products, list that in uncited_gaps.
5. You are not giving financial or legal advice.

Return ONLY valid JSON:
{
  "findings": [
    {
      "claim": "string (name the product/lender in the claim when comparing)",
      "source_quote_or_paraphrase": "string",
      "document_section_or_location": "string",
      "product_id": "optional id"
    }
  ],
  "uncited_gaps": ["string"],
  "disagreements": ["explicit disagreements between docs or vs CDR headline"],
  "notes": "optional"
}`;

/**
 * @param {object} input
 * @param {object[]} input.products — CDR-normalized rows
 * @param {string} input.question
 * @param {number} [input.userId]
 * @param {string} [input.modelId]
 * @param {boolean} [input.forceRefresh]
 * @param {{ callModel?: Function, fetchProductDocuments?: Function }} [deps]
 */
async function compareInsights(input = {}, deps = {}) {
  const products = Array.isArray(input.products) ? input.products.filter(Boolean) : [];
  const question = String(input.question || '').trim();
  const retrievedAt = new Date().toISOString();

  if (products.length < 2) {
    return {
      ok: false,
      product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
      question,
      findings: [],
      uncited_gaps: [],
      disagreements: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'invalid_request',
      message: 'At least two products are required for comparison',
    };
  }
  if (!question) {
    return {
      ok: false,
      product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
      question: '',
      findings: [],
      uncited_gaps: [],
      disagreements: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'invalid_request',
      message: 'question is required',
    };
  }

  const fetchDocs = deps.fetchProductDocuments || fetchProductDocuments;
  const packs = [];
  for (const product of products) {
    // sequential to avoid hammering bank CDNs
    // eslint-disable-next-line no-await-in-loop
    packs.push(await fetchDocs(product, { forceRefresh: input.forceRefresh }));
  }

  const usable = packs.filter((p) => p.ok);
  if (!usable.length) {
    return {
      ok: false,
      product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
      question,
      findings: [],
      uncited_gaps: [],
      disagreements: [],
      documents_attempted: packs,
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'document_unavailable',
      message: "Couldn't retrieve documents for any of the selected products",
    };
  }

  const corpusBlocks = usable.map((pack, i) => {
    const product = products.find(
      (p) => (p.id || p.product_id) === pack.product_id
    ) || products[i];
    return [
      `##### PRODUCT id=${pack.product_id} lender=${pack.lender} name=${pack.product_name}`,
      `CDR headline (not document text): rate=${product?.rate ?? 'n/a'}% offset=${product?.offset} redraw=${product?.redraw}`,
      corpusFromDocuments(pack),
    ].join('\n');
  }).join('\n\n');

  const call = deps.callModel || require('../../callModel').callModel;
  let modelId;
  try {
    modelId = deps.callModel
      ? (input.modelId || 'injected-model')
      : await resolveInsightModel(input);
  } catch (err) {
    return {
      ok: false,
      product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
      question,
      findings: [],
      uncited_gaps: [],
      disagreements: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'model_unavailable',
      message: err.message || String(err),
    };
  }

  const userPrompt = [
    `Comparative question: ${question}`,
    '',
    'PRODUCT DOCUMENT CORPORA:',
    corpusBlocks,
  ].join('\n');

  let rawText;
  try {
    const result = await call(modelId, userPrompt, {
      system: COMPARE_SYSTEM,
      maxTokens: 3200,
      returnUsage: true,
    });
    rawText = typeof result === 'string' ? result : result.text;
  } catch (err) {
    return {
      ok: false,
      product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
      question,
      findings: [],
      uncited_gaps: [],
      disagreements: [],
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
      product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
      question,
      findings: [],
      uncited_gaps: ['Model did not return valid JSON — no claims accepted'],
      disagreements: [],
      disclaimer: INSIGHT_DISCLAIMER,
      retrieved_at: retrievedAt,
      error: 'parse_failed',
      message: 'Compare model returned malformed output',
    };
  }

  const normalized = normalizeFindings(parsed.findings);
  const gaps = Array.isArray(parsed.uncited_gaps)
    ? parsed.uncited_gaps.map((g) => String(g || '').trim()).filter(Boolean)
    : [];
  const enforced = enforceCitations(normalized, gaps);
  const disagreements = Array.isArray(parsed.disagreements)
    ? parsed.disagreements.map((d) => String(d || '').trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    product_ids: products.map((p) => p.id || p.product_id).filter(Boolean),
    question,
    findings: enforced.findings,
    uncited_gaps: enforced.uncited_gaps,
    disagreements,
    documents_used: usable.map((pack) => ({
      product_id: pack.product_id,
      lender: pack.lender,
      docs: (pack.documents || []).filter((d) => d.ok).map((d) => ({
        kind: d.kind,
        url: d.url,
        format: d.format,
      })),
    })),
    documents_failed: packs
      .filter((p) => !p.ok)
      .map((p) => ({ product_id: p.product_id, message: p.message })),
    notes: parsed.notes ? String(parsed.notes) : null,
    disclaimer: INSIGHT_DISCLAIMER,
    retrieved_at: retrievedAt,
  };
}

module.exports = {
  compareInsights,
  COMPARE_SYSTEM,
};
