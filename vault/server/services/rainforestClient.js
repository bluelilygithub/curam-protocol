'use strict';

const RAINFOREST_URL = 'https://api.rainforestapi.com/request';

function apiKey() {
  const k = process.env.RAINFOREST_API_KEY;
  if (!k?.trim()) {
    throw new Error('RAINFOREST_API_KEY is not set. Add it in Railway → Variables (see product-scout/.env.example).');
  }
  return k.trim();
}

function amazonDomain() {
  return (process.env.AMAZON_DOMAIN || 'amazon.com.au').trim() || 'amazon.com.au';
}

/**
 * @param {string} query
 * @param {{ maxResults?: number }} [opts]
 */
async function searchProducts(query, { maxResults = 10 } = {}) {
  const params = new URLSearchParams({
    api_key: apiKey(),
    type: 'search',
    amazon_domain: amazonDomain(),
    search_term: query.trim(),
    number_of_results: String(maxResults),
    exclude_sponsored: 'true',
  });

  const res = await fetch(`${RAINFOREST_URL}?${params}`, { signal: AbortSignal.timeout(45000) });
  if (res.status === 429) throw new Error('Rainforest API rate limit exceeded — try again shortly.');
  if (res.status === 401) throw new Error('Rainforest API key invalid or unauthorised.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Rainforest API error HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data?.request_info?.success === false) {
    throw new Error(data.request_info?.message || 'Rainforest search failed');
  }

  const candidates = [];
  for (const item of data.search_results || []) {
    if (candidates.length >= maxResults) break;
    if (!item?.title?.trim()) continue;
    const priceObj = item.price || {};
    const bullets = item.feature_bullets?.length ? item.feature_bullets : (item.description ? [item.description] : []);
    candidates.push({
      asin: item.asin,
      title: item.title.trim(),
      price: priceObj.value ?? null,
      price_display: priceObj.raw || (priceObj.value != null ? `$${priceObj.value}` : null),
      currency: priceObj.currency || 'USD',
      rating: item.rating ?? null,
      review_count: item.ratings_total ?? item.reviews_total ?? null,
      feature_bullets: bullets.slice(0, 6),
      link: item.link,
      is_prime: Boolean(item.is_prime),
      position: item.position,
    });
  }

  if (!candidates.length) throw new Error(`No Amazon search results for: ${query}`);
  return candidates;
}

module.exports = { searchProducts };
