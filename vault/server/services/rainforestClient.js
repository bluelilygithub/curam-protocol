'use strict';

const { parseDeliveryInfo, applyDeliveryFilters } = require('./productScoutDelivery');

const RAINFOREST_URL = 'https://api.rainforestapi.com/request';

function apiKey() {
  const k = process.env.RAINFOREST_API_KEY;
  if (!k?.trim()) {
    throw new Error('RAINFOREST_API_KEY is not set. Add it in Railway → Variables (see product-scout/.env.example).');
  }
  return k.trim();
}

async function searchProducts(query, {
  maxResults = 10,
  amazonDomain = 'amazon.com.au',
  freeDelivery = false,
  within2Days = false,
} = {}) {
  const domain = String(amazonDomain || 'amazon.com.au').trim() || 'amazon.com.au';
  const fetchCount = (freeDelivery || within2Days) ? Math.max(maxResults, 40) : maxResults;

  const params = new URLSearchParams({
    api_key: apiKey(),
    type: 'search',
    amazon_domain: domain,
    search_term: query.trim(),
    number_of_results: String(fetchCount),
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
    if (candidates.length >= fetchCount) break;
    if (!item?.title?.trim()) continue;
    const priceObj = item.price || {};
    const bullets = item.feature_bullets?.length ? item.feature_bullets : (item.description ? [item.description] : []);
    const delivery_info = parseDeliveryInfo(item);
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
      delivery_display: delivery_info.delivery_display,
      delivery_info,
    });
  }

  const filtered = applyDeliveryFilters(candidates, { freeDelivery, within2Days }).slice(0, maxResults);

  if (!filtered.length) {
    const parts = [];
    if (freeDelivery) parts.push('free delivery');
    if (within2Days) parts.push('delivery within 2 days');
    throw new Error(`No Amazon results matched filters: ${parts.join(' + ')}. Try turning off a filter.`);
  }

  return filtered;
}

module.exports = { searchProducts };
