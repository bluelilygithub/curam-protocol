'use strict';

const { pool } = require('../db');
const { searchProducts } = require('./rainforestClient');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { getAmazonDomain, marketplaceLabel } = require('./productScoutSettings');
const { attachPreScores } = require('./productScoutScoring');

const TIER_KEYS = ['essentials', 'smart_upgrade', 'enthusiast', 'pro'];

const BRIEF_SYSTEM = `You are a product buying advisor. Help shoppers understand which features matter for their use case before they choose a price tier.
Return ONLY valid JSON. No markdown fences.`;

const PICK_SYSTEM = `You are an unbiased product analyst. Pick the best-value Amazon listing for each price tier from the candidate pool only.
Use listing facts (title, bullets, price, ratings) — not brand bias. Each tier must use a different candidate when possible.
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

JSON only:
{"summary":"...","features":[{"feature":"...","importance":"must","why_it_matters":"..."}],"tier_framework":[{"key":"essentials","label":"Essentials","subtitle":"...","price_min":40,"price_max":80,"feature_adds":["..."]}]}`;
}

function buildPickPrompt(query, featureBrief, tierFramework, candidates) {
  const compact = candidates.map((c, i) => ({
    id: i + 1,
    asin: c.asin,
    title: String(c.title || '').slice(0, 90),
    price: c.price_display || c.price,
    rating: c.rating,
    review_count: c.review_count,
    pre_score: c.pre_score,
    feature_bullets: (c.feature_bullets || []).slice(0, 4),
  }));

  return `Shopping goal: ${query}

FEATURE BRIEF:
${JSON.stringify({ summary: featureBrief.summary, features: featureBrief.features })}

TIER FRAMEWORK (pick one candidate per tier — different products when possible):
${JSON.stringify(tierFramework)}

CANDIDATES:
${JSON.stringify({ candidates: compact })}

Rules:
- essentials: best VALUE in lowest price band with minimum viable must-have features
- smart_upgrade: meaningful step up in features for moderate price increase
- enthusiast: near top-tier consumer features
- pro: what a professional would buy; price secondary but still pick from candidates if any fit, else closest match

For each tier return candidate_id from the list, gains_vs_below (bullets vs previous tier), tier_rationale (max 35 words).
If no candidate fits a tier band, pick closest match and note in tier_rationale.

Also budget_fit_note — one sentence on which tier fits the shopper's budget hint (if any) or general guidance.

JSON only:
{"budget_fit_note":"...","tiers":[{"key":"essentials","candidate_id":1,"gains_vs_below":["..."],"tier_rationale":"...","alternate_candidate_id":null}]}`;
}

async function callGuideModel(userId, modelId, system, prompt, maxTokens = 8192) {
  const result = await callModel(modelId, prompt, { system, maxTokens, returnUsage: true });
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

function parsePickResponse(text) {
  const parsed = parseModelJson(String(text || '').trim());
  if (!parsed?.tiers?.length) throw new Error('Guide missing tier picks');
  return parsed;
}

function enrichTierPicks(parsed, candidates, tierFramework) {
  const byId = Object.fromEntries(candidates.map((c, i) => [i + 1, c]));
  const byAsin = Object.fromEntries(candidates.filter((c) => c.asin).map((c) => [c.asin, c]));

  const tiers = [];
  for (let i = 0; i < TIER_KEYS.length; i += 1) {
    const key = TIER_KEYS[i];
    const frame = tierFramework[i] || tierFramework.find((t) => t.key === key) || {};
    const row = parsed.tiers.find((t) => t.key === key) || parsed.tiers[i] || {};

    const src = byId[row.candidate_id] || byAsin[row.asin];
    const altSrc = row.alternate_candidate_id ? byId[row.alternate_candidate_id] : null;

    const pick = src ? {
      asin: src.asin,
      title: src.title,
      price: src.price_display || src.price,
      price_display: src.price_display,
      rating: src.rating,
      review_count: src.review_count,
      link: src.link,
      delivery_display: src.delivery_display,
      feature_bullets: src.feature_bullets,
      key_features: src.feature_bullets,
      pre_score: src.pre_score,
      value_score: src.pre_score,
    } : null;

    tiers.push({
      key,
      label: frame.label || key,
      subtitle: frame.subtitle || '',
      price_min: frame.price_min ?? null,
      price_max: frame.price_max ?? null,
      feature_adds: frame.feature_adds || row.gains_vs_below || [],
      gains_vs_below: row.gains_vs_below || frame.feature_adds || [],
      tier_rationale: row.tier_rationale || '',
      pick,
      alternate: altSrc ? {
        asin: altSrc.asin,
        title: altSrc.title,
        price: altSrc.price_display || altSrc.price,
        link: altSrc.link,
      } : null,
    });
  }

  return {
    budget_fit_note: parsed.budget_fit_note || '',
    tiers,
  };
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
  const text = await callGuideModel(userId, modelId, BRIEF_SYSTEM, buildBriefPrompt(q, userFeatures, hint));
  const brief = parseBriefResponse(text);

  return {
    query: q,
    userFeatures,
    budgetHint: hint,
    feature_brief: brief,
  };
}

/**
 * Step 2: search Amazon + pick best product per tier.
 */
async function runBuyGuide(userId, { query, userFeatures, budgetHint, featureBrief }) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');
  if (!featureBrief?.features?.length || !featureBrief?.tier_framework?.length) {
    throw new Error('featureBrief is required — run guide/brief first');
  }

  const amazonDomain = await getAmazonDomain(pool);
  const { standard: modelId } = await getModelsForUser(userId);

  const candidates = await searchProducts(q, { maxResults: 25, amazonDomain });
  const scored = attachPreScores(candidates);

  const text = await callGuideModel(
    userId,
    modelId,
    PICK_SYSTEM,
    buildPickPrompt(q, featureBrief, featureBrief.tier_framework, scored),
    8192
  );
  const picked = parsePickResponse(text);
  const { tiers, budget_fit_note } = enrichTierPicks(picked, scored, featureBrief.tier_framework);

  if (!tiers.some((t) => t.pick)) {
    throw new Error('No products matched the tier guide — try a broader search phrase');
  }

  const hint = budgetHint != null && budgetHint !== '' ? Number(budgetHint) : null;

  const result = {
    mode: 'guide',
    query: q,
    userFeatures: userFeatures || [],
    budgetHint: hint,
    feature_brief: featureBrief,
    tiers,
    budget_fit_note,
    candidates_fetched: scored.length,
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
