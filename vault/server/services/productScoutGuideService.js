'use strict';

const { pool } = require('../db');
const { searchProducts } = require('./rainforestClient');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const {
  getAmazonDomain,
  getPriceVariancePct,
  marketplaceLabel,
  filterByPriceBand,
  buildBudgetFitNote,
} = require('./productScoutSettings');
const { executeScoutComparison } = require('./productScoutService');

const TIER_KEYS = ['essentials', 'smart_upgrade', 'enthusiast', 'pro'];

const BRIEF_SYSTEM = `You are a product buying advisor. Help shoppers understand which features matter for their use case before they choose a price tier.
Return ONLY valid JSON. No markdown fences.`;

function parseFeaturesInput(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const s = String(raw || '').trim();
  if (!s) return [];
  return s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
}

function buildBriefPrompt(query, userFeatures, budgetHint) {
  const featuresBlock = userFeatures.length
    ? `Features the shopper thinks they need:\n${userFeatures.map((f) => `- ${f}`).join('\n')}\n`
    : '';

  const budgetBlock = budgetHint
    ? `Budget hint: around $${budgetHint} AUD — use this to anchor tier 1 pricing, not as a hard cap.\n`
    : '';

  return `Shopping goal: ${query}
${featuresBlock}${budgetBlock}
Return a feature brief and 4-tier framework for Amazon AU-style pricing (AUD).

1. summary — 2–3 sentences on what matters most for THIS use case.
2. features — 6–10 items merging shopper list + important additions they may have missed. Each:
   {"feature":"Hybrid ANC","importance":"must|nice|skip","why_it_matters":"..."}
   Mark shopper-mentioned items as must unless clearly wrong for the category.
3. tier_framework — exactly 4 tiers in order (cheapest to pro). Each:
   {"key":"essentials|smart_upgrade|enthusiast|pro","label":"Essentials","subtitle":"short tagline","price_min":40,"price_max":80,"feature_adds":["what this tier adds vs below"]}

Tier keys must be: essentials, smart_upgrade, enthusiast, pro.
Labels suggested: Essentials, Smart upgrade, Enthusiast, Pro / no budget.
Ensure price bands do not overlap awkwardly — each tier price_min should be above the previous tier price_max.

JSON only:
{"summary":"...","features":[{"feature":"...","importance":"must","why_it_matters":"..."}],"tier_framework":[{"key":"essentials","label":"Essentials","subtitle":"...","price_min":40,"price_max":80,"feature_adds":["..."]}]}`;
}

async function callGuideModel(userId, modelId, prompt) {
  const result = await callModel(modelId, prompt, {
    system: BRIEF_SYSTEM,
    maxTokens: 8192,
    returnUsage: true,
  });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature: 'product_scout',
  });
  return result.text;
}

function parseBriefResponse(text) {
  const parsed = parseModelJson(String(text || '').trim());
  if (!parsed?.features?.length) throw new Error('Feature brief missing features list');
  if (!parsed?.tier_framework?.length) throw new Error('Feature brief missing tier framework');
  parsed.tier_framework = parsed.tier_framework.slice(0, 4).map((t, i) => ({
    ...t,
    key: TIER_KEYS[i] || t.key || TIER_KEYS[0],
  }));
  return parsed;
}

function tierMinPrice(frame, index, framework) {
  if (frame.price_min != null && Number.isFinite(Number(frame.price_min))) {
    return Number(frame.price_min);
  }
  if (index === 0) return null;
  const prev = framework[index - 1];
  const prevMax = Number(prev?.price_max);
  return Number.isFinite(prevMax) ? Math.ceil(prevMax) : null;
}

function buildTierRows(framework, tierScouts) {
  return framework.map((frame, i) => {
    const key = frame.key || TIER_KEYS[i];
    const scout = tierScouts[i] || {};
    const priceMin = tierMinPrice(frame, i, framework);
    const priceMax = frame.price_max != null ? Number(frame.price_max) : null;

    return {
      key,
      label: frame.label || key,
      subtitle: frame.subtitle || '',
      price_min: priceMin,
      price_max: priceMax,
      feature_adds: frame.feature_adds || [],
      gains_vs_below: frame.feature_adds || [],
      scout,
      pick: scout.comparison?.top3?.[0] || null,
      scout_error: scout.error || null,
    };
  });
}

/**
 * Step 1: feature brief + tier price framework (no Amazon fetch).
 */
async function buildGuideBrief(userId, query, userFeaturesRaw, budgetHint) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');

  const userFeatures = parseFeaturesInput(userFeaturesRaw);
  const hint = budgetHint != null && budgetHint !== '' ? Number(budgetHint) : null;
  if (hint != null && (!Number.isFinite(hint) || hint <= 0)) {
    throw new Error('budgetHint must be a positive number');
  }

  const { standard: modelId } = await getModelsForUser(userId);
  const text = await callGuideModel(userId, modelId, buildBriefPrompt(q, userFeatures, hint));
  const brief = parseBriefResponse(text);

  return {
    query: q,
    userFeatures,
    budgetHint: hint,
    feature_brief: brief,
  };
}

/**
 * Step 2: Product Scout per price tier (full top-3 comparison each band).
 */
async function runBuyGuide(userId, { query, userFeatures, budgetHint, featureBrief }) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');
  if (!featureBrief?.features?.length || !featureBrief?.tier_framework?.length) {
    throw new Error('featureBrief is required — run guide/brief first');
  }

  const amazonDomain = await getAmazonDomain(pool);
  const variancePct = await getPriceVariancePct(pool);
  const { standard: modelId } = await getModelsForUser(userId);
  const framework = featureBrief.tier_framework;

  const allCandidates = await searchProducts(q, { maxResults: 40, amazonDomain });
  const tierScouts = [];

  for (let i = 0; i < framework.length; i += 1) {
    const frame = framework[i];
    const priceMin = tierMinPrice(frame, i, framework);
    const priceMax = frame.price_max != null ? Number(frame.price_max) : null;
    const isPro = frame.key === 'pro' || i === framework.length - 1;

    let band = filterByPriceBand(allCandidates, priceMin, isPro ? null : priceMax);
    if (!band.length && priceMin != null) {
      band = filterByPriceBand(allCandidates, null, isPro ? null : priceMax);
    }
    if (!band.length) {
      band = [...allCandidates];
    }

    const scout = await executeScoutComparison(userId, q, {
      candidates: band,
      maxPrice: isPro ? null : priceMax,
      amazonDomain,
      variancePct,
      modelId,
      tierLabel: frame.label,
      tierFeatures: frame.feature_adds,
      includeExternals: false,
    });

    tierScouts.push(scout);
  }

  const tiers = buildTierRows(framework, tierScouts);
  const hint = budgetHint != null && budgetHint !== '' ? Number(budgetHint) : null;
  const budget_fit_note = buildBudgetFitNote(hint, framework);

  if (!tiers.some((t) => t.scout?.comparison?.top3?.length)) {
    throw new Error('No products matched any price tier — try a broader search phrase');
  }

  const result = {
    mode: 'guide',
    query: q,
    userFeatures: userFeatures || [],
    budgetHint: hint,
    feature_brief: featureBrief,
    tiers,
    budget_fit_note,
    candidates_fetched: allCandidates.length,
    amazonDomain,
    amazonCountry: marketplaceLabel(amazonDomain),
    url_comparisons: [],
  };

  const { rows } = await pool.query(
    `INSERT INTO product_scout_runs ("userId", query, result, "createdAt")
     VALUES ($1, $2, $3, NOW()) RETURNING id, "createdAt"`,
    [userId, q, JSON.stringify(result)]
  );
  result.runId = rows[0]?.id;
  result.createdAt = rows[0]?.createdAt;

  return result;
}

module.exports = { buildGuideBrief, runBuyGuide, parseFeaturesInput, TIER_KEYS };
