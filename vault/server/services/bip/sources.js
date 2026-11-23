'use strict';

// BIP's pluggable enrichment registry. Every source has the same shape: { name, label, group, run(seed, ctx) }, returns
// { status: success|skipped|failed, data }, and owns its timeout, retry, rate limit and missing-key behaviour. Adding a source means
// adding one object here (plus a CATALOG entry in bipTools.mjs and the guide) — no changes to the runner or the page.

const { fetchJson } = require('./http');
const { lookupRegistration } = require('./rdap');
const { lookupDns } = require('./dns');
const { scrapeWebsite } = require('./website');
const { detectTech } = require('./techStack');
const { getProviders } = require('../domainNaming/providers');
const fetchLib = require('../htmlFetch');
const { abnDigits, abnPretty, cleanText, domainLabel } = require('./normalise');

const success = (data, extra = {}) => ({ status: 'success', data, ...extra });
const skipped = (reason, data = null) => ({ status: 'skipped', reason, data });
const failed = (error) => ({ status: 'failed', error: error?.message || String(error), data: null });

function findAbn(seed) {
  const bits = [seed?.abr?.abn, seed?.registration?.organisation, seed?.registration?.registrantName, seed?.domainsTool?.abn, ...(seed?.website?.text || [])];
  for (const bit of bits) {
    const abn = abnDigits(bit);
    if (abn) return abn;
  }
  return null;
}

function businessName(seed) {
  return cleanText(seed?.abr?.entityName || seed?.registration?.organisation || seed?.registration?.registrantName || seed?.domainsTool?.name || domainLabel(seed?.domain), 200) || domainLabel(seed?.domain);
}

/** ABR's JSON API returns JSONP. Search by the ABN found in Stage 1, then by entity name when there is no ABN. */
async function abrLookup(seed, ctx) {
  const guid = process.env.ABR_GUID;
  if (!guid) return skipped('ABR_GUID is not set on this server.');
  const base = 'https://abr.business.gov.au/json';
  const abn = findAbn(seed);
  let json;
  try {
    json = abn
      ? await fetchJson(`${base}/AbnDetails.aspx?abn=${encodeURIComponent(abn)}&guid=${encodeURIComponent(guid)}&callback=cb`, { module: 'abr', minGapMs: 700, deps: ctx.deps })
      : await fetchJson(`${base}/MatchingNames.aspx?name=${encodeURIComponent(businessName(seed))}&guid=${encodeURIComponent(guid)}&callback=cb`, { module: 'abr', minGapMs: 700, deps: ctx.deps });
  } catch (err) {
    return failed(err);
  }
  const row = Array.isArray(json) ? json[0] : (json?.results?.[0] || json);
  if (!row || (!row.Abn && !row.abn)) return skipped('ABR has no matching entity for this name.');
  const tradingNames = (Array.isArray(row.TradingNames) ? row.TradingNames : []).map((t) => cleanText(t.Name, 200)).filter(Boolean);
  return success({
    abn: abnPretty(row.Abn || row.abn),
    entityName: cleanText(row.EntityName || row.entityName, 200),
    entityType: cleanText(row.EntityTypeName || row.EntityTypeCode || row.entityType, 100),
    gstStatus: cleanText(row.Gst || row.gst, 40),
    gstFrom: row.GstEffectiveFrom || null,
    abnStatus: cleanText(row.AbnStatus || row.abnStatus, 40),
    registrationDate: row.AbnStatusEffectiveFrom || row.registrationDate || null,
    tradingNames,
    state: cleanText(row.AddressState || row.state, 40),
    postcode: cleanText(row.AddressPostcode || row.postcode, 12),
    raw: row,
  });
}

/** ASIC does not offer a free public API. Try the public register, then say plainly that the details need a manual lookup. */
async function asicLookup(seed, ctx) {
  const manualUrl = `https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx`;
  try {
    const res = ctx.deps?.fetchPublicFile
      ? await ctx.deps.fetchPublicFile('https://connectonline.asic.gov.au/', { timeoutMs: 8000, maxBytes: 1024 * 1024, accept: 'text/html' })
      : await require('../../utils/safeFetch').fetchPublicFile('https://connectonline.asic.gov.au/', { timeoutMs: 8000, maxBytes: 1024 * 1024, accept: 'text/html' });
    const html = Buffer.isBuffer(res.buffer) ? res.buffer.toString('utf8') : String(res.buffer || '');
    const directors = [...html.matchAll(/(?:Director|Officeholder)\s*:?\s*([A-Z][A-Za-z .'-]{2,50})/g)].map((m) => ({ name: cleanText(m[1], 100), role: 'Director / officeholder' }));
    if (!directors.length) return skipped('ASIC Connect did not expose company details without a login.', { status: 'unavailable', manualUrl, directors: [], note: 'Check ASIC Connect manually; BIP does not guess directors or share structure.' });
    return success({ status: 'available', manualUrl, directors, raw: html.slice(0, 20000) });
  } catch (err) {
    return skipped(`ASIC Connect could not be read (${err.message}).`, { status: 'unavailable', manualUrl, directors: [], note: 'Check ASIC Connect manually; BIP does not guess directors or share structure.' });
  }
}

async function placesLookup(seed, ctx) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return skipped('GOOGLE_PLACES_API_KEY is not set on this server.');
  const query = `${businessName(seed)} ${seed.domain}`;
  try {
    const json = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
      module: 'places', method: 'POST', timeoutMs: 12000, minGapMs: 1200,
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.phoneNumber,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri',
        'Content-Type': 'application/json',
      },
      body: { textQuery: query, maxResultCount: 5 },
      deps: ctx.deps,
    });
    const place = (json.places || [])[0];
    if (!place) return skipped('Google Places has no verified listing for this business.');
    return success({
      name: cleanText(place.displayName?.text, 200),
      address: cleanText(place.formattedAddress, 250),
      phone: cleanText(place.phoneNumber || place.internationalPhoneNumber, 60),
      website: place.websiteUri || null,
      mapsUrl: place.googleMapsUri || null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      query,
      raw: place,
    });
  } catch (err) { return failed(err); }
}

function searchDate(item) {
  const meta = item?.pagemap?.metatags?.[0] || {};
  return meta['article:published_time'] || meta['datePublished'] || meta['date'] || null;
}

async function googleSearch(seed, ctx) {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!key || !cx) return skipped('GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX must both be set.');
  const name = businessName(seed);
  const queries = [`"${name}"`, `"${seed.domain}"`];
  const seen = new Set();
  const results = [];
  try {
    for (const q of queries) {
      const params = new URLSearchParams({ key, cx, q, num: '10' });
      const json = await fetchJson(`https://www.googleapis.com/customsearch/v1?${params}`, { module: 'googleSearch', timeoutMs: 12000, minGapMs: 1200, deps: ctx.deps });
      for (const item of json.items || []) {
        if (!item.link || seen.has(item.link)) continue;
        seen.add(item.link);
        results.push({ title: cleanText(item.title, 250), snippet: cleanText(item.snippet, 500), url: item.link, date: searchDate(item), query: q });
      }
    }
    return success({ results: results.slice(0, 10), queries });
  } catch (err) { return failed(err); }
}

function socialFromSeed(seed) {
  const links = seed?.website?.socialLinks || [];
  if (!links.length) return skipped('No social links were found on the scraped pages.');
  return success({
    profiles: links.map((l) => ({ network: l.network, url: l.url, handle: l.handle || null, source: 'website' })),
    count: links.length,
  });
}

function ratingFromHtml(html) {
  const text = String(html || '');
  const rating = text.match(/"ratingValue"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i) || text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:out of 5|\/5)/i);
  const count = text.match(/"(?:reviewCount|ratingCount|reviewTotal)"\s*:\s*"?([0-9,]+)"?/i) || text.match(/([\d,]+)\s+(?:reviews|ratings)/i);
  return {
    rating: rating ? Number(rating[1]) : null,
    reviewCount: count ? Number(String(count[1]).replace(/,/g, '')) : null,
  };
}

async function reviewScrape(source, seed, ctx) {
  const name = source === 'productReview' ? businessName(seed) : seed.domain;
  const base = source === 'productReview'
    ? `https://www.productreview.com.au/search?q=${encodeURIComponent(name)}`
    : `https://www.trustpilot.com/search?query=${encodeURIComponent(name)}`;
  try {
    const fetchHtml = ctx.deps?.fetchHtml || fetchLib.fetchHtml;
    const res = await fetchHtml(base);
    if (res.statusCode >= 400 || !res.body) return skipped(`${source} returned HTTP ${res.statusCode}.`);
    const parsed = ratingFromHtml(res.body);
    if (parsed.rating === null) return skipped(`No public listing was found on ${source === 'productReview' ? 'ProductReview.com.au' : 'Trustpilot'}.`);
    return success({ ...parsed, listingUrl: res.finalUrl || base, query: name, note: 'Public rating shown on the review site; not verified by BIP.' });
  } catch (err) { return skipped(`${source} could not be read (${err.message}).`); }
}

function techFromSeed(seed) {
  return success(detectTech(seed));
}

function domainsOverview(seed, ctx) {
  try {
    const providers = ctx.deps?.providers || getProviders();
    return success(providers.domscan('/overview', { domain: seed.domain }));
  } catch (err) { return skipped(`The Domain tool could not supply an overview (${err.message}).`); }
}

/** Ordered so Stage 1 runs first. Modules with a live credential fail soft when the key is absent. */
const MODULES = [
  { name: 'registration', label: 'Domain registration (RDAP/WHOIS)', group: 'Stage 1 — seed', run: (seed, ctx) => lookupRegistration(seed.domain, ctx.deps || {}).then((data) => success(data, data.error ? { error: data.error } : {})) },
  { name: 'dns', label: 'DNS records', group: 'Stage 1 — seed', run: (seed, ctx) => lookupDns(seed.domain, ctx.deps || {}).then(success) },
  { name: 'website', label: 'Website pages', group: 'Stage 1 — seed', run: (seed, ctx) => scrapeWebsite(seed.domain, ctx.deps || {}).then(success) },
  { name: 'domainsTool', label: 'Domain tool overview', group: 'Stage 1 — seed', run: domainsOverview },
  { name: 'abr', label: 'ABN Lookup (ABR)', group: 'Stage 2 — enrichment', run: abrLookup },
  { name: 'asic', label: 'ASIC Company Register', group: 'Stage 2 — enrichment', run: asicLookup },
  { name: 'places', label: 'Google Places', group: 'Stage 2 — enrichment', run: placesLookup },
  { name: 'googleSearch', label: 'Google Custom Search', group: 'Stage 2 — enrichment', run: googleSearch },
  { name: 'socialLinks', label: 'Website social links', group: 'Stage 2 — enrichment', run: (seed) => socialFromSeed(seed) },
  { name: 'productReview', label: 'ProductReview.com.au', group: 'Stage 2 — enrichment', run: (seed, ctx) => reviewScrape('productReview', seed, ctx) },
  { name: 'trustpilot', label: 'Trustpilot', group: 'Stage 2 — enrichment', run: (seed, ctx) => reviewScrape('trustpilot', seed, ctx) },
  { name: 'techStack', label: 'Tech stack detection', group: 'Stage 2 — enrichment', run: (seed) => techFromSeed(seed) },
];

const BY_NAME = Object.fromEntries(MODULES.map((m) => [m.name, m]));

async function runModule(name, seed, ctx = {}) {
  const module = BY_NAME[name];
  if (!module) return failed(new Error(`Unknown BIP module: ${name}`));
  try {
    const out = await module.run(seed, ctx);
    return { status: out.status || 'success', data: out.data ?? null, reason: out.reason || null, error: out.error || null };
  } catch (err) { return failed(err); }
}

/** Credential state for the /config endpoint. Never returns the keys themselves. */
function configured() {
  return {
    abr: !!process.env.ABR_GUID,
    places: !!process.env.GOOGLE_PLACES_API_KEY,
    googleSearch: !!(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX),
    asic: false,
  };
}

/** Stage 1: seed sources run in parallel, because none depends on another. */
async function seedAll(domain, ctx = {}) {
  const names = ['registration', 'dns', 'website', 'domainsTool'];
  const entries = await Promise.all(names.map(async (name) => [name, await runModule(name, { domain, website: null }, ctx)]));
  const results = Object.fromEntries(entries);
  const seed = { domain };
  for (const [name, entry] of entries) {
    if (entry.data && typeof entry.data === 'object') Object.assign(seed, { [name]: entry.data });
  }
  seed.checkedAt = new Date().toISOString();
  return { seed, results };
}

module.exports = { MODULES, BY_NAME, runModule, configured, seedAll, success, skipped, failed, businessName, findAbn };
