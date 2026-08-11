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
const { looksLikeMonoCallHeadset, queryWantsStereoAudioWearable } = require('./productScoutRelevance');

const TIER_KEYS = ['essentials', 'smart_upgrade', 'enthusiast', 'pro'];

const BRIEF_SYSTEM = `You are a product buying advisor for Amazon shoppers.
For EVERY product category, start from Amazon's left-sidebar filters — the standard dimensions shoppers click to narrow results (type, form factor, size, style, connectivity, capacity, etc.). These differ per category; infer the correct set from the search query.
Return ONLY valid JSON. No markdown fences.`;

const RECOMMEND_SYSTEM = `You are an unbiased product analyst. Recommend the single best VALUE FOR MONEY pick across price tiers for this shopper — not the most expensive or cheapest by default.
Shopper-compared Amazon URLs are first-class candidates: if one fits the use case as well or better at a lower or similar price, pick it (tier_key "compared_url") — do not ignore cheaper good options just because a higher tier was scouted.
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

/**
 * Fold must-have specs/features into the Amazon search phrase so Rainforest
 * results reflect the edited brief — not only the original free-text query.
 */
function buildEnrichedSearchQuery(baseQuery, featureBrief) {
  const base = String(baseQuery || '').trim();
  const terms = [];
  const seen = new Set(base.toLowerCase().split(/\s+/).filter(Boolean));

  const pushTerm = (raw) => {
    const t = String(raw || '').trim();
    if (!t || t.length < 2) return;
    const lower = t.toLowerCase();
    if (lower === 'any' || lower === 'no preference' || lower === 'n/a') return;
    if (seen.has(lower)) return;
    // Avoid dumping long sentences into the search box
    if (t.split(/\s+/).length > 4) return;
    seen.add(lower);
    terms.push(t);
  };

  for (const f of featureBrief?.features || []) {
    if (!f || f.importance === 'skip') continue;
    if (f.kind === 'spec' && f.spec_value != null && f.spec_value !== '') {
      const v = String(f.spec_value).trim();
      if (/^any$/i.test(v) || /^no preference$/i.test(v)) continue;
      if (f.spec_type === 'numeric_min' || f.spec_type === 'numeric_max') {
        // Numbers alone are weak Amazon terms; keep label+value compact when short
        const unit = f.spec_unit || '';
        pushTerm(`${v}${unit}`);
        continue;
      }
      pushTerm(v);
      continue;
    }
    if (f.kind === 'feature' && f.importance === 'must') {
      pushTerm(f.feature);
    }
  }

  const enriched = [base, ...terms.slice(0, 6)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return enriched.slice(0, 180) || base;
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

function collectUrlComparisonPicks(urlComparisons) {
  return (urlComparisons || [])
    .filter((e) => e?.product?.title)
    .map((e, i) => {
      const p = e.product;
      return {
        tier_key: 'compared_url',
        tier_label: 'Compared URL',
        price_band: 'shopper-added',
        asin: p.asin || e.asin,
        title: p.title,
        price: p.price_display || p.price,
        value_score: null,
        pre_score: null,
        rating: p.rating,
        review_count: p.review_count,
        key_features: (p.feature_bullets || []).slice(0, 4),
        value_rationale: e.analysis?.upgrade_benefits
          ? String(e.analysis.upgrade_benefits).slice(0, 200)
          : 'Shopper-compared Amazon listing',
        link: p.link || e.url,
        prefer_url_over_picks: e.analysis?.prefer_url_over_picks === true,
        source: 'url_comparison',
        compared_index: i,
      };
    });
}

function buildRecommendationPrompt(query, featureBrief, budgetHint, tierPicks, urlPicks = []) {
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

  const urlBlock = urlPicks.length
    ? `\nShopper-compared Amazon URLs (FIRST-CLASS candidates — do not ignore these even if cheaper than scouted tiers or outside a scouted band):\n${urlPicks.map((p) => (
      `Compared URL: ${p.title}
ASIN: ${p.asin || '—'}
Price: ${p.price || '—'}
Rating: ${p.rating ?? '—'} · ${p.review_count ?? '—'} reviews
Key features: ${(p.key_features || []).slice(0, 4).join('; ') || '—'}
Compare note: ${p.value_rationale || '—'}
Marked better value than picks: ${p.prefer_url_over_picks ? 'yes' : 'unspecified'}`
    )).join('\n\n')}\n`
    : '';

  return `Shopping goal: ${query}
${budgetBlock}Brief summary: ${featureBrief?.summary || '—'}
Must-have features: ${mustFeatures.join(', ') || 'see brief'}
Nice-to-have: ${niceFeatures.join(', ') || '—'}

One top pick per scouted price tier (already ranked within tier):
${picksBlock}
${urlBlock}
Choose ONE overall best value-for-money product for THIS shopper.
You MAY pick a compared URL when it fits the use case better or costs less for equal/better capability — cheaper good options must not be ignored just because a higher tier was scouted.
If only one tier was scouted, say the verdict is provisional until adjacent tiers are searched.
Explain tradeoffs. Say who should step up or stay down.

JSON only:
{"headline":"One sentence verdict","rationale":"2-3 short paragraphs, plain text, no markdown","pick":{"tier_key":"essentials|smart_upgrade|enthusiast|pro|compared_url","tier_label":"...","asin":"...","title":"...","price":"...","value_score":85},"worth_stepping_up":"When paying more is justified, or null","worth_staying_down":"When cheaper is enough, or null"}`;
}

function parseRecommendationResponse(text, tierPicks, urlPicks = []) {
  const parsed = parseModelJson(String(text || '').trim());
  if (!parsed?.pick?.title) throw new Error('Recommendation missing pick');

  const allPicks = [...tierPicks, ...urlPicks];
  const byAsin = Object.fromEntries(allPicks.filter((p) => p.asin).map((p) => [p.asin, p]));
  const byTier = Object.fromEntries(tierPicks.map((p) => [p.tier_key, p]));
  const latestPreferredUrl = [...urlPicks].reverse().find((p) => p.prefer_url_over_picks) || null;
  const src = byAsin[parsed.pick.asin]
    || (parsed.pick.tier_key === 'compared_url'
      ? (latestPreferredUrl || urlPicks[urlPicks.length - 1] || urlPicks[0])
      : null)
    || byTier[parsed.pick.tier_key];

  if (src) {
    parsed.pick.link = parsed.pick.link || src.link;
    parsed.pick.price = parsed.pick.price || src.price;
    parsed.pick.asin = parsed.pick.asin || src.asin;
    parsed.pick.tier_key = parsed.pick.tier_key || src.tier_key;
    parsed.pick.tier_label = parsed.pick.tier_label || src.tier_label;
    parsed.pick.value_score = parsed.pick.value_score ?? src.value_score;
    if (src.source) parsed.pick.source = src.source;
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

function pickFromUrlComparison(urlPick) {
  return {
    tier_key: 'compared_url',
    tier_label: 'Compared URL',
    asin: urlPick.asin,
    title: urlPick.title,
    price: urlPick.price,
    link: urlPick.link,
    value_score: urlPick.value_score,
    source: 'url_comparison',
  };
}

/** Prefer shopper-compared URLs when flagged, or when tier winner is a form-factor mismatch. */
function reconcileRecommendationWithUrls(rec, query, urlPicks) {
  if (!rec?.pick || !urlPicks?.length) return rec;

  const preferredFlagged = [...urlPicks].reverse().find((p) => p.prefer_url_over_picks) || null;
  const mismatch = queryWantsStereoAudioWearable(query)
    && looksLikeMonoCallHeadset(rec.pick.title);
  const preferred = preferredFlagged
    || (mismatch
      ? [...urlPicks].reverse().find((p) => !looksLikeMonoCallHeadset(p.title))
      : null);

  if (!preferred?.title) return rec;

  const alreadyUrl = rec.pick.tier_key === 'compared_url'
    || (preferred.asin && rec.pick.asin && preferred.asin === rec.pick.asin);
  if (alreadyUrl) return rec;

  if (!preferredFlagged && !mismatch) return rec;

  return {
    ...rec,
    headline: `${preferred.title} is better value than the scouted tier winner for this use case.`,
    rationale: [
      rec.rationale,
      `Your compared listing (${preferred.price || 'price n/a'}) fits the search better and/or costs less than the scouted pick — it is included as a first-class option, not ignored because it sits in another price band.`,
    ].filter(Boolean).join('\n\n'),
    pick: pickFromUrlComparison(preferred),
    ranking_note: mismatch && !preferredFlagged ? 'preferred_url_form_factor' : 'preferred_compared_url',
    generated_at: new Date().toISOString(),
  };
}

function fallbackRecommendation(query, tierPicks, urlPicks) {
  const preferred = [...urlPicks].reverse().find((p) => p.prefer_url_over_picks)
    || (queryWantsStereoAudioWearable(query)
      ? urlPicks.find((p) => !looksLikeMonoCallHeadset(p.title))
      : null)
    || urlPicks[urlPicks.length - 1]
    || null;

  const tierWinner = tierPicks[0] || null;
  const useUrl = preferred && (
    preferred.prefer_url_over_picks
    || !tierWinner
    || (queryWantsStereoAudioWearable(query) && looksLikeMonoCallHeadset(tierWinner.title))
  );

  const pick = useUrl ? pickFromUrlComparison(preferred) : {
    tier_key: tierWinner.tier_key,
    tier_label: tierWinner.tier_label,
    asin: tierWinner.asin,
    title: tierWinner.title,
    price: tierWinner.price,
    link: tierWinner.link,
    value_score: tierWinner.value_score,
  };

  return {
    headline: useUrl
      ? `${pick.title} wins on value once your compared URL is included.`
      : `${pick.title} leads among scouted tiers (listing-stats fallback).`,
    rationale: useUrl
      ? 'AI recommendation was unavailable. Your compared Amazon listing was preferred because it looks like equal/better fit at a lower or similar price than the scouted tier winner.'
      : 'AI recommendation was unavailable. Ranking used the top scouted-tier pick from listing stats only.',
    pick,
    worth_stepping_up: null,
    worth_staying_down: null,
    ranking_fallback: 'listing_stats',
    generated_at: new Date().toISOString(),
  };
}

async function generateFinalRecommendation(userId, {
  query,
  featureBrief,
  budgetHint,
  tiers,
  urlComparisons = [],
}) {
  const tierPicks = collectTierPicks(tiers);
  const urlPicks = collectUrlComparisonPicks(urlComparisons);
  if (!tierPicks.length && !urlPicks.length) {
    throw new Error('Scout at least one tier before generating a recommendation');
  }

  let rec;
  try {
    const { standard: modelId } = await getModelsForUser(userId);
    const text = await callGuideModel(
      userId,
      modelId,
      buildRecommendationPrompt(query, featureBrief, budgetHint, tierPicks, urlPicks),
      { system: RECOMMEND_SYSTEM }
    );
    rec = parseRecommendationResponse(text, tierPicks, urlPicks);
  } catch (err) {
    console.warn('[productScout] final recommendation LLM failed, using fallback:', err.message);
    rec = fallbackRecommendation(query, tierPicks, urlPicks);
  }

  return reconcileRecommendationWithUrls(rec, query, urlPicks);
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
CRITICAL: Emit fields in this exact order so truncation still keeps tiers: summary → recommended_tier_key → recommended_tier_why → tier_framework → amazon_sidebar_filters → features.

1. summary — 1–2 sentences on what matters for THIS use case.
2. recommended_tier_key — REQUIRED. The single best STARTING tier (search here first). Keys: essentials | smart_upgrade | enthusiast | pro.
   Pick the LOWEST tier that usually satisfies MUST-haves only. Nice-to-haves must NOT bump the starting tier.
   Amazon deals and mid-band bestsellers often meet everyday needs — prefer smart_upgrade over enthusiast when unsure.
   Examples: everyday Bluetooth earbuds (fit, battery, pairing) → essentials or smart_upgrade; usable ANC as a must → still smart_upgrade; adaptive/hybrid ANC + premium codecs as musts → enthusiast; "best / no compromise" → pro.
3. recommended_tier_why — one short sentence (max 20 words) on must-have fit. Mention that shoppers can climb one band if results miss a must.
4. tier_framework — REQUIRED, exactly 4 tiers cheapest→pro. Keys must be essentials, smart_upgrade, enthusiast, pro.
   Each: {"key":"...","label":"...","subtitle":"one-line focus for this band","price_min":40,"price_max":80,"feature_adds":["what this tier typically adds vs the one below"]}
   Non-overlapping bands; each price_min above previous price_max. Pro may use a high price_min and omit price_max (null).
   feature_adds: exactly 3 short bullets per tier describing capability gains (not marketing fluff). Essentials = what you get at entry; higher tiers = what you GAIN vs the tier below (battery, ANC quality, codecs, build, brand polish, etc. — tailored to THIS product).
5. amazon_sidebar_filters — ${filterCount} Amazon left-sidebar dimensions for THIS query (type/form-factor first).
   Each: kind "spec", usually spec_type "enum", spec_options with "Any" plus 3–5 realistic values, spec_value "Any".
6. features — ${featureCount}. Do not duplicate sidebar filters.
   a) kind "spec" — measurable (battery h, weight kg, etc.)
   b) kind "feature" — yes/no capabilities (ANC, waterproof, etc.)

Spec shape: {"feature":"<label>","kind":"spec","importance":"must|nice","why_it_matters":"...","spec_type":"numeric_min|numeric_max|enum|text","spec_unit":"<unit or null>","spec_value":<default>,"spec_options":[...]}

JSON only (recommended tier BEFORE tier_framework):
{"summary":"...","recommended_tier_key":"smart_upgrade","recommended_tier_why":"Everyday ANC and battery usually land in this band.","tier_framework":[{"key":"essentials","label":"Essentials","subtitle":"...","price_min":40,"price_max":80,"feature_adds":["..."]},{"key":"smart_upgrade","label":"Smart upgrade","subtitle":"...","price_min":80,"price_max":150,"feature_adds":["..."]},{"key":"enthusiast","label":"Enthusiast","subtitle":"...","price_min":150,"price_max":300,"feature_adds":["..."]},{"key":"pro","label":"Pro / no budget","subtitle":"...","price_min":300,"price_max":null,"feature_adds":["..."]}],"amazon_sidebar_filters":[{"feature":"Wearing style","kind":"spec","importance":"must","why_it_matters":"...","spec_type":"enum","spec_unit":null,"spec_value":"Any","spec_options":["Any","Over-ear","On-ear","In-ear / earbuds"]}],"features":[{"feature":"Battery life","kind":"spec","importance":"must","why_it_matters":"...","spec_type":"numeric_min","spec_unit":"h","spec_value":30,"spec_options":[20,30,40,50]},{"feature":"Active noise cancelling","kind":"feature","importance":"nice","why_it_matters":"..."}]}`;
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
      subtitle: 'Basics that work — lowest sensible spend',
      price_min: null,
      price_max: eMax,
      feature_adds: [
        'Core function without premium extras',
        'Accept shorter battery or simpler build',
        'Fine when must-haves are few and basic',
      ],
    },
    {
      key: 'smart_upgrade',
      label: 'Smart upgrade',
      subtitle: 'Everyday sweet spot — where most shoppers stop',
      price_min: eMax,
      price_max: sMax,
      feature_adds: [
        'Noticeably better battery, fit, or reliability',
        'Daily features that matter (e.g. usable ANC, stabler connection)',
        'Best value before diminishing returns',
      ],
    },
    {
      key: 'enthusiast',
      label: 'Enthusiast',
      subtitle: 'Serious performance and brand-tier extras',
      price_min: sMax,
      price_max: enMax,
      feature_adds: [
        'Stronger specialty features (better ANC, codecs, sensors)',
        'Convenience polish (wireless charge, ambient modes, better calls)',
        'Pay for refinement — not just “it works”',
      ],
    },
    {
      key: 'pro',
      label: 'Pro / no budget',
      subtitle: 'Flagship / no-compromise',
      price_min: proMin,
      price_max: null,
      feature_adds: [
        'Best-in-class performance for the category',
        'Ecosystem and brand premium (e.g. AirPods-class)',
        'Only worth it if you need the top experience',
      ],
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

const PREMIUM_RE = /\b(adaptive\s*anc|hybrid\s*anc|flagship|audiophile|hi-?res|ldac|aptx\s*adaptive|studio|\bpro\b|oled|4k|120hz|rtx|gaming|ip6[78]|macbook\s*pro|mirrorless|full[\s-]?frame)\b/i;
const ANC_EVERYDAY_RE = /\b(anc|active\s*noise|noise\s*cancell)\b/i;
const BASIC_RE = /\b(basic|budget|simple|casual|entry[\s-]?level|bluetooth\s*only|everyday)\b/i;

/** Lowest starting tier for must-haves. Never auto-upgrade to Enthusiast+ just because the LLM aims high — deals often sit one band lower. */
function resolveRecommendedTier({
  features = [],
  budgetHint = null,
  tierFramework = [],
  llmKey = null,
  llmWhy = null,
} = {}) {
  const must = (features || []).filter((f) => f && f.importance === 'must');
  const mustText = must
    .map((f) => [f.feature, f.spec_value, f.why_it_matters].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();

  let idx = 1;
  let why = 'Smart upgrade is the everyday sweet spot — many Best Deal–class products land here.';

  if (BASIC_RE.test(mustText) && must.length <= 2 && !PREMIUM_RE.test(mustText)) {
    idx = 0;
    why = 'Your must-haves look basic — Essentials is often enough.';
  }
  if (ANC_EVERYDAY_RE.test(mustText) && !PREMIUM_RE.test(mustText)) {
    idx = Math.max(idx, 1);
    why = 'Everyday ANC usually appears in Smart upgrade; search Enthusiast only if results feel weak.';
  }
  if (PREMIUM_RE.test(mustText) || must.length >= 5) {
    idx = Math.max(idx, 2);
    why = 'Several premium must-haves usually appear in the Enthusiast band and above.';
  }
  if (/\b(best|no budget|top.?of.?range|flagship|uncompromising)\b/i.test(mustText)) {
    idx = 3;
    why = 'Your requirements point at flagship / Pro-tier products.';
  }

  const hint = Number(budgetHint);
  if (Number.isFinite(hint) && hint > 0 && tierFramework?.length) {
    const matchIdx = tierFramework.findIndex((t) => {
      const min = t.price_min != null ? Number(t.price_min) : null;
      const max = t.price_max != null ? Number(t.price_max) : null;
      if (Number.isFinite(min) && Number.isFinite(max)) return hint >= min && hint <= max;
      if (Number.isFinite(max)) return hint <= max;
      if (Number.isFinite(min)) return hint >= min;
      return false;
    });
    if (matchIdx >= 0) {
      idx = matchIdx;
      const label = tierFramework[matchIdx]?.label || TIER_KEYS[matchIdx];
      why = `Your ~$${hint} budget aligns with ${label} — a practical starting search.`;
    }
  }

  const llmIdx = TIER_KEYS.indexOf(String(llmKey || '').trim());
  if (llmIdx >= 0) {
    if (llmIdx <= idx) {
      // LLM agrees or aims lower — take the cheaper start.
      idx = llmIdx;
      if (llmWhy && String(llmWhy).trim()) why = String(llmWhy).trim();
    } else {
      // LLM aimed higher (e.g. Enthusiast). Keep the lower heuristic start so
      // shoppers see deal-band products first; they can climb after.
      why = `${why} Climb one tier only if a must-have is missing.`;
    }
  }

  return {
    recommended_tier_key: TIER_KEYS[idx] || 'smart_upgrade',
    recommended_tier_why: String(why).slice(0, 160),
  };
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

  const normalizedTiers = tiers.slice(0, 4).map((t, i) => {
    const key = TIER_KEYS[i] || t.key || TIER_KEYS[0];
    const defaults = {
      essentials: {
        subtitle: 'Basics that work — lowest sensible spend',
        feature_adds: [
          'Core function without premium extras',
          'Accept shorter battery or simpler build',
          'Fine when must-haves are few and basic',
        ],
      },
      smart_upgrade: {
        subtitle: 'Everyday sweet spot — where most shoppers stop',
        feature_adds: [
          'Noticeably better battery, fit, or reliability',
          'Daily features that matter (e.g. usable ANC, stabler connection)',
          'Best value before diminishing returns',
        ],
      },
      enthusiast: {
        subtitle: 'Serious performance and brand-tier extras',
        feature_adds: [
          'Stronger specialty features (better ANC, codecs, sensors)',
          'Convenience polish (wireless charge, ambient modes, better calls)',
          'Pay for refinement — not just “it works”',
        ],
      },
      pro: {
        subtitle: 'Flagship / no-compromise',
        feature_adds: [
          'Best-in-class performance for the category',
          'Ecosystem and brand premium (e.g. AirPods-class)',
          'Only worth it if you need the top experience',
        ],
      },
    }[key] || {};

    const adds = (t.feature_adds || []).map((g) => String(g || '').trim()).filter(Boolean);
    return {
      ...t,
      key,
      subtitle: String(t.subtitle || '').trim() || defaults.subtitle || '',
      feature_adds: adds.length ? adds.slice(0, 4) : (defaults.feature_adds || []),
    };
  });

  return {
    summary: String(parsed.summary || '').trim(),
    tier_framework: normalizedTiers,
    features: merged,
    ...resolveRecommendedTier({
      features: merged,
      budgetHint,
      tierFramework: normalizedTiers,
      llmKey: parsed.recommended_tier_key || parsed.recommendedTierKey,
      llmWhy: parsed.recommended_tier_why || parsed.recommendedTierWhy,
    }),
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

function buildTierPriceSearchQuery(baseQuery, priceMin, priceMax, isPro) {
  const base = String(baseQuery || '').trim();
  if (isPro && priceMin != null && Number.isFinite(priceMin)) {
    return `${base} over $${Math.round(priceMin)}`.replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  if (priceMin != null && priceMax != null && Number.isFinite(priceMin) && Number.isFinite(priceMax)) {
    return `${base} $${Math.round(priceMin)}-$${Math.round(priceMax)}`.replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  if (priceMax != null && Number.isFinite(priceMax)) {
    return `${base} under $${Math.round(priceMax)}`.replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  return base.slice(0, 180);
}

function formatBandLabel(priceMin, priceMax, isPro) {
  if (isPro && priceMin != null) return `from $${Math.round(priceMin)}`;
  if (priceMin != null && priceMax != null) return `$${Math.round(priceMin)}–$${Math.round(priceMax)}`;
  if (priceMax != null) return `up to $${Math.round(priceMax)}`;
  if (priceMin != null) return `from $${Math.round(priceMin)}`;
  return 'this tier';
}

async function scoutTier(userId, query, frame, index, framework, allCandidates, opts) {
  const { amazonDomain, modelId, shopperPriorities, searchQuery } = opts;
  const priceMin = tierMinPrice(frame, index, framework);
  const priceMax = frame.price_max != null ? Number(frame.price_max) : null;
  const isPro = frame.key === 'pro' || index === framework.length - 1;
  const key = frame.key || TIER_KEYS[index];
  const bandLabel = formatBandLabel(priceMin, isPro ? null : priceMax, isPro);
  const baseSearch = searchQuery || query;

  // Strict band only — never widen to cheaper products (that put $20 earbuds in Enthusiast).
  let band = filterByPriceBand(allCandidates, priceMin, isPro ? null : priceMax);
  let bandSource = 'shared_pool_strict';

  if (!band.length) {
    const tierQuery = buildTierPriceSearchQuery(baseSearch, priceMin, isPro ? null : priceMax, isPro);
    const sortBy = priceMin != null && priceMin >= 80 ? 'price_high_to_low' : null;
    console.log('[productScout] tier band empty in shared pool — refetch', {
      key,
      bandLabel,
      tierQuery,
      sortBy,
    });
    try {
      const refetch = await searchProducts(tierQuery, {
        maxResults: 40,
        amazonDomain,
        sortBy,
      });
      band = filterByPriceBand(refetch, priceMin, isPro ? null : priceMax);
      bandSource = 'tier_refetch_strict';
    } catch (err) {
      console.warn('[productScout] tier refetch failed:', err.message);
      return {
        error: `No products in ${bandLabel} (${err.message})`,
        candidates_fetched: allCandidates.length,
        comparison: { top3: [], stretch_suggestions: [] },
        diagnostics: {
          stage: 'tier_refetch',
          key,
          bandLabel,
          message: err.message,
          ...(err.diagnostics || {}),
        },
      };
    }
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
    samplePrices: band.slice(0, 5).map((c) => c.price_display || c.price),
  });

  if (!band.length) {
    return {
      error: `No Amazon listings found in ${bandLabel}. Top search results were outside this range — try Smart upgrade, or a more specific brand/model search.`,
      candidates_fetched: allCandidates.length,
      comparison: { top3: [], stretch_suggestions: [] },
      diagnostics: {
        stage: 'tier_band_empty',
        key,
        bandLabel,
        priceMin,
        priceMax: isPro ? null : priceMax,
        pool: allCandidates.length,
        bandSource,
      },
    };
  }

  try {
    return await executeScoutComparison(userId, query, {
      candidates: band,
      minPrice: priceMin,
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
          ...resolveRecommendedTier({
            features: featuresFromUserInput(userFeatures),
            budgetHint: hint,
            tierFramework: defaultTierFramework(hint),
          }),
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

  const searchQuery = buildEnrichedSearchQuery(q, featureBrief);

  console.log('[productScout] guide/run start', {
    query: q,
    searchQuery,
    runId: runId || null,
    keysToScout,
    modelId,
    amazonDomain,
    mustFeatures: shopperPriorities,
  });

  let allCandidates;
  try {
    console.log('[productScout] guide Rainforest search', {
      query: q,
      searchQuery,
      amazonDomain,
      maxResults: 40,
    });
    allCandidates = await searchProducts(searchQuery, { maxResults: 40, amazonDomain });
  } catch (err) {
    console.error('[productScout] guide Rainforest failed', {
      message: err.message,
      diagnostics: err.diagnostics || null,
    });
    err.diagnostics = {
      stage: 'guide_rainforest',
      amazonDomain,
      modelId,
      searchQuery,
      ...(err.diagnostics || {}),
    };
    throw err;
  }

  console.log('[productScout] guide candidates', {
    count: allCandidates.length,
    searchQuery,
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
      { amazonDomain, modelId, shopperPriorities, searchQuery }
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
    search_query: searchQuery,
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
      urlComparisons: result.url_comparisons,
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
      urlComparisons: existing.url_comparisons || [],
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
  generateFinalRecommendation,
  saveGuideResult,
  parseFeaturesInput,
  normalizeSelectedTierKeys,
  TIER_KEYS,
};
