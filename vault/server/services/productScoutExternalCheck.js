'use strict';

const { fetchProduct } = require('./rainforestClient');
const { webSearch } = require('./webSearchService');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { getRun } = require('./productScoutService');
const { saveGuideResult } = require('./productScoutGuideService');

const EXTERNAL_CHECK_SYSTEM = `You are an unbiased shopping analyst. Compare a recommended Amazon product against non-Amazon web search results.
Only cite prices or savings when explicitly mentioned in the search snippets — never invent prices.
Be honest when data is insufficient. No brand bias.
Return ONLY valid JSON. No markdown fences.`;

const AMAZON_HOST_RE = /amazon\.(com|co\.uk|de|ca|jp|in|fr|it|es|com\.au|com\.mx|com\.br)/i;

function resolveAmazonPick(guideResult) {
  const rec = guideResult?.final_recommendation;
  if (rec?.pick?.title) return rec.pick;

  for (const tier of guideResult?.tiers || []) {
    const top = tier.scout?.comparison?.top3?.[0];
    if (top) {
      return {
        ...top,
        tier_label: tier.label,
        tier_key: tier.key,
      };
    }
  }
  return null;
}

function extractModelTokens(title) {
  const matches = String(title || '').match(/\b[A-Z]{1,5}[-\s]?[A-Z0-9]{2,}(?:[-\s][A-Z0-9]+)*\b/g) || [];
  return [...new Set(matches.map((m) => m.replace(/\s+/g, '-')))]
    .filter((m) => m.length >= 4)
    .slice(0, 3);
}

function marketSearchSuffix(countryLabel) {
  const c = String(countryLabel || '').toLowerCase();
  if (c.includes('australia')) return 'Australia';
  if (c.includes('united states') || c === 'us') return 'USA';
  if (c.includes('united kingdom') || c === 'uk') return 'UK';
  if (c.includes('canada')) return 'Canada';
  return countryLabel || '';
}

function buildSearchQueries(pick, product, query, countryLabel) {
  const brand = product?.brand || '';
  const models = extractModelTokens(product?.title || pick.title);
  const specTerms = (product?.feature_bullets || pick.key_features || []).slice(0, 2).join(' ');
  const suffix = marketSearchSuffix(countryLabel);
  const exclude = '-site:amazon.com -site:amazon.com.au -site:amazon.co.uk';

  const queries = [];
  if (brand && models.length) {
    queries.push(`${brand} ${models[0]} buy price ${suffix} ${exclude}`.trim());
  }
  if (models.length) {
    queries.push(`${models[0]} ${suffix} price ${exclude}`.trim());
  }
  const shortTitle = String(pick.title || '').split(/\s+/).slice(0, 6).join(' ');
  queries.push(`${shortTitle} buy ${suffix} ${specTerms} ${exclude}`.trim());
  queries.push(`${query} ${brand} alternative retailer price ${suffix} ${exclude}`.trim());

  return [...new Set(queries.map((q) => q.replace(/\s+/g, ' ').trim()))].slice(0, 3);
}

function filterSearchResults(results) {
  return (results || []).filter((r) => r?.url && !AMAZON_HOST_RE.test(r.url));
}

async function gatherSearchResults(queries) {
  const seen = new Set();
  const merged = [];

  for (const q of queries) {
    try {
      const rows = await webSearch(q, { num: 6 });
      for (const row of filterSearchResults(rows)) {
        if (seen.has(row.url)) continue;
        seen.add(row.url);
        merged.push({ ...row, search_query: q });
        if (merged.length >= 12) return merged;
      }
    } catch (err) {
      console.warn('[productScout] external search failed:', q, err.message);
    }
  }

  return merged;
}

function compactAmazonProduct(product, pick) {
  return {
    title: product?.title || pick.title,
    brand: product?.brand || null,
    asin: product?.asin || pick.asin,
    price: product?.price_display || product?.price || pick.price,
    rating: product?.rating ?? pick.rating,
    review_count: product?.review_count ?? pick.review_count,
    feature_bullets: (product?.feature_bullets || pick.key_features || []).slice(0, 6),
    specifications: (product?.specifications || []).slice(0, 10),
  };
}

function buildExternalCheckPrompt({ query, amazon, searchResults, countryLabel }) {
  const resultsBlock = searchResults.length
    ? searchResults.map((r, i) => (
      `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet || '—'}`
    )).join('\n\n')
    : 'No non-Amazon search results returned.';

  return `Shopping goal: ${query}
Marketplace context: ${countryLabel || 'Amazon'}

AMAZON RECOMMENDED PICK (benchmark):
${JSON.stringify(amazon)}

NON-AMAZON WEB SEARCH RESULTS (snippets only — prices may be missing or stale):
${resultsBlock}

Task:
1. Identify 0–5 plausible non-Amazon purchase options ONLY when the snippet suggests a specific product or retailer listing.
2. For each alternative: title, url, retailer_guess, price_mentioned (exact snippet text or null), confidence (low|medium|high), note (max 25 words).
3. verdict: stick_with_amazon | possibly_cheaper | insufficient_data
4. summary: 2–3 sentences plain text — honest about uncertainty
5. verify_before_switching: 2–4 things shopper should check (warranty, model variant, grey import, etc.)

Rules:
- confidence high only when snippet shows same model/SKU and a price
- Do not recommend switching without at least medium confidence on model match
- If snippets are mostly reviews/articles with no prices, use insufficient_data

JSON only:
{"verdict":"stick_with_amazon","summary":"...","alternatives":[{"title":"...","url":"...","retailer_guess":"JB Hi-Fi","price_mentioned":"$249","confidence":"medium","note":"..."}],"verify_before_switching":["..."]}`;
}

function parseExternalCheckResponse(text, searchResults) {
  const parsed = parseModelJson(String(text || '').trim());
  if (!parsed?.verdict) throw new Error('External check missing verdict');

  const validVerdicts = new Set(['stick_with_amazon', 'possibly_cheaper', 'insufficient_data']);
  const verdict = validVerdicts.has(parsed.verdict) ? parsed.verdict : 'insufficient_data';

  const urlSet = new Set(searchResults.map((r) => r.url));
  const alternatives = (parsed.alternatives || [])
    .filter((a) => a?.url && urlSet.has(a.url))
    .map((a) => ({
      title: String(a.title || '').trim(),
      url: a.url,
      retailer_guess: a.retailer_guess || null,
      price_mentioned: a.price_mentioned || null,
      confidence: ['low', 'medium', 'high'].includes(a.confidence) ? a.confidence : 'low',
      note: a.note || null,
    }))
    .slice(0, 5);

  return {
    verdict,
    summary: String(parsed.summary || '').trim(),
    alternatives,
    verify_before_switching: (parsed.verify_before_switching || []).map(String).filter(Boolean).slice(0, 5),
    generated_at: new Date().toISOString(),
  };
}

async function callExternalCheckModel(userId, modelId, prompt) {
  const result = await callModel(modelId, prompt, {
    system: EXTERNAL_CHECK_SYSTEM,
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
  return result.text;
}

/**
 * Optional final step: search non-Amazon retailers for the recommended pick.
 */
async function runExternalPriceCheck(userId, runId) {
  const run = await getRun(userId, Number(runId));
  if (!run?.result || run.result.mode !== 'guide') {
    throw new Error('Guide run not found');
  }

  const existing = run.result;
  const pick = resolveAmazonPick(existing);
  if (!pick?.title) {
    throw new Error('Scout tiers and generate a recommendation before checking non-Amazon options');
  }

  const amazonDomain = existing.amazonDomain || 'amazon.com.au';
  let product = null;
  if (pick.asin || pick.link) {
    try {
      const fetched = await fetchProduct(pick.link || pick.asin, amazonDomain);
      product = fetched.product;
    } catch (err) {
      console.warn('[productScout] external check product fetch failed:', err.message);
    }
  }

  const amazon = compactAmazonProduct(product, pick);
  const queries = buildSearchQueries(pick, product, existing.query, existing.amazonCountry);
  const searchResults = await gatherSearchResults(queries);

  if (!searchResults.length) {
    throw new Error('No non-Amazon search results — check SEARCH_API_KEY in Settings');
  }

  const { light: modelId } = await getModelsForUser(userId);
  const text = await callExternalCheckModel(
    userId,
    modelId,
    buildExternalCheckPrompt({
      query: existing.query,
      amazon,
      searchResults,
      countryLabel: existing.amazonCountry,
    })
  );

  const analysis = parseExternalCheckResponse(text, searchResults);

  const result = {
    ...existing,
    external_price_check: {
      amazon_pick: amazon,
      search_queries: queries,
      search_result_count: searchResults.length,
      ...analysis,
    },
  };

  return saveGuideResult(userId, Number(runId), existing, result);
}

module.exports = { runExternalPriceCheck, resolveAmazonPick };
