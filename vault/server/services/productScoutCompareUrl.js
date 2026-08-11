'use strict';

const { pool } = require('../db');
const { fetchProduct } = require('./rainforestClient');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { getAmazonDomain } = require('./productScoutSettings');
const { getRun } = require('./productScoutService');

const COMPARE_URL_SYSTEM = `You are an unbiased product analyst helping a shopper decide whether an Amazon listing is worth stretching their budget for.
Compare the URL product against their current budget picks using only supplied listing data — do not invent specs.
The URL product may be cheaper, similar, or more expensive than the picks — judge fairly either way.
Be honest when the budget picks already meet expectations for the use case.
Return ONLY a single valid JSON object. No markdown fences. No prose before or after.`;

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
    tier_label: item.tier_label || null,
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

function parseMoney(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const m = String(value ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function buildCompareUrlPrompt({ query, budget, urlProduct, budgetPicks }, { compact = false } = {}) {
  const budgetBlock = budget?.maxPrice
    ? `Shopper budget: max $${budget.maxPrice}.\n`
    : 'Shopper did not set a strict max price — infer sensible budget tiers from the picks.\n';

  const picksJson = JSON.stringify(budgetPicks.map(compactPick));
  const summaryLimit = compact
    ? 'upgrade_benefits and budget_guidance: max 60 words each. feature_gaps: 3 items max.'
    : 'upgrade_benefits and budget_guidance: one short paragraph each.';

  return `Original search: ${query}
${budgetBlock}
BUDGET PICKS (ranked — may span price tiers):
${picksJson}

URL PRODUCT (may be cheaper, similar, or premium vs picks):
${JSON.stringify(compactUrlProduct(urlProduct))}

${summaryLimit}

Return JSON only:
{"upgrade_benefits":"...","budget_guidance":"...","feature_gaps":["..."],"worth_stretching":true,"budget_already_adequate":false,"prefer_url_over_picks":false,"recommended_budget_min":150,"recommended_budget_max":250,"recommended_budget_note":"short label"}

prefer_url_over_picks: true when the URL product is equal/better for the use case at a lower or similar price than the budget picks (cheaper good options must not be ignored). false when budget picks remain the better overall value.`;
}

function parseCompareUrlResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    const err = new Error('AI returned an empty comparison response');
    err.code = 'llm_empty';
    throw err;
  }

  const parsed = parseModelJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('AI did not return valid comparison JSON');
    err.code = 'llm_bad_json';
    err.preview = raw.slice(0, 200).replace(/\s+/g, ' ');
    throw err;
  }
  if (!parsed.upgrade_benefits?.trim() || !parsed.budget_guidance?.trim()) {
    const err = new Error('AI comparison missing required paragraphs');
    err.code = 'llm_missing_fields';
    throw err;
  }
  if (!Array.isArray(parsed.feature_gaps)) parsed.feature_gaps = [];
  return parsed;
}

function fallbackCompareAnalysis(product, budgetPicks, budget) {
  const urlPrice = parseMoney(product.price ?? product.price_display);
  const pickPrices = budgetPicks
    .map((p) => parseMoney(p.price ?? p.price_display))
    .filter((n) => Number.isFinite(n));
  const avgPick = pickPrices.length
    ? pickPrices.reduce((a, b) => a + b, 0) / pickPrices.length
    : null;

  let priceNote = 'Price comparison unavailable from listing data.';
  let worth_stretching = false;
  if (urlPrice != null && avgPick != null) {
    const delta = urlPrice - avgPick;
    if (delta > avgPick * 0.15) {
      priceNote = `This listing (~$${Math.round(urlPrice)}) is meaningfully above your picks (avg ~$${Math.round(avgPick)}).`;
      worth_stretching = false;
    } else if (delta < -avgPick * 0.1) {
      priceNote = `This listing (~$${Math.round(urlPrice)}) is cheaper than your picks (avg ~$${Math.round(avgPick)}).`;
    } else {
      priceNote = `This listing (~$${Math.round(urlPrice)}) is in a similar price band to your picks (avg ~$${Math.round(avgPick)}).`;
    }
  }

  const bullets = (product.feature_bullets || []).slice(0, 4);
  const gaps = bullets.length
    ? bullets.map((b) => String(b).slice(0, 80))
    : ['Detailed feature gaps need a successful AI compare — retry or switch model in Settings.'];

  const budgetMax = budget?.maxPrice != null ? Number(budget.maxPrice) : null;
  const recommended_budget_min = urlPrice != null
    ? Math.round(urlPrice * 0.85)
    : (budgetMax != null ? Math.round(budgetMax) : null);
  const recommended_budget_max = urlPrice != null
    ? Math.round(urlPrice * 1.15)
    : (budgetMax != null ? Math.round(budgetMax * 1.4) : null);

  return {
    upgrade_benefits: `${product.title || 'This product'} vs your scout picks. ${priceNote} AI comparison was unavailable, so this is based on listing price and bullets only.`,
    budget_guidance: urlPrice != null
      ? `If you like this listing’s features, budget around $${recommended_budget_min}–$${recommended_budget_max} AUD and re-check reviews on Amazon. Retry Compare URL after switching model in Settings for a fuller write-up.`
      : 'Retry Compare URL or switch model in Settings for fuller budget guidance.',
    feature_gaps: gaps,
    worth_stretching,
    budget_already_adequate: avgPick != null && urlPrice != null ? urlPrice <= avgPick * 1.1 : null,
    prefer_url_over_picks: urlPrice != null && avgPick != null && urlPrice <= avgPick,
    recommended_budget_min,
    recommended_budget_max,
    recommended_budget_note: 'Listing-stats fallback',
    ranking_fallback: 'listing_stats',
  };
}

function derivePreferUrlOverPicks(analysis, product, budgetPicks) {
  if (analysis?.prefer_url_over_picks === true) return true;
  if (analysis?.prefer_url_over_picks === false) {
    // Still override when URL is clearly cheaper with similar/better rating — LLM sometimes
    // frames "don't stretch" without flipping prefer_url when the URL is the better deal.
  }

  const urlPrice = parseMoney(product.price ?? product.price_display);
  const top = budgetPicks[0];
  const pickPrice = parseMoney(top?.price ?? top?.price_display);
  const urlRating = Number(product.rating);
  const pickRating = Number(top?.rating);

  if (urlPrice != null && pickPrice != null && urlPrice <= pickPrice) {
    const ratingOk = !Number.isFinite(urlRating)
      || !Number.isFinite(pickRating)
      || urlRating >= pickRating - 0.15;
    if (ratingOk) return true;
  }

  // "Don't stretch" + cheaper URL usually means the URL already wins on value.
  if (
    analysis?.worth_stretching === false
    && urlPrice != null
    && pickPrice != null
    && urlPrice < pickPrice
  ) {
    return true;
  }

  return analysis?.prefer_url_over_picks === true;
}

function suggestTierKeyForPrice(price, tiers) {
  if (!Number.isFinite(price) || price <= 0 || !Array.isArray(tiers)) return null;
  for (const t of tiers) {
    const min = t.price_min != null ? Number(t.price_min) : null;
    const max = t.price_max != null ? Number(t.price_max) : null;
    const aboveMin = min == null || !Number.isFinite(min) || price >= min;
    const belowMax = max == null || !Number.isFinite(max) || price <= max;
    if (aboveMin && belowMax) return t.key || null;
  }
  return null;
}

function resolveBudgetPicks(scout) {
  if (scout?.mode === 'guide') {
    const picks = [];
    for (const tier of scout.tiers || []) {
      const top = tier.scout?.comparison?.top3?.[0] || tier.pick;
      if (top?.title) {
        picks.push({ ...top, rank: picks.length + 1, tier_label: tier.label });
      }
    }
    return picks;
  }
  const comparison = scout?.comparison;
  const top3 = comparison?.top3 || [];
  if (top3.length) return top3;
  return comparison?.stretch_suggestions || [];
}

function resolveBudgetContext(scout) {
  if (scout?.mode === 'guide' && scout.budgetHint) {
    return { maxPrice: scout.budgetHint, note: 'buy guide budget hint' };
  }
  return scout?.budget || null;
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
  if (!scout || (scout.mode !== 'guide' && !scout.comparison)) {
    throw new Error('Run an Amazon search first, then compare a URL against those picks');
  }

  const budgetPicks = resolveBudgetPicks(scout);
  if (!budgetPicks.length) {
    throw new Error('No budget picks to compare against — run a scout with in-budget results');
  }

  const amazonDomain = scout.amazonDomain || await getAmazonDomain(pool);
  console.log('[productScout] compare-url fetch', {
    url: trimmedUrl.slice(0, 120),
    amazonDomain,
    pickCount: budgetPicks.length,
    query: scout.query,
  });

  let product;
  let sourceUrl;
  try {
    ({ product, sourceUrl } = await fetchProduct(trimmedUrl, amazonDomain));
  } catch (err) {
    console.error('[productScout] compare-url Rainforest failed', {
      message: err.message,
      diagnostics: err.diagnostics || null,
    });
    err.diagnostics = {
      stage: 'compare_url_rainforest',
      amazonDomain,
      ...(err.diagnostics || {}),
    };
    throw err;
  }

  console.log('[productScout] compare-url product', {
    asin: product.asin,
    title: String(product.title || '').slice(0, 80),
    price: product.price_display || product.price,
    rating: product.rating,
  });

  const { standard: modelId } = await getModelsForUser(userId);
  const baseArgs = {
    query: scout.query,
    budget: resolveBudgetContext(scout),
    urlProduct: product,
    budgetPicks,
  };

  const attempts = [
    { compact: false, maxTokens: 4096 },
    { compact: true, maxTokens: 2048 },
  ];

  let analysis = null;
  let lastErr = null;
  let lastDiagnostics = null;

  for (let i = 0; i < attempts.length; i += 1) {
    const { compact, maxTokens } = attempts[i];
    try {
      const prompt = buildCompareUrlPrompt(baseArgs, { compact });
      console.log('[productScout] compare-url LLM call', {
        modelId,
        compact,
        maxTokens,
        promptLen: prompt.length,
        attempt: i + 1,
      });

      const result = await callModel(modelId, prompt, {
        system: COMPARE_URL_SYSTEM,
        maxTokens,
        returnUsage: true,
      });

      lastDiagnostics = result.diagnostics || {
        modelId,
        textLen: String(result.text || '').length,
        empty: !String(result.text || '').trim(),
      };

      console.log('[productScout] compare-url LLM result', {
        modelId: result.model || modelId,
        textLen: String(result.text || '').length,
        diagnostics: lastDiagnostics,
      });

      logUsage({
        userId,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        feature: 'product_scout',
      });

      analysis = parseCompareUrlResponse(result.text);
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`[productScout] compare-url attempt ${i + 1} failed:`, err.message, {
        preview: err.preview || null,
        diagnostics: lastDiagnostics,
      });
    }
  }

  if (!analysis) {
    console.warn('[productScout] compare-url falling back to listing stats', {
      message: lastErr?.message,
      diagnostics: lastDiagnostics,
    });
    analysis = fallbackCompareAnalysis(product, budgetPicks, resolveBudgetContext(scout));
    analysis.diagnostics = {
      compareFallback: 'listing_stats',
      lastError: lastErr?.message || null,
      modelId,
      ...(lastDiagnostics || {}),
    };
  }

  analysis.prefer_url_over_picks = derivePreferUrlOverPicks(analysis, product, budgetPicks);
  const urlPrice = parseMoney(product.price ?? product.price_display);
  analysis.suggested_tier_key = suggestTierKeyForPrice(urlPrice, scout.tiers);

  const comparisonEntry = {
    url: sourceUrl || trimmedUrl,
    asin: product.asin,
    product,
    analysis,
    comparedAt: new Date().toISOString(),
  };

  let final_recommendation = null;

  if (runId) {
    const next = await appendUrlComparison(userId, Number(runId), comparisonEntry, scout);

    if (next?.mode === 'guide') {
      try {
        const { generateFinalRecommendation, saveGuideResult } = require('./productScoutGuideService');
        next.final_recommendation = await generateFinalRecommendation(userId, {
          query: next.query,
          featureBrief: next.feature_brief,
          budgetHint: next.budgetHint,
          tiers: next.tiers,
          urlComparisons: next.url_comparisons || [],
        });
        await saveGuideResult(userId, Number(runId), next, next);
        final_recommendation = next.final_recommendation;
      } catch (err) {
        console.warn('[productScout] compare-url recommendation refresh failed:', err.message);
      }
    }
  }

  return {
    ...comparisonEntry,
    final_recommendation,
    prefer_url_over_picks: analysis.prefer_url_over_picks,
    suggested_tier_key: analysis.suggested_tier_key,
  };
}

async function appendUrlComparison(userId, runId, entry, existingResult) {
  const scout = existingResult || (await getRun(userId, runId))?.result;
  if (!scout) return null;

  const next = {
    ...scout,
    url_comparisons: [...(scout.url_comparisons || []), entry],
  };

  await pool.query(
    `UPDATE product_scout_runs SET result = $1 WHERE "userId" = $2 AND id = $3`,
    [JSON.stringify(next), userId, runId]
  );
  return next;
}

module.exports = {
  compareUrlToScout,
  buildCompareUrlPrompt,
  parseCompareUrlResponse,
  fallbackCompareAnalysis,
  derivePreferUrlOverPicks,
};
