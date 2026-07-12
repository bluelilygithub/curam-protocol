'use strict';

const { pool } = require('../db');
const { searchProducts } = require('./rainforestClient');
const { webSearch } = require('./webSearchService');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { captureIf, makeFingerprint } = require('./SuggestionService');

const COMPARE_SYSTEM = `You are an unbiased product analyst. Score products on VALUE: features and quality relative to price and reviews — not brand loyalty or Amazon placement.
Return ONLY valid JSON matching the schema requested. No markdown fences. No prose outside JSON.`;

function parseJsonFromModel(text) {
  let cleaned = String(text || '').trim();
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    lines.shift();
    if (lines.length && lines[lines.length - 1].trim() === '```') lines.pop();
    cleaned = lines.join('\n').trim();
  }
  return JSON.parse(cleaned);
}

async function scoreAndRank(userId, query, candidates, modelId) {
  const payload = {
    user_query: query,
    candidates: candidates.map((c, i) => ({
      id: i + 1,
      asin: c.asin,
      title: c.title,
      price: c.price_display || c.price,
      rating: c.rating,
      review_count: c.review_count,
      feature_bullets: c.feature_bullets || [],
    })),
  };

  const prompt = `The user is shopping for: ${query}

Here are Amazon search results (plain search, not sponsored):
${JSON.stringify(payload, null, 2)}

Analyze all candidates. Score each 0–100 on VALUE (features/specs vs price, adjusted for review quality).
Pick the top 3 by value score.

Return JSON exactly in this shape:
{
  "summary": "One sentence overall recommendation framing",
  "top3": [
    {
      "rank": 1,
      "candidate_id": 1,
      "asin": "...",
      "title": "...",
      "price": "...",
      "rating": 4.5,
      "review_count": 1234,
      "key_features": ["bullet1", "bullet2"],
      "value_score": 87,
      "value_rationale": "Short why this score"
    }
  ],
  "all_scores": [{ "candidate_id": 1, "value_score": 87, "title": "..." }]
}`;

  const result = await callModel(modelId, prompt, {
    system: COMPARE_SYSTEM,
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

  let parsed;
  try {
    parsed = parseJsonFromModel(result.text);
  } catch (err) {
    throw new Error(`LLM did not return valid JSON: ${err.message}`);
  }
  if (!parsed?.top3?.length) throw new Error('LLM comparison missing top3 array');

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

function formatMarkdown(result) {
  const lines = [`# Product Scout — ${result.query}\n`];
  const comp = result.comparison || {};
  if (comp.summary) lines.push(`${comp.summary}\n`);
  lines.push('## Top 3 on Amazon\n');
  lines.push('| Rank | Product | Price | Rating | Reviews | Value | Key features |');
  lines.push('|------|---------|-------|--------|---------|-------|--------------|');
  for (const item of comp.top3 || []) {
    const rating = item.rating != null ? `${item.rating}★` : '—';
    const features = (item.key_features || []).slice(0, 3).join('; ') || '—';
    const title = String(item.title || '').slice(0, 60);
    lines.push(
      `| ${item.rank ?? '—'} | ${title} | ${item.price ?? '—'} | ${rating} | ${item.review_count ?? '—'} | **${item.value_score ?? '—'}** | ${features} |`
    );
  }
  for (const item of comp.top3 || []) {
    if (item.value_rationale) lines.push(`\n**#${item.rank} rationale:** ${item.value_rationale}`);
    if (item.link) lines.push(`- [Amazon link](${item.link})`);
  }
  const ext = result.external_alternatives || [];
  if (ext.length) {
    lines.push('\n## External alternatives (non-Amazon)\n');
    for (const alt of ext.slice(0, 6)) {
      lines.push(`- [${alt.title}](${alt.url}) — ${(alt.snippet || '').slice(0, 120)}`);
    }
  }
  return `${lines.join('\n')}\n`;
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

module.exports = { runProductScout, listRuns, getRun, formatMarkdown };
