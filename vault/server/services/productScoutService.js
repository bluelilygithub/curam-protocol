'use strict';

const { pool } = require('../db');
const { searchProducts } = require('./rainforestClient');
const { webSearch } = require('./webSearchService');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { captureIf, makeFingerprint } = require('./SuggestionService');
const { formatMarkdown } = require('./productScoutFormat');
const { parseModelJson } = require('../utils/parseModelJson');
const { getAmazonDomain, applyBudgetFilter, marketplaceLabel } = require('./productScoutSettings');
const { attachPreScores, blendValueScore } = require('./productScoutScoring');
const { sanitizeFeatureTable, cleanDeliveryDisplay } = require('./productScoutTableSanitize');

const COMPARE_SYSTEM = `You are an unbiased product analyst. Score products on VALUE: features and quality relative to price and reviews — not brand loyalty or Amazon placement.
Each candidate includes a pre_score (0–100) computed from price, star rating, and review count. Use it as your baseline.
Your value_score for each pick should stay within ±12 of that product's pre_score unless listing bullets clearly justify a larger move — explain why in value_rationale.
Do not reorder products dramatically without feature evidence in the bullets provided.
When a budget is set, top3 must come only from in-budget candidates. Return "stretch_suggestions": [].
Return ONLY a single valid JSON object. No markdown fences. No prose before or after the JSON.`;

function compactCandidates(candidates) {
  return candidates.map((c, i) => ({
    id: i + 1,
    asin: c.asin,
    title: String(c.title || '').slice(0, 100),
    price: c.price_display || c.price,
    rating: c.rating,
    review_count: c.review_count,
    pre_score: c.pre_score,
    feature_bullets: (c.feature_bullets || []).slice(0, 3),
    ...(c.over_budget_pct != null ? { over_budget_pct: c.over_budget_pct } : {}),
  }));
}

function buildComparePrompt(query, primary, stretch, budget, { compact = false, tierLabel, tierFeatures, shopperPriorities } = {}) {
  const summaryLimit = compact
    ? 'selection_summary: max 80 words total (one short paragraph). value_rationale: max 20 words each.'
    : 'selection_summary: max 150 words total. value_rationale: max 30 words each.';

  const budgetBlock = budget
    ? `Budget: max price $${budget.maxPrice}.\n`
    : '';

  const tierBlock = tierLabel
    ? `Price tier: ${tierLabel}. Weight value for: ${(tierFeatures || []).slice(0, 5).join(', ') || 'this tier'}.\n`
    : '';

  const shopperBlock = (shopperPriorities || []).length
    ? `Shopper must-haves (weight heavily in value_score): ${shopperPriorities.join('; ')}\n`
    : '';

  const stretchBlock = stretch.length
    ? `\nOVER-BUDGET candidates (legacy — pick up to 2 only if value clearly justifies the extra cost):
${JSON.stringify({ stretch_candidates: compactCandidates(stretch) })}

For stretch_suggestions use candidate_id from the stretch list. Include stretch_rationale explaining why the extra spend is worth it.\n`
    : '\nReturn "stretch_suggestions": [].\n';

  const top3Rule = primary.length
    ? 'Pick the top 3 by value from IN-BUDGET candidates only.'
    : 'No in-budget candidates — return "top3": [].';

  return `The user is shopping for: ${query}
${tierBlock}${shopperBlock}${budgetBlock}
IN-BUDGET candidates:
${JSON.stringify({ candidates: compactCandidates(primary) })}
${stretchBlock}
${top3Rule}

Also provide:
1. priority_features — 4–5 specs that matter most for THIS query (not marketing fluff), with why_it_matters and importance ("high" or "medium").
2. selection_summary — why you chose these picks: tradeoffs, differences, who each suits. Mention budget if set.
3. feature_table — 6–10 spec rows for product-specific specs ONLY (battery, ANC type, connectivity, etc.). Do NOT include price, delivery, rating, review count, or value score — those are shown separately. Column order: top3 rank 1, 2, 3, then stretch if any. Values must align with the product in that column. Use "—" when unknown.

${summaryLimit}

Return JSON only:
{"summary":"...","priority_features":[{"feature":"...","why_it_matters":"...","importance":"high"}],"selection_summary":"...","feature_table":[{"feature":"Battery","values":["50h","30h"]}],"top3":[{"rank":1,"candidate_id":1,"asin":"...","title":"...","price":"...","rating":4.5,"review_count":1234,"key_features":["..."],"value_score":87,"value_rationale":"..."}],"stretch_suggestions":[{"candidate_id":1,"asin":"...","title":"...","price":"...","rating":4.5,"review_count":1234,"key_features":["..."],"value_score":85,"stretch_rationale":"..."}]}`;
}

function parseComparisonResponse(text, { primary, stretch } = {}) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('LLM returned an empty response — try again or use a different model in Settings');

  const parsed = parseModelJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    const preview = raw.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`LLM did not return valid JSON. Preview: ${preview || '(empty)'}`);
  }

  if (!Array.isArray(parsed.top3)) parsed.top3 = [];
  if (!Array.isArray(parsed.stretch_suggestions)) parsed.stretch_suggestions = [];

  const hasPrimary = primary?.length > 0;
  const hasStretch = stretch?.length > 0;

  if (hasPrimary && !parsed.top3.length) {
    throw new Error('LLM comparison missing top3 array');
  }
  if (!hasPrimary && !hasStretch && !parsed.top3.length && !parsed.stretch_suggestions.length) {
    throw new Error('LLM returned no product recommendations');
  }

  return parsed;
}

async function callCompareModel(userId, modelId, prompt, maxTokens) {
  const result = await callModel(modelId, prompt, {
    system: COMPARE_SYSTEM,
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

  return result;
}

async function scoreAndRank(userId, query, primary, stretch, budget, modelId, tierOpts = {}) {
  const attempts = [
    { prompt: buildComparePrompt(query, primary, stretch, budget, { ...tierOpts, compact: false }), compact: false },
    { prompt: buildComparePrompt(query, primary, stretch, budget, { ...tierOpts, compact: true }), compact: true },
  ];

  let lastErr;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const { prompt } = attempts[i];
      const result = await callCompareModel(userId, modelId, prompt, 8192);
      const parsed = parseComparisonResponse(result.text, { primary, stretch });
      return enrichComparison(parsed, primary, stretch);
    } catch (err) {
      lastErr = err;
      console.warn(`[productScout] compare attempt ${i + 1} failed:`, err.message);
      if (i === attempts.length - 1) break;
    }
  }

  throw lastErr || new Error('Product comparison failed');
}

function enrichComparison(parsed, primary, stretch) {
  const primaryScored = attachPreScores(primary);
  const stretchScored = attachPreScores(stretch);
  const preByAsin = Object.fromEntries(
    [...primaryScored, ...stretchScored].filter((c) => c.asin).map((c) => [c.asin, c.pre_score])
  );
  const preById = Object.fromEntries(
    primaryScored.map((c, i) => [i + 1, c.pre_score])
  );
  const stretchPreById = Object.fromEntries(
    stretchScored.map((c, i) => [i + 1, c.pre_score])
  );

  const enrichList = (items, pool, preMap) => {
    const byAsin = Object.fromEntries(pool.filter((c) => c.asin).map((c) => [c.asin, c]));
    const byId = Object.fromEntries(pool.map((c, i) => [i + 1, c]));

    for (const item of items) {
      const src = byAsin[item.asin] || byId[item.candidate_id];
      if (src) {
        item.link = item.link || src.link;
        item.feature_bullets = item.feature_bullets || src.feature_bullets;
        item.rating = src.rating ?? item.rating;
        item.review_count = src.review_count ?? item.review_count;
        item.price = src.price_display || src.price || item.price;
        item.pre_score = src.pre_score ?? preMap[item.asin] ?? preMap[item.candidate_id];
        item.delivery_display = cleanDeliveryDisplay(
          item.delivery_display || src.delivery_display,
          src.price ?? item.price
        );
        if (src.over_budget_amount != null) item.over_budget_amount = src.over_budget_amount;
        if (src.over_budget_pct != null) item.over_budget_pct = src.over_budget_pct;
      }

      const llmScore = item.llm_value_score ?? item.value_score;
      item.llm_value_score = llmScore;
      item.value_score = blendValueScore(item.pre_score, llmScore);
    }
  };

  enrichList(parsed.top3 || [], primaryScored, { ...preByAsin, ...preById });
  enrichList(parsed.stretch_suggestions || [], stretchScored, { ...preByAsin, ...stretchPreById });

  if (Array.isArray(parsed.top3) && parsed.top3.length > 1) {
    parsed.top3.sort((a, b) => (b.value_score ?? 0) - (a.value_score ?? 0));
    parsed.top3.forEach((item, i) => { item.rank = i + 1; });
  }

  const tableProducts = [
    ...(parsed.top3 || []),
    ...(parsed.stretch_suggestions?.length ? [parsed.stretch_suggestions[0]] : []),
  ].slice(0, 4);
  parsed.feature_table = sanitizeFeatureTable(parsed.feature_table, tableProducts);

  return parsed;
}

async function crossMarketAlternatives(winner, originalQuery) {
  const title = winner.title || 'product';
  const features = winner.key_features || winner.feature_bullets || [];
  const featText = features.slice(0, 4).join(', ') || originalQuery;
  const q = `best alternatives to ${title} ${featText} -site:amazon.com -site:amazon.com.au review`;
  try {
    return await webSearch(q, { num: 8 });
  } catch {
    try {
      return await webSearch(`${originalQuery} best alternatives not amazon`, { num: 6 });
    } catch {
      return [];
    }
  }
}

/**
 * Run comparison on a candidate pool (search optional). Used by scout + buy-guide tiers.
 */
async function executeScoutComparison(userId, query, {
  maxPrice,
  freeDelivery = false,
  within2Days = false,
  amazonDomain,
  modelId,
  candidates: poolIn,
  tierLabel,
  tierFeatures,
  shopperPriorities,
  includeExternals = true,
} = {}) {
  const q = String(query || '').trim();
  const domain = amazonDomain || await getAmazonDomain(pool);
  const model = modelId || (await getModelsForUser(userId)).standard;

  let allCandidates = poolIn;
  if (!allCandidates?.length) {
    allCandidates = await searchProducts(q, {
      maxResults: 10,
      amazonDomain: domain,
      freeDelivery,
      within2Days,
    });
  }

  const max = Number(maxPrice);
  const hasBudget = Number.isFinite(max) && max > 0;

  const { primary, stretch, budget } = applyBudgetFilter(
    allCandidates,
    hasBudget ? max : null
  );

  const primaryScored = attachPreScores(primary);
  const stretchScored = attachPreScores(stretch);

  if (!primaryScored.length && !stretchScored.length) {
    return {
      error: hasBudget
        ? `No products in this price band (max $${max}).`
        : 'No products matched this tier.',
      candidates_fetched: allCandidates.length,
      comparison: { top3: [], stretch_suggestions: [] },
      budget,
      external_alternatives: [],
    };
  }

  const comparison = await scoreAndRank(
    userId,
    q,
    primaryScored,
    stretchScored,
    budget,
    model,
    { tierLabel, tierFeatures, shopperPriorities }
  );
  const top3 = comparison.top3 || [];
  const stretchSuggestions = comparison.stretch_suggestions || [];
  const winner = top3[0] || stretchSuggestions[0] || null;
  const external_alternatives = includeExternals && winner
    ? await crossMarketAlternatives(winner, q)
    : [];

  return {
    candidates_fetched: allCandidates.length,
    amazonDomain: domain,
    filters: { freeDelivery, within2Days },
    budget,
    comparison,
    external_alternatives,
  };
}

/**
 * @param {number} userId
 * @param {string} query
 * @param {{ maxPrice?: number|null }} [opts]
 */
async function runProductScout(userId, query, { maxPrice, freeDelivery = false, within2Days = false } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');

  const amazonDomain = await getAmazonDomain(pool);
  const max = Number(maxPrice);
  const hasBudget = Number.isFinite(max) && max > 0;

  const scout = await executeScoutComparison(userId, q, {
    maxPrice: hasBudget ? max : null,
    freeDelivery,
    within2Days,
    amazonDomain,
    includeExternals: true,
  });

  if (scout.error) {
    throw new Error(
      hasBudget
        ? `No products found within your max price ($${max}). Try raising your budget.`
        : scout.error
    );
  }

  const result = {
    mode: 'scout',
    query: q,
    candidates_fetched: scout.candidates_fetched,
    amazonDomain,
    amazonCountry: marketplaceLabel(amazonDomain),
    filters: scout.filters,
    budget: scout.budget,
    comparison: scout.comparison,
    external_alternatives: scout.external_alternatives,
    markdown: null,
  };
  result.markdown = formatMarkdown(result);

  const { rows } = await pool.query(
    `INSERT INTO product_scout_runs ("userId", query, result, "createdAt")
     VALUES ($1, $2, $3, NOW()) RETURNING id, "createdAt"`,
    [userId, q, JSON.stringify(result)]
  );
  result.runId = rows[0]?.id;
  result.createdAt = rows[0]?.createdAt;

  await captureIf(!scout.external_alternatives.length, {
    userId,
    source: 'productScout',
    category: 'source',
    fingerprint: makeFingerprint('productScout', `no-external:${q.slice(0, 40)}`),
    title: 'Amazon Search: no external alternatives found',
    body: 'Cross-market search returned nothing. Check SEARCH_API_KEY or try a broader query.',
    context: `query: ${q}`,
  });

  return result;
}

async function listRuns(userId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, query, "createdAt",
            COALESCE(result->>'mode', 'scout') AS mode,
            CASE
              WHEN jsonb_typeof(result->'scouted_tiers') = 'array'
                   AND jsonb_array_length(result->'scouted_tiers') > 0
              THEN result->'scouted_tiers'
              ELSE COALESCE((
                SELECT jsonb_agg(elem->>'key')
                FROM jsonb_array_elements(COALESCE(result->'tiers', '[]'::jsonb)) AS elem
                WHERE jsonb_array_length(COALESCE(elem->'scout'->'comparison'->'top3', '[]'::jsonb)) > 0
              ), '[]'::jsonb)
            END AS "scoutedTiers"
     FROM product_scout_runs WHERE "userId"=$1
     ORDER BY "createdAt" DESC LIMIT $2`,
    [userId, limit]
  );
  return rows.map((row) => ({
    ...row,
    scoutedTiers: Array.isArray(row.scoutedTiers)
      ? row.scoutedTiers
      : (row.scoutedTiers ? JSON.parse(row.scoutedTiers) : []),
  }));
}

async function getRun(userId, id) {
  const { rows } = await pool.query(
    `SELECT id, query, result, "createdAt"
     FROM product_scout_runs WHERE "userId"=$1 AND id=$2`,
    [userId, id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const result = typeof row.result === 'object' ? row.result : JSON.parse(row.result);
  return { ...row, result };
}

async function deleteRuns(userId, ids) {
  const clean = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!clean.length) return { deleted: 0 };
  const { rowCount } = await pool.query(
    `DELETE FROM product_scout_runs WHERE "userId"=$1 AND id = ANY($2::int[])`,
    [userId, clean]
  );
  return { deleted: rowCount };
}

module.exports = {
  runProductScout,
  executeScoutComparison,
  listRuns,
  getRun,
  deleteRuns,
};
