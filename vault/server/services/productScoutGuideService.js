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

function buildBriefPrompt(query, userFeatures, budgetHint, { compact = false } = {}) {
  const featuresBlock = userFeatures.length
    ? `Features the shopper thinks they need:\n${userFeatures.map((f) => `- ${f}`).join('\n')}\n`
    : '';

  const budgetBlock = budgetHint
    ? `Budget hint: around $${budgetHint} AUD — use this to anchor Essentials pricing, not as a hard cap.\n`
    : '';

  const filterCount = compact ? '2–3' : '2–5';
  const featureCount = compact
    ? '2–4 additional items total (mix of specs + capabilities)'
    : '4–8 additional items (specs + capabilities)';
  const whyLimit = compact ? 'why_it_matters: max 12 words each.' : 'why_it_matters: one short sentence each.';

  return `Shopping goal: ${query}
${featuresBlock}${budgetBlock}
Return a feature brief and 4-tier framework for Amazon AU-style pricing (AUD).
${whyLimit}
CRITICAL: Emit fields in this exact order so truncation still keeps tiers: summary → tier_framework → amazon_sidebar_filters → features.

1. summary — 1–2 sentences on what matters for THIS use case.
2. tier_framework — REQUIRED, exactly 4 tiers cheapest→pro. Keys must be essentials, smart_upgrade, enthusiast, pro.
   Each: {"key":"...","label":"...","subtitle":"short tagline","price_min":40,"price_max":80,"feature_adds":["what this tier adds"]}
   Non-overlapping bands; each price_min above previous price_max. Pro may use a high price_min and omit price_max (null).
3. amazon_sidebar_filters — ${filterCount} Amazon left-sidebar dimensions for THIS query (type/form-factor first).
   Each: kind "spec", usually spec_type "enum", spec_options with "Any" plus 3–5 realistic values, spec_value "Any".
4. features — ${featureCount}. Do not duplicate sidebar filters.
   a) kind "spec" — measurable (battery h, weight kg, etc.)
   b) kind "feature" — yes/no capabilities (ANC, waterproof, etc.)

Spec shape: {"feature":"<label>","kind":"spec","importance":"must|nice","why_it_matters":"...","spec_type":"numeric_min|numeric_max|enum|text","spec_unit":"<unit or null>","spec_value":<default>,"spec_options":[...]}

JSON only (tier_framework BEFORE filters/features):
{"summary":"...","tier_framework":[{"key":"essentials","label":"Essentials","subtitle":"...","price_min":40,"price_max":80,"feature_adds":["..."]},{"key":"smart_upgrade","label":"Smart upgrade","subtitle":"...","price_min":80,"price_max":150,"feature_adds":["..."]},{"key":"enthusiast","label":"Enthusiast","subtitle":"...","price_min":150,"price_max":300,"feature_adds":["..."]},{"key":"pro","label":"Pro / no budget","subtitle":"...","price_min":300,"price_max":null,"feature_adds":["..."]}],"amazon_sidebar_filters":[{"feature":"Wearing style","kind":"spec","importance":"must","why_it_matters":"...","spec_type":"enum","spec_unit":null,"spec_value":"Any","spec_options":["Any","Over-ear","On-ear","In-ear / earbuds"]}],"features":[{"feature":"Battery life","kind":"spec","importance":"must","why_it_matters":"...","spec_type":"numeric_min","spec_unit":"h","spec_value":30,"spec_options":[20,30,40,50]},{"feature":"Active noise cancelling","kind":"feature","importance":"nice","why_it_matters":"..."}]}`;
}

/** Sensible AUD bands when the model omits tiers (scaled from optional budget hint). */
function defaultTierFramework(budgetHint) {
  const anchor = Number.isFinite(Number(budgetHint)) && Number(budgetHint) > 0
    ? Number(budgetHint)
    : 120;
  const eMax = Math.max(30, Math.round(anchor * 0.4 / 5) * 5);
  const sMax = Math.max(eMax + 25, Math.round(anchor * 0.85 / 5) * 5);
  const enMax = Math.max(sMax + 40, Math.round(anchor * 1.6 / 5) * 5);
  const proMin = enMax;

  return [
    {
      key: 'essentials',
      label: 'Essentials',
      subtitle: 'Solid basics',
      price_min: null,
      price_max: eMax,
      feature_adds: ['Core function at the lowest sensible price'],
    },
    {
      key: 'smart_upgrade',
      label: 'Smart upgrade',
      subtitle: 'Best everyday value',
      price_min: eMax,
      price_max: sMax,
      feature_adds: ['Noticeably better build, comfort, or battery'],
    },
    {
      key: 'enthusiast',
      label: 'Enthusiast',
      subtitle: 'Premium features',
      price_min: sMax,
      price_max: enMax,
      feature_adds: ['Stronger specs and nicer experience'],
    },
    {
      key: 'pro',
      label: 'Pro / no budget',
      subtitle: 'Top of range',
      price_min: proMin,
      price_max: null,
      feature_adds: ['Flagship performance with few compromises'],
    },
  ];
}

function extractTierFramework(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const raw = parsed.tier_framework
    || parsed.tierFramework
    || parsed.tiers
    || parsed.price_tiers
    || parsed.priceTiers
    || [];
  return Array.isArray(raw) ? raw.filter((t) => t && (t.key || t.label || t.price_max != null || t.price_min != null)) : [];
}

function extractSidebarFilters(parsed) {
  const raw = parsed?.amazon_sidebar_filters
    || parsed?.amazonSidebarFilters
    || parsed?.sidebar_filters
    || [];
  return Array.isArray(raw) ? raw : [];
}

function extractFeaturesList(parsed) {
  const raw = parsed?.features || parsed?.feature_list || [];
  return Array.isArray(raw) ? raw : [];
}

function featuresFromUserInput(userFeatures) {
  return (userFeatures || []).slice(0, 8).map((f) => ({
    feature: String(f).trim(),
    kind: 'feature',
    importance: 'must',
    why_it_matters: 'You listed this as a need',
  })).filter((f) => f.feature);
}

async function callGuideModel(userId, modelId, prompt, { system = BRIEF_SYSTEM, maxTokens = 8192 } = {}) {
  const result = await callModel(modelId, prompt, {
    system,
    maxTokens,
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

function parseBriefResponse(text, { userFeatures = [], budgetHint = null, allowDefaultTiers = false } = {}) {
  const rawParsed = parseModelJson(String(text || '').trim());
  const parsed = (rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed))
    ? rawParsed
    : (allowDefaultTiers ? {} : null);
  if (!parsed) {
    throw new Error('Feature brief missing tier framework');
  }

  let tiers = extractTierFramework(parsed);
  if (!tiers.length && allowDefaultTiers) {
    console.warn('[productScout] Brief missing tier_framework — using default AUD bands');
    tiers = defaultTierFramework(budgetHint);
  }
  if (!tiers.length) throw new Error('Feature brief missing tier framework');

  const sidebar = extractSidebarFilters(parsed);
  const rest = extractFeaturesList(parsed);
  let merged = mergeBriefFeatures(sidebar, rest);
  if (!merged.length && userFeatures.length) {
    merged = featuresFromUserInput(userFeatures);
  }
  if (!merged.length) throw new Error('Feature brief missing features list');
  if (!sidebar.length) {
    console.warn('[productScout] Brief missing amazon_sidebar_filters — using merged features only');
  }

  return {
    summary: String(parsed.summary || '').trim(),
    tier_framework: tiers.slice(0, 4).map((t, i) => ({
      ...t,
      key: TIER_KEYS[i] || t.key || TIER_KEYS[0],
    })),
    features: merged,
  };
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
  const key = frame.key || TIER_KEYS[index];

  let band = filterByPriceBand(allCandidates, priceMin, isPro ? null : priceMax);
  let bandSource = 'strict';
  if (!band.length && priceMin != null) {
    band = filterByPriceBand(allCandidates, null, isPro ? null : priceMax);
    bandSource = 'max_only';
  }
  if (!band.length) {
    band = [...allCandidates];
    bandSource = 'all_candidates';
  }

  console.log('[productScout] tier band', {
    key,
    label: frame.label,
    priceMin,
    priceMax: isPro ? null : priceMax,
    pool: allCandidates.length,
    band: band.length,
    bandSource,
    modelId,
    amazonDomain,
  });

  try {
    return await executeScoutComparison(userId, query, {
      candidates: band,
      maxPrice: isPro ? null : priceMax,
      amazonDomain,
      modelId,
      tierLabel: frame.label,
      tierFeatures: frame.feature_adds,
      shopperPriorities,
      includeExternals: false,
    });
  } catch (err) {
    console.error('[productScout] tier scout failed', {
      key,
      message: err.message,
      diagnostics: err.diagnostics || null,
    });
    return {
      error: err.message || 'Tier scout failed',
      candidates_fetched: allCandidates.length,
      comparison: { top3: [], stretch_suggestions: [] },
      diagnostics: {
        stage: 'tier_scout',
        key,
        band: band.length,
        bandSource,
        modelId,
        amazonDomain,
        ...(err.diagnostics || {}),
      },
    };
  }
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
  const attempts = [
    { compact: false, maxTokens: 8192 },
    { compact: true, maxTokens: 4096 },
  ];

  let lastText = '';
  let lastErr;
  for (let i = 0; i < attempts.length; i += 1) {
    const { compact, maxTokens } = attempts[i];
    try {
      lastText = await callGuideModel(
        userId,
        modelId,
        buildBriefPrompt(q, userFeatures, hint, { compact }),
        { maxTokens }
      );
      const brief = parseBriefResponse(lastText, {
        userFeatures,
        budgetHint: hint,
        allowDefaultTiers: false,
      });
      return {
        query: q,
        userFeatures,
        budgetHint: hint,
        feature_brief: brief,
      };
    } catch (err) {
      lastErr = err;
      console.warn(`[productScout] guide brief attempt ${i + 1} failed:`, err.message);
    }
  }

  // Last resort: keep whatever the model returned for features, fill default AUD tiers.
  try {
    const brief = parseBriefResponse(lastText || '{}', {
      userFeatures,
      budgetHint: hint,
      allowDefaultTiers: true,
    });
    return {
      query: q,
      userFeatures,
      budgetHint: hint,
      feature_brief: brief,
    };
  } catch {
    if (userFeatures.length) {
      return {
        query: q,
        userFeatures,
        budgetHint: hint,
        feature_brief: {
          summary: `Shopping for ${q}.`,
          tier_framework: defaultTierFramework(hint),
          features: featuresFromUserInput(userFeatures),
        },
      };
    }
    throw lastErr || new Error('Feature brief missing tier framework');
  }
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

  console.log('[productScout] guide/run start', {
    query: q,
    runId: runId || null,
    keysToScout,
    modelId,
    amazonDomain,
    mustFeatures: shopperPriorities.length,
  });

  let allCandidates;
  try {
    console.log('[productScout] guide Rainforest search', { query: q, amazonDomain, maxResults: 40 });
    allCandidates = await searchProducts(q, { maxResults: 40, amazonDomain });
  } catch (err) {
    console.error('[productScout] guide Rainforest failed', {
      message: err.message,
      diagnostics: err.diagnostics || null,
    });
    err.diagnostics = {
      stage: 'guide_rainforest',
      amazonDomain,
      modelId,
      ...(err.diagnostics || {}),
    };
    throw err;
  }

  console.log('[productScout] guide candidates', {
    count: allCandidates.length,
    samplePrices: allCandidates.slice(0, 8).map((c) => c.price_display || c.price),
  });

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
  const failedTiers = tiers.filter((t) => keysToScout.includes(t.key) && t.scout_error);

  if (!scouted_tiers.length) {
    const firstFail = failedTiers[0];
    const err = new Error(
      firstFail?.scout_error
      || 'No products matched the selected tiers — try a broader search phrase'
    );
    err.diagnostics = {
      stage: 'guide_no_scouted_tiers',
      modelId,
      amazonDomain,
      candidates: allCandidates.length,
      keysToScout,
      failed: failedTiers.map((t) => ({
        key: t.key,
        error: t.scout_error,
        diagnostics: t.scout?.diagnostics || null,
      })),
    };
    console.error('[productScout] guide/run no scouted tiers', err.diagnostics);
    throw err;
  }

  if (failedTiers.length) {
    console.warn('[productScout] guide/run partial tier failures', failedTiers.map((t) => ({
      key: t.key,
      error: t.scout_error,
    })));
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
