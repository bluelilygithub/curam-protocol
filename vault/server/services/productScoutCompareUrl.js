'use strict';

const { pool } = require('../db');
const { fetchProduct } = require('./rainforestClient');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { getAmazonDomain } = require('./productScoutSettings');
const { getRun } = require('./productScoutService');

const COMPARE_URL_SYSTEM = `You are an unbiased product analyst helping a shopper decide whether a premium Amazon listing is worth stretching their budget for.
Compare the URL product against their current budget picks using only supplied listing data — do not invent specs.
Be honest when the budget picks already meet expectations for the use case.
Return ONLY valid JSON. No markdown fences.`;

function compactPick(item) {
  return {
    rank: item.rank,
    title: String(item.title || '').slice(0, 100),
    price: item.price ?? item.price_display,
    rating: item.rating,
    review_count: item.review_count,
    key_features: (item.key_features || item.feature_bullets || []).slice(0, 4),
    value_score: item.value_score,
    pre_score: item.pre_score,
  };
}

function compactUrlProduct(product) {
  return {
    title: String(product.title || '').slice(0, 120),
    brand: product.brand,
    price: product.price ?? product.price_display,
    price_display: product.price_display,
    rating: product.rating,
    review_count: product.review_count,
    availability: product.availability,
    feature_bullets: (product.feature_bullets || []).slice(0, 6),
    specifications: (product.specifications || []).slice(0, 12),
  };
}

function buildCompareUrlPrompt({ query, budget, urlProduct, budgetPicks }) {
  const budgetBlock = budget?.maxPrice
    ? `Shopper budget: max $${budget.maxPrice} (stretch ceiling ~$${budget.ceiling} with ${budget.variancePct}% variance).\n`
    : 'Shopper did not set a strict max price — infer sensible budget tiers from the picks.\n';

  const picksJson = JSON.stringify(budgetPicks.map(compactPick));

  return `Original search: ${query}
${budgetBlock}
BUDGET PICKS (ranked):
${picksJson}

URL PRODUCT (premium / out-of-budget candidate):
${JSON.stringify(compactUrlProduct(urlProduct))}

Write two paragraphs for the shopper:

1. upgrade_benefits — One paragraph on the major benefits of the URL product over the budget set. Explain whether the price/feature gap is worth considering if they had a bigger budget. Be specific (ANC quality, brand, battery, codecs, comfort, etc.) using listing data only.

2. budget_guidance — One paragraph listing meaningful features or experience gaps they are NOT getting on the budget picks. Then give a rough recommended budget range for a better mid-range experience (recommended_budget_min and recommended_budget_max as numbers in AUD). If the budget picks already meet expectations for this search, say so clearly and set budget_already_adequate to true with modest or null recommended range.

Also return:
- feature_gaps: 3–6 short bullet strings (features missing on budget picks)
- worth_stretching: boolean — true only if the upgrade clearly justifies a meaningful budget increase for this query
- budget_already_adequate: boolean

Return JSON only:
{"upgrade_benefits":"...","budget_guidance":"...","feature_gaps":["..."],"worth_stretching":true,"budget_already_adequate":false,"recommended_budget_min":150,"recommended_budget_max":250,"recommended_budget_note":"short label e.g. mid-range ANC tier"}`;
}

function parseCompareUrlResponse(text) {
  const parsed = parseModelJson(String(text || '').trim());
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI did not return valid comparison JSON');
  }
  if (!parsed.upgrade_benefits?.trim() || !parsed.budget_guidance?.trim()) {
    throw new Error('AI comparison missing required paragraphs');
  }
  if (!Array.isArray(parsed.feature_gaps)) parsed.feature_gaps = [];
  return parsed;
}

function resolveBudgetPicks(comparison) {
  const top3 = comparison?.top3 || [];
  if (top3.length) return top3;
  return comparison?.stretch_suggestions || [];
}

/**
 * Compare an Amazon URL product against picks from a scout run.
 * @param {number} userId
 * @param {{ url: string, runId?: number, scoutResult?: object }} opts
 */
async function compareUrlToScout(userId, { url, runId, scoutResult }) {
  const trimmedUrl = String(url || '').trim();
  if (!trimmedUrl) throw new Error('Amazon URL is required');

  let scout = scoutResult;
  if (runId) {
    const run = await getRun(userId, Number(runId));
    if (!run) throw new Error('Scout run not found');
    scout = run.result;
  }
  if (!scout?.comparison) {
    throw new Error('Run a Product Scout search first, then compare a URL against those picks');
  }

  const budgetPicks = resolveBudgetPicks(scout.comparison);
  if (!budgetPicks.length) {
    throw new Error('No budget picks to compare against — run a scout with in-budget results');
  }

  const amazonDomain = scout.amazonDomain || await getAmazonDomain(pool);
  const { product, sourceUrl } = await fetchProduct(trimmedUrl, amazonDomain);
  const { standard: modelId } = await getModelsForUser(userId);

  const prompt = buildCompareUrlPrompt({
    query: scout.query,
    budget: scout.budget,
    urlProduct: product,
    budgetPicks,
  });

  const result = await callModel(modelId, prompt, {
    system: COMPARE_URL_SYSTEM,
    maxTokens: 4096,
    returnUsage: true,
  });

  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature: 'product_scout',
  });

  const analysis = parseCompareUrlResponse(result.text);

  const comparisonEntry = {
    url: sourceUrl || trimmedUrl,
    asin: product.asin,
    product,
    analysis,
    comparedAt: new Date().toISOString(),
  };

  if (runId) {
    await appendUrlComparison(userId, Number(runId), comparisonEntry, scout);
  }

  return comparisonEntry;
}

async function appendUrlComparison(userId, runId, entry, existingResult) {
  const scout = existingResult || (await getRun(userId, runId))?.result;
  if (!scout) return;

  const next = {
    ...scout,
    url_comparisons: [...(scout.url_comparisons || []), entry],
  };

  await pool.query(
    `UPDATE product_scout_runs SET result = $1 WHERE "userId" = $2 AND id = $3`,
    [JSON.stringify(next), userId, runId]
  );
}

module.exports = { compareUrlToScout, buildCompareUrlPrompt, parseCompareUrlResponse };
