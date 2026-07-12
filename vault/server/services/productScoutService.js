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

const COMPARE_SYSTEM = `You are an unbiased product analyst. Score products on VALUE: features and quality relative to price and reviews — not brand loyalty or Amazon placement.
Identify which product features matter most for the user's specific query before ranking.
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
  }));
}

function buildComparePrompt(query, candidates, { compact = false } = {}) {
  const payload = { user_query: query, candidates: compactCandidates(candidates) };
  const summaryLimit = compact
    ? 'selection_summary: max 80 words total (one short paragraph). value_rationale: max 20 words each.'
    : 'selection_summary: max 150 words total. value_rationale: max 30 words each.';

  return `The user is shopping for: ${query}

Amazon search results (plain search, not sponsored):
${JSON.stringify(payload)}

Score each candidate 0–100 on VALUE (features/specs vs price, adjusted for review quality). Pick the top 3.

Also provide:
1. priority_features — 4–5 specs that matter most for THIS query (not marketing fluff), with why_it_matters and importance ("high" or "medium").
2. selection_summary — why you chose these three as a set: tradeoffs, differences, who each suits.

${summaryLimit}

Return JSON only:
{"summary":"...","priority_features":[{"feature":"...","why_it_matters":"...","importance":"high"}],"selection_summary":"...","top3":[{"rank":1,"candidate_id":1,"asin":"...","title":"...","price":"...","rating":4.5,"review_count":1234,"key_features":["..."],"value_score":87,"value_rationale":"..."}]}`;
}

function parseComparisonResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('LLM returned an empty response — try again or use a different model in Settings');

  const parsed = parseModelJson(raw);
  if (!parsed || typeof parsed !== 'object') {
    const preview = raw.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`LLM did not return valid JSON. Preview: ${preview || '(empty)'}`);
  }
  if (!Array.isArray(parsed.top3) || !parsed.top3.length) {
    throw new Error('LLM comparison missing top3 array');
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

async function scoreAndRank(userId, query, candidates, modelId) {
  const attempts = [
    { prompt: buildComparePrompt(query, candidates), maxTokens: 8192, compact: false },
    { prompt: buildComparePrompt(query, candidates, { compact: true }), maxTokens: 8192, compact: true },
  ];

  let lastErr;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      const { prompt, maxTokens } = attempts[i];
      const result = await callCompareModel(userId, modelId, prompt, maxTokens);
      const parsed = parseComparisonResponse(result.text);
      return enrichTop3(parsed, candidates);
    } catch (err) {
      lastErr = err;
      console.warn(`[productScout] compare attempt ${i + 1} failed:`, err.message);
      if (i === attempts.length - 1) break;
    }
  }

  throw lastErr || new Error('Product comparison failed');
}

function enrichTop3(parsed, candidates) {
  const byAsin = Object.fromEntries(candidates.filter((c) => c.asin).map((c) => [c.asin, c]));
  const byId = Object.fromEntries(candidates.map((c, i) => [i + 1, c]));

  for (const item of parsed.top3) {
    const src = byAsin[item.asin] || byId[item.candidate_id];
    if (src) {
      item.link = item.link || src.link;
      item.feature_bullets = item.feature_bullets || src.feature_bullets;
    }
  }

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
 * Full product-scout pipeline.
 * @param {number} userId
 * @param {string} query
 */
async function runProductScout(userId, query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Query is required');

  const { standard: modelId } = await getModelsForUser(userId);
  const candidates = await searchProducts(q, { maxResults: 10 });
  const comparison = await scoreAndRank(userId, q, candidates, modelId);
  const top3 = comparison.top3 || [];
  const winner = top3[0] || null;
  const external_alternatives = winner ? await crossMarketAlternatives(winner, q) : [];

  const result = {
    query: q,
    candidates_fetched: candidates.length,
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

module.exports = { runProductScout, listRuns, getRun };
