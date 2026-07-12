'use strict';

const { parseDeliveryInfo } = require('./productScoutDelivery');

const RAINFOREST_URL = 'https://api.rainforestapi.com/request';

const AMAZON_HOSTS = new Set([
  'amazon.com.au',
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.ca',
  'amazon.co.jp',
  'amazon.in',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
]);

function apiKey() {
  const k = process.env.RAINFOREST_API_KEY;
  if (!k?.trim()) {
    throw new Error('RAINFOREST_API_KEY is not set. Add it in Railway → Variables (see product-scout/.env.example).');
  }
  return k.trim();
}

/**
 * @param {string} input — Amazon product URL or raw ASIN
 */
function parseAmazonUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Amazon URL or ASIN is required');

  if (/^[A-Z0-9]{10}$/i.test(trimmed)) {
    return { asin: trimmed.toUpperCase(), amazonDomain: null, url: null };
  }

  let url;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error('Invalid Amazon URL');
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (!AMAZON_HOSTS.has(host) && !/^amazon\.[a-z.]+$/.test(host)) {
    throw new Error('Only Amazon product URLs are supported');
  }

  const dpMatch = url.pathname.match(/\/(?:dp|gp\/product|exec\/obidos\/asin)\/([A-Z0-9]{10})/i);
  const asin = (
    dpMatch?.[1]
    || url.searchParams.get('pd_rd_i')
    || url.searchParams.get('asin')
    || ''
  ).toUpperCase();

  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    throw new Error('Could not find a product ASIN in that Amazon URL');
  }

  return { asin, amazonDomain: host, url: url.toString() };
}

function flattenSpecifications(specs) {
  const out = [];
  if (Array.isArray(specs)) {
    for (const row of specs) {
      if (row?.name && row?.value) out.push(`${row.name}: ${row.value}`);
      else if (typeof row === 'string') out.push(row);
    }
  } else if (specs && typeof specs === 'object') {
    for (const [name, value] of Object.entries(specs)) {
      if (value != null && value !== '') out.push(`${name}: ${value}`);
    }
  }
  return out.slice(0, 18);
}

function normalizeProductPayload(data, amazonDomain, fallbackAsin) {
  const p = data?.product || data;
  if (!p?.title?.trim()) {
    throw new Error('Rainforest did not return product details for that URL');
  }

  const priceObj = p.buybox_winner?.price || p.price || p.prices?.[0] || {};
  const bullets = p.feature_bullets?.length
    ? p.feature_bullets
    : (p.description ? [String(p.description).slice(0, 400)] : []);

  const specs = flattenSpecifications(p.specifications);
  const delivery_info = parseDeliveryInfo(p);

  return {
    asin: p.asin || fallbackAsin,
    title: p.title.trim(),
    brand: p.brand || null,
    price: priceObj.value ?? null,
    price_display: priceObj.raw
      || (priceObj.value != null ? `$${priceObj.value}` : 'Price unavailable'),
    currency: priceObj.currency || 'AUD',
    rating: p.rating ?? null,
    review_count: p.ratings_total ?? p.reviews_total ?? null,
    feature_bullets: bullets.slice(0, 8),
    specifications: specs,
    link: p.link || `https://${amazonDomain}/dp/${p.asin || fallbackAsin}`,
    availability: p.buybox_winner?.availability?.raw || p.availability?.raw || null,
    delivery_display: delivery_info.delivery_display,
    is_prime: Boolean(p.buybox_winner?.is_prime ?? p.is_prime),
  };
}

async function rainforestRequest(params) {
  const res = await fetch(`${RAINFOREST_URL}?${params}`, { signal: AbortSignal.timeout(45000) });
  if (res.status === 429) throw new Error('Rainforest API rate limit exceeded — try again shortly.');
  if (res.status === 401) throw new Error('Rainforest API key invalid or unauthorised.');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Rainforest API error HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data?.request_info?.success === false) {
    throw new Error(data.request_info?.message || 'Rainforest product lookup failed');
  }
  return data;
}

/**
 * Fetch a single Amazon product by URL or ASIN.
 * @param {string} input
 * @param {string} [defaultDomain] — workspace default when URL has no host context
 */
async function fetchProduct(input, defaultDomain = 'amazon.com.au') {
  const parsed = parseAmazonUrl(input);
  const amazonDomain = parsed.amazonDomain || defaultDomain;

  const params = new URLSearchParams({
    api_key: apiKey(),
    type: 'product',
    amazon_domain: amazonDomain,
  });

  if (parsed.url) params.set('url', parsed.url);
  else params.set('asin', parsed.asin);

  const data = await rainforestRequest(params);
  const product = normalizeProductPayload(data, amazonDomain, parsed.asin);
  return { product, amazonDomain, sourceUrl: parsed.url || product.link };
}

async function searchProducts(query, {
  maxResults = 10,
  amazonDomain = 'amazon.com.au',
  freeDelivery = false,
  within2Days = false,
} = {}) {
  const { applyDeliveryFilters } = require('./productScoutDelivery');
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

  const data = await rainforestRequest(params);

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

module.exports = { searchProducts, fetchProduct, parseAmazonUrl, normalizeProductPayload };
