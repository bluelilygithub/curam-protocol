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
const { getPriceVariancePct, getAmazonDomain, applyBudgetFilter, marketplaceLabel } = require('./productScoutSettings');

const COMPARE_SYSTEM = `You are an unbiased product analyst. Score products on VALUE: features and quality relative to price and reviews — not brand loyalty or Amazon placement.
Identify which product features matter most for the user's specific query before ranking.
When a budget is set, top3 must come only from in-budget candidates. Stretch suggestions must come only from the stretch list.
Return ONLY a single valid JSON object. No markdown fences. No prose before or after the JSON.`;

function compactCandidates(candidates) {
  return candidates.map((c, i) => ({
    id: i + 1,
    asin: c.asin,
    title: String(c.title || '').slice(0, 100),
    price: c.price_display || c.price,
    rating: c.rating,
    review_count: c.review_count,
    feature_bullets: (c.feature_bullets || []).slice(0, 3),
    ...(c.over_budget_pct != null ? { over_budget_pct: c.over_budget_pct } : {}),
  }));
}

function buildComparePrompt(query, primary, stretch, budget, { compact = false } = {}) {
  const summaryLimit = compact
    ? 'selection_summary: max 80 words total (one short paragraph). value_rationale: max 20 words each.'
    : 'selection_summary: max 150 words total. value_rationale: max 30 words each.';

  const budgetBlock = budget
    ? `Budget: max price ${budget.maxPrice}. Variance ${budget.variancePct}% allows stretch picks up to ${budget.ceiling} (above budget but within tolerance).\n`
    : '';

  const stretchBlock = stretch.length
    ? `\nSTRETCH candidates (above budget, within variance — pick up to 2 only if value clearly justifies the extra cost):
${JSON.stringify({ stretch_candidates: compactCandidates(stretch) })}

For stretch_suggestions use candidate_id from the stretch list. Include stretch_rationale explaining why the extra spend is worth it.\n`
    : '\nNo stretch candidates. Return "stretch_suggestions": [].\n';

  const top3Rule = primary.length
    ? 'Pick the top 3 by value from IN-BUDGET candidates only.'
    : 'No in-budget candidates — return "top3": [].';

  return `The user is shopping for: ${query}
${budgetBlock}
IN-BUDGET candidates:
${JSON.stringify({ candidates: compactCandidates(primary) })}
${stretchBlock}
${top3Rule}

Also provide:
1. priority_features — 4–5 specs that matter most for THIS query (not marketing fluff), with why_it_matters and importance ("high" or "medium").
2. selection_summary — why you chose these picks: tradeoffs, differences, who each suits. Mention budget if set.
3. feature_table — 6–10 spec rows comparing top3 (+ first stretch if returned). Column order: top3 rank 1, 2, 3, then stretch if any. Each row: {"feature":"Battery life","values":["50h","30h","80h"]} — one value per product column.

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

async function scoreAndRank(userId, query, primary, stretch, budget, modelId) {
  const attempts = [
    { prompt: buildComparePrompt(query, primary, stretch, budget), compact: false },
    { prompt: buildComparePrompt(query, primary, stretch, budget, { compact: true }), compact: true },
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
  const enrichList = (items, pool) => {
    const byAsin = Object.fromEntries(pool.filter((c) => c.asin).map((c) => [c.asin, c]));
    const byId = Object.fromEntries(pool.map((c, i) => [i + 1, c]));

    for (const item of items) {
      const src = byAsin[item.asin] || byId[item.candidate_id];
      if (src) {
      item.link = item.link || src.link;
      item.feature_bullets = item.feature_bullets || src.feature_bullets;
      item.delivery_display = item.delivery_display || src.delivery_display;
      if (src.over_budget_amount != null) item.over_budget_amount = src.over_budget_amount;
        if (src.over_budget_pct != null) item.over_budget_pct = src.over_budget_pct;
      }
    }
  };

  enrichList(parsed.top3 || [], primary);
  enrichList(parsed.stretch_suggestions || [], stretch);
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
 * @param {number} userId
 * @param {string} query
 * @param {{ maxPrice?: number|null }} [opts]
 */
async function runProductScout(userId, query, { maxPrice, freeDelivery = false, within2Days = false } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');

  const variancePct = await getPriceVariancePct(pool);
  const amazonDomain = await getAmazonDomain(pool);
  const max = Number(maxPrice);
  const hasBudget = Number.isFinite(max) && max > 0;

  const { standard: modelId } = await getModelsForUser(userId);
  const allCandidates = await searchProducts(q, {
    maxResults: 10,
    amazonDomain,
    freeDelivery,
    within2Days,
  });
  const { primary, stretch, budget } = applyBudgetFilter(
    allCandidates,
    hasBudget ? max : null,
    variancePct
  );

  if (!primary.length && !stretch.length) {
    const ceiling = budget?.ceiling;
    throw new Error(
      ceiling
        ? `No products found within your max price ($${max}) or variance ceiling ($${ceiling}). Try raising your budget.`
        : 'No Amazon search results matched your query.'
    );
  }

  const comparison = await scoreAndRank(userId, q, primary, stretch, budget, modelId);
  const top3 = comparison.top3 || [];
  const stretchSuggestions = comparison.stretch_suggestions || [];
  const winner = top3[0] || stretchSuggestions[0] || null;
  const external_alternatives = winner ? await crossMarketAlternatives(winner, q) : [];

  const result = {
    query: q,
    candidates_fetched: allCandidates.length,
    amazonDomain,
    amazonCountry: marketplaceLabel(amazonDomain),
    filters: { freeDelivery, within2Days },
    budget,
    comparison,
    external_alternatives,
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

  await captureIf(!external_alternatives.length, {
    userId,
    source: 'productScout',
    category: 'source',
    fingerprint: makeFingerprint('productScout', `no-external:${q.slice(0, 40)}`),
    title: 'Product Scout: no external alternatives found',
    body: 'Cross-market search returned nothing. Check SEARCH_API_KEY or try a broader query.',
    context: `query: ${q}`,
  });

  return result;
}

async function listRuns(userId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT id, query, "createdAt"
     FROM product_scout_runs WHERE "userId"=$1
     ORDER BY "createdAt" DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
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

module.exports = { runProductScout, listRuns, getRun, deleteRuns };
