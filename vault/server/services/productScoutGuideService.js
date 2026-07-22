'use strict';

const { pool } = require('../db');
const { searchProducts } = require('./rainforestClient');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const {
  getAmazonDomain,
  marketplaceLabel,
  filterByPriceBand,
  buildBudgetFitNote,
} = require('./productScoutSettings');
const { executeScoutComparison, getRun } = require('./productScoutService');

const TIER_KEYS = ['essentials', 'smart_upgrade', 'enthusiast', 'pro'];

const BRIEF_SYSTEM = `You are a product buying advisor for Amazon shoppers.
For EVERY product category, start from Amazon's left-sidebar filters — the standard dimensions shoppers click to narrow results (type, form factor, size, style, connectivity, capacity, etc.). These differ per category; infer the correct set from the search query.
Return ONLY valid JSON. No markdown fences.`;

const RECOMMEND_SYSTEM = `You are an unbiased product analyst. Recommend the single best VALUE FOR MONEY pick across price tiers for this shopper — not the most expensive or cheapest by default.
Judge features, quality, price, and review evidence. No brand loyalty. No Amazon placement bias.
Return ONLY valid JSON. No markdown fences.`;

function formatPriceBand(min, max) {
  if (min != null && max != null) return `$${min}–$${max}`;
  if (max != null) return `up to $${max}`;
  if (min != null) return `from $${min}`;
  return '—';
}

function collectTierPicks(tiers) {
  return (tiers || [])
    .filter((t) => tierWasScouted(t.scout))
    .map((t) => {
      const top = t.scout?.comparison?.top3?.[0];
      if (!top) return null;
      return {
        tier_key: t.key,
        tier_label: t.label,
        price_band: formatPriceBand(t.price_min, t.price_max),
        asin: top.asin,
        title: top.title,
        price: top.price,
        value_score: top.value_score,
        pre_score: top.pre_score,
        rating: top.rating,
        review_count: top.review_count,
        key_features: top.key_features || top.feature_bullets || [],
        value_rationale: top.value_rationale,
        link: top.link,
      };
    })
    .filter(Boolean);
}

function formatFeatureRequirement(f) {
  if (!f || f.importance === 'skip') return null;
  if (f.kind === 'spec' && f.spec_value != null && f.spec_value !== '') {
    const v = f.spec_value;
    const unit = f.spec_unit || '';
    if (f.spec_type === 'numeric_min') return `${f.feature}: at least ${v}${unit}`;
    if (f.spec_type === 'numeric_max') return `${f.feature}: at most ${v}${unit}`;
    if (f.spec_type === 'enum') return v === 'Any' ? null : `${f.feature}: ${v}`;
    if (f.spec_type === 'text') return `${f.feature}: ${v}`;
  }
  return f.feature;
}

function normalizeBriefFeature(f) {
  if (!f?.feature) return null;
  const name = String(f.feature).trim();
  const out = { ...f, feature: name };
  const validTypes = new Set(['numeric_min', 'numeric_max', 'enum', 'text']);

  if (out.kind === 'spec' || out.spec_type) {
    out.kind = 'spec';
    out.spec_type = validTypes.has(out.spec_type) ? out.spec_type : 'text';
    out.spec_unit = out.spec_unit != null && out.spec_unit !== '' ? String(out.spec_unit) : null;
    out.spec_options = Array.isArray(out.spec_options)
      ? out.spec_options.map((o) => (typeof o === 'number' ? o : String(o).trim())).filter((o) => o !== '')
      : [];
    if (out.spec_type === 'enum' && !out.spec_options.length) out.spec_type = 'text';
    if (out.importance === 'skip' && out.spec_value != null && out.spec_value !== '') {
      out.importance = 'must';
    }
    return out;
  }

  out.kind = 'feature';
  if (!['must', 'nice', 'skip'].includes(out.importance)) out.importance = 'nice';
  return out;
}

function normalizeBriefFeatures(features) {
  return (features || []).map(normalizeBriefFeature).filter(Boolean);
}

function featureKey(f) {
  return String(f?.feature || '').trim().toLowerCase();
}

/** Sidebar filters first, then remaining specs/features — dedupe by label. */
function mergeBriefFeatures(sidebarFilters, features) {
  const sidebar = normalizeBriefFeatures(sidebarFilters);
  const rest = normalizeBriefFeatures(features);
  const seen = new Set(sidebar.map(featureKey));
  const merged = [...sidebar];
  for (const f of rest) {
    const key = featureKey(f);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(f);
  }
  return merged;
}

function buildRecommendationPrompt(query, featureBrief, budgetHint, tierPicks) {
  const mustFeatures = (featureBrief?.features || [])
    .filter((f) => f.importance === 'must')
    .map(formatFeatureRequirement)
    .filter(Boolean);
  const niceFeatures = (featureBrief?.features || [])
    .filter((f) => f.importance === 'nice')
    .map(formatFeatureRequirement)
    .filter(Boolean)
    .slice(0, 5);

  const budgetBlock = budgetHint
    ? `Budget hint: around $${budgetHint} — factor this in but do not treat as a hard cap.\n`
    : '';

  const picksBlock = tierPicks.map((p) => (
    `Tier: ${p.tier_label} (${p.price_band})
Top pick: ${p.title}
ASIN: ${p.asin || '—'}
Price: ${p.price || '—'}
Value score: ${p.value_score ?? '—'}${p.pre_score != null ? ` (pre-score ${p.pre_score})` : ''}
Rating: ${p.rating ?? '—'} · ${p.review_count ?? '—'} reviews
Key features: ${(p.key_features || []).slice(0, 4).join('; ') || '—'}
Scout rationale: ${p.value_rationale || '—'}`
  )).join('\n\n');

  return `Shopping goal: ${query}
${budgetBlock}Brief summary: ${featureBrief?.summary || '—'}
Must-have features: ${mustFeatures.join(', ') || 'see brief'}
Nice-to-have: ${niceFeatures.join(', ') || '—'}

One top pick per scouted price tier (already ranked within tier):
${picksBlock}

Choose ONE overall best value-for-money product for THIS shopper across tiers.
Explain tradeoffs vs the other tier winners. Say who should step up or stay down.

JSON only:
{"headline":"One sentence verdict","rationale":"2-3 short paragraphs, plain text, no markdown","pick":{"tier_key":"essentials","tier_label":"Essentials","asin":"...","title":"...","price":"...","value_score":85},"worth_stepping_up":"When paying more is justified, or null","worth_staying_down":"When cheaper is enough, or null"}`;
}

function parseRecommendationResponse(text, tierPicks) {
  const parsed = parseModelJson(String(text || '').trim());
  if (!parsed?.pick?.title) throw new Error('Recommendation missing pick');

  const byAsin = Object.fromEntries(tierPicks.filter((p) => p.asin).map((p) => [p.asin, p]));
  const byTier = Object.fromEntries(tierPicks.map((p) => [p.tier_key, p]));
  const src = byAsin[parsed.pick.asin] || byTier[parsed.pick.tier_key];

  if (src) {
    parsed.pick.link = parsed.pick.link || src.link;
    parsed.pick.price = parsed.pick.price || src.price;
    parsed.pick.asin = parsed.pick.asin || src.asin;
    parsed.pick.tier_key = parsed.pick.tier_key || src.tier_key;
    parsed.pick.tier_label = parsed.pick.tier_label || src.tier_label;
    parsed.pick.value_score = parsed.pick.value_score ?? src.value_score;
  }

  return {
    headline: String(parsed.headline || '').trim(),
    rationale: String(parsed.rationale || '').trim(),
    pick: parsed.pick,
    worth_stepping_up: parsed.worth_stepping_up || null,
    worth_staying_down: parsed.worth_staying_down || null,
    generated_at: new Date().toISOString(),
  };
}

async function generateFinalRecommendation(userId, { query, featureBrief, budgetHint, tiers }) {
  const tierPicks = collectTierPicks(tiers);
  if (!tierPicks.length) {
    throw new Error('Scout at least one tier before generating a recommendation');
  }

  const { standard: modelId } = await getModelsForUser(userId);
  const text = await callGuideModel(
    userId,
    modelId,
    buildRecommendationPrompt(query, featureBrief, budgetHint, tierPicks),
    { system: RECOMMEND_SYSTEM }
  );
  return parseRecommendationResponse(text, tierPicks);
}

async function saveGuideResult(userId, runId, existing, result) {
  if (runId && existing) {
    await pool.query(
      `UPDATE product_scout_runs SET result = $1 WHERE "userId" = $2 AND id = $3`,
      [JSON.stringify(result), userId, Number(runId)]
    );
    result.runId = Number(runId);
    const { rows } = await pool.query(
      `SELECT "createdAt" FROM product_scout_runs WHERE id = $1`,
      [Number(runId)]
    );
    result.createdAt = rows[0]?.createdAt;
  } else {
    const { rows } = await pool.query(
      `INSERT INTO product_scout_runs ("userId", query, result, "createdAt")
       VALUES ($1, $2, $3, NOW()) RETURNING id, "createdAt"`,
      [userId, result.query, JSON.stringify(result)]
    );
    result.runId = rows[0]?.id;
    result.createdAt = rows[0]?.createdAt;
  }
  return result;
}

function parseFeaturesInput(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  const s = String(raw || '').trim();
  if (!s) return [];
  return s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
}

function normalizeSelectedTierKeys(selectedTierKeys, framework) {
  const valid = new Set(framework.map((f, i) => f.key || TIER_KEYS[i]));
  const keys = [...new Set((selectedTierKeys || []).map((k) => String(k).trim()).filter(Boolean))]
    .filter((k) => valid.has(k));
  if (!keys.length) throw new Error('Select at least one tier to scout');
  return keys;
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

STEP 1 — amazon_sidebar_filters (REQUIRED for every product, 2–5 items):
Imagine this exact search on Amazon. What filter dimensions appear in the LEFT SIDEBAR? Every category has them — they are how shoppers narrow results before comparing listings.
- Infer the correct filters for THIS query (not a fixed list). Examples only:
  · Headphones → wearing style, connection type
  · Laptops → screen size, RAM, storage
  · Monitors → screen size, resolution, panel type
  · Drills → power type, chuck size
  · Coffee machines → machine type, capacity
  · Shoes → style/type, gender/fit (if relevant)
  · Cameras → camera type (mirrorless, DSLR, compact, action)
Include the primary type/form-factor/style filter first. Each item: kind "spec", usually spec_type "enum", spec_options with "Any" or "No preference" plus 3–6 realistic Amazon values, spec_value defaulting to Any.

STEP 2 — features (additional specs + capabilities):
   a) kind "spec" — numeric or extra measurable specs not already in amazon_sidebar_filters (battery hours, weight kg, wattage, etc.)
   b) kind "feature" — 4–10 yes/no capabilities (noise cancelling, waterproof, foldable, smart TV, etc.)
Do not duplicate amazon_sidebar_filters here. Capabilities stay kind "feature".

3. summary — 2–3 sentences on what matters most for THIS use case.
4. tier_framework — exactly 4 tiers in order (cheapest to pro). Each:
   {"key":"essentials|smart_upgrade|enthusiast|pro","label":"Essentials","subtitle":"short tagline","price_min":40,"price_max":80,"feature_adds":["what this tier adds vs below"]}

Spec object shape (sidebar + numeric specs):
{"feature":"<label>","kind":"spec","importance":"must|nice","why_it_matters":"...","spec_type":"numeric_min|numeric_max|enum|text","spec_unit":"<unit or null>","spec_value":<default>,"spec_options":[...]}

Tier keys must be: essentials, smart_upgrade, enthusiast, pro.
Labels suggested: Essentials, Smart upgrade, Enthusiast, Pro / no budget.
Ensure price bands do not overlap awkwardly — each tier price_min should be above the previous tier price_max.

JSON only:
{"summary":"...","amazon_sidebar_filters":[{"feature":"Wearing style","kind":"spec","importance":"must","why_it_matters":"...","spec_type":"enum","spec_unit":null,"spec_value":"Any","spec_options":["Any","Over-ear","On-ear","In-ear / earbuds"]},{"feature":"Connection","kind":"spec","importance":"nice","why_it_matters":"...","spec_type":"enum","spec_unit":null,"spec_value":"Any","spec_options":["Any","True wireless","Wireless","Wired"]}],"features":[{"feature":"Battery life","kind":"spec","importance":"must","why_it_matters":"...","spec_type":"numeric_min","spec_unit":"h","spec_value":30,"spec_options":[20,30,40,50,60]},{"feature":"Hybrid ANC","kind":"feature","importance":"must","why_it_matters":"..."}],"tier_framework":[{"key":"essentials","label":"Essentials","subtitle":"...","price_min":40,"price_max":80,"feature_adds":["..."]}]}`;
}

async function callGuideModel(userId, modelId, prompt, { system = BRIEF_SYSTEM } = {}) {
  const result = await callModel(modelId, prompt, {
    system,
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
  if (!parsed?.tier_framework?.length) throw new Error('Feature brief missing tier framework');

  const sidebar = parsed.amazon_sidebar_filters || [];
  const rest = parsed.features || [];
  const merged = mergeBriefFeatures(sidebar, rest);
  if (!merged.length) throw new Error('Feature brief missing features list');
  if (!sidebar.length) {
    console.warn('[productScout] Brief missing amazon_sidebar_filters — using merged features only');
  }

  parsed.tier_framework = parsed.tier_framework.slice(0, 4).map((t, i) => ({
    ...t,
    key: TIER_KEYS[i] || t.key || TIER_KEYS[0],
  }));
  parsed.features = merged;
  delete parsed.amazon_sidebar_filters;
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

function tierWasScouted(scout) {
  return Boolean(scout?.comparison?.top3?.length);
}

function buildTierRow(frame, index, framework, scout, existingTier) {
  const key = frame.key || TIER_KEYS[index];
  const priceMin = tierMinPrice(frame, index, framework);
  const priceMax = frame.price_max != null ? Number(frame.price_max) : null;
  const mergedScout = scout ?? existingTier?.scout ?? null;
  const scouted = tierWasScouted(mergedScout);

  return {
    key,
    label: frame.label || key,
    subtitle: frame.subtitle || '',
    price_min: priceMin,
    price_max: priceMax,
    feature_adds: frame.feature_adds || [],
    gains_vs_below: frame.feature_adds || [],
    scouted,
    scout: scouted ? mergedScout : (mergedScout || null),
    pick: mergedScout?.comparison?.top3?.[0] || existingTier?.pick || null,
    scout_error: mergedScout?.error || existingTier?.scout_error || null,
    scouted_at: scouted
      ? (existingTier?.scouted_at || new Date().toISOString())
      : (existingTier?.scouted_at || null),
  };
}

function buildAllTierRows(framework, scoutsByKey, existingTiers = []) {
  const existingByKey = Object.fromEntries((existingTiers || []).map((t) => [t.key, t]));
  return framework.map((frame, i) => {
    const key = frame.key || TIER_KEYS[i];
    return buildTierRow(frame, i, framework, scoutsByKey[key], existingByKey[key]);
  });
}

function collectScoutedTierKeys(tiers) {
  return tiers.filter((t) => t.scouted || tierWasScouted(t.scout)).map((t) => t.key);
}

function scoutedTierKeysFromExisting(existing) {
  if (existing?.scouted_tiers?.length) return existing.scouted_tiers;
  return collectScoutedTierKeys(existing?.tiers || []);
}

async function scoutTier(userId, query, frame, index, framework, allCandidates, opts) {
  const { amazonDomain, modelId, shopperPriorities } = opts;
  const priceMin = tierMinPrice(frame, index, framework);
  const priceMax = frame.price_max != null ? Number(frame.price_max) : null;
  const isPro = frame.key === 'pro' || index === framework.length - 1;

  let band = filterByPriceBand(allCandidates, priceMin, isPro ? null : priceMax);
  if (!band.length && priceMin != null) {
    band = filterByPriceBand(allCandidates, null, isPro ? null : priceMax);
  }
  if (!band.length) band = [...allCandidates];

  return executeScoutComparison(userId, query, {
    candidates: band,
    maxPrice: isPro ? null : priceMax,
    amazonDomain,
    modelId,
    tierLabel: frame.label,
    tierFeatures: frame.feature_adds,
    shopperPriorities,
    includeExternals: false,
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
 * Step 2: Product Scout for selected price tiers only.
 */
async function runBuyGuide(userId, {
  query,
  userFeatures,
  budgetHint,
  featureBrief,
  selectedTierKeys,
  runId,
}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');
  if (!featureBrief?.features?.length || !featureBrief?.tier_framework?.length) {
    throw new Error('featureBrief is required — run guide/brief first');
  }

  const framework = featureBrief.tier_framework;
  const keys = normalizeSelectedTierKeys(selectedTierKeys, framework);

  let existing = null;
  if (runId) {
    const run = await getRun(userId, Number(runId));
    if (!run?.result || run.result.mode !== 'guide') throw new Error('Guide run not found');
    existing = run.result;
  }

  const alreadyScouted = new Set(scoutedTierKeysFromExisting(existing));
  const keysToScout = keys.filter((k) => !alreadyScouted.has(k));
  if (!keysToScout.length) {
    throw new Error('Selected tiers are already scouted — pick tiers not yet gathered');
  }

  const amazonDomain = existing?.amazonDomain || await getAmazonDomain(pool);
  const { standard: modelId } = await getModelsForUser(userId);

  const shopperPriorities = (featureBrief.features || [])
    .filter((f) => f.importance === 'must')
    .map(formatFeatureRequirement)
    .filter(Boolean);

  const allCandidates = await searchProducts(q, { maxResults: 40, amazonDomain });
  const scoutsByKey = {};

  for (let i = 0; i < framework.length; i += 1) {
    const frame = framework[i];
    const key = frame.key || TIER_KEYS[i];
    if (!keysToScout.includes(key)) continue;

    scoutsByKey[key] = await scoutTier(
      userId,
      q,
      frame,
      i,
      framework,
      allCandidates,
      { amazonDomain, modelId, shopperPriorities }
    );
  }

  const tiers = buildAllTierRows(framework, scoutsByKey, existing?.tiers || []);
  const scouted_tiers = collectScoutedTierKeys(tiers);

  if (!scouted_tiers.length) {
    throw new Error('No products matched the selected tiers — try a broader search phrase');
  }

  const hint = budgetHint != null && budgetHint !== ''
    ? Number(budgetHint)
    : (existing?.budgetHint ?? null);
  const budget_fit_note = buildBudgetFitNote(hint, framework);

  const result = {
    mode: 'guide',
    query: q,
    userFeatures: userFeatures || existing?.userFeatures || [],
    budgetHint: hint,
    feature_brief: featureBrief,
    tiers,
    scouted_tiers,
    budget_fit_note,
    candidates_fetched: allCandidates.length,
    amazonDomain,
    amazonCountry: marketplaceLabel(amazonDomain),
    url_comparisons: existing?.url_comparisons || [],
  };

  try {
    result.final_recommendation = await generateFinalRecommendation(userId, {
      query: q,
      featureBrief,
      budgetHint: hint,
      tiers,
    });
  } catch (err) {
    console.warn('[productScout] final recommendation failed:', err.message);
    result.final_recommendation = { error: err.message };
  }

  return saveGuideResult(userId, runId && existing ? Number(runId) : null, existing, result);
}

async function refreshGuideRecommendation(userId, runId) {
  const run = await getRun(userId, Number(runId));
  if (!run?.result || run.result.mode !== 'guide') throw new Error('Guide run not found');

  const existing = run.result;
  if (!collectScoutedTierKeys(existing.tiers || []).length) {
    throw new Error('Scout at least one tier first');
  }

  const result = { ...existing };
  try {
    result.final_recommendation = await generateFinalRecommendation(userId, {
      query: existing.query,
      featureBrief: existing.feature_brief,
      budgetHint: existing.budgetHint,
      tiers: existing.tiers,
    });
  } catch (err) {
    result.final_recommendation = { error: err.message };
  }

  return saveGuideResult(userId, Number(runId), existing, result);
}

module.exports = {
  buildGuideBrief,
  runBuyGuide,
  refreshGuideRecommendation,
  saveGuideResult,
  parseFeaturesInput,
  normalizeSelectedTierKeys,
  TIER_KEYS,
};
