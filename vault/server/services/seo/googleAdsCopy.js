'use strict';

const { callJson, resolveModel, siteBrief } = require('./googleAdsKeywords');
const { captureIf, makeFingerprint } = require('../SuggestionService');
const { assertUsableScrape } = require('./siteScraper');

const HEADLINE_MAX = 30;
const DESCRIPTION_MAX = 90;
const PATH_MAX = 15;
const SITELINK_TEXT_MAX = 25;
const SITELINK_DESC_MAX = 35;
const HEADLINE_COUNT = 15;
const DESCRIPTION_COUNT = 4;
const AD_COUNT = 3;

const COPY_SYSTEM = `You write Google Ads Responsive Search Ads (RSA) for an initial Search campaign.
Return ONLY valid JSON. No markdown fences.
Hard limits (count every character including spaces; never exceed):
- headlines: exactly 15 unique lines, each 30 characters or fewer
- descriptions: exactly 4 unique lines, each 90 characters or fewer
- path1 / path2: 15 characters or fewer, no slashes, no spaces, lowercase if possible
- sitelink text: 25 characters or fewer; sitelink descriptions: 35 characters or fewer
Rules:
- Ground every claim in the scraped site. No invented prices, guarantees, or reviews.
- Mix brand, offer, benefit, proof, CTA, and location (if geo is clear).
- Headlines must stand alone; Google will mix them. Avoid repeating the same phrase.
- Descriptions should include a clear next step (call, quote, book, shop).
- finalUrl MUST be one of the scraped page URLs (or the homepage). Do not invent paths.
- Write 3 ad groups: (1) brand / homepage (2) primary offer (3) location or secondary offer.`;

function clampChars(raw, max) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const softer = cut.replace(/\s+\S*$/, '').trim();
  return softer || cut;
}

function uniqueStrings(list, maxChars, limit) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const text = clampChars(typeof raw === 'string' ? raw : (raw?.text || raw?.headline || raw?.description), maxChars);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function pickUrl(raw, allowed, fallback) {
  const candidate = String(raw || '').trim();
  if (candidate && allowed.has(candidate)) return candidate;
  try {
    const abs = new URL(candidate).toString();
    if (allowed.has(abs)) return abs;
    const noSlash = abs.replace(/\/$/, '');
    for (const a of allowed) {
      if (a.replace(/\/$/, '') === noSlash) return a;
    }
  } catch { /* ignore */ }
  return fallback;
}

function allowedUrls(snapshot) {
  const set = new Set();
  const add = (u) => {
    if (!u) return;
    try { set.add(new URL(u).toString()); } catch { set.add(String(u)); }
  };
  add(snapshot.finalUrl || snapshot.url);
  for (const page of snapshot.pages || []) add(page.url);
  return set;
}

function asPath(raw) {
  return clampChars(String(raw || '').replace(/[/\s]+/g, '-').replace(/^-|-$/g, ''), PATH_MAX);
}

function padHeadlines(list) {
  const out = list.slice();
  const extras = [
    'Get a free quote',
    'Talk to us today',
    'Book online now',
    'Trusted local team',
    'Quality you can trust',
    'Fast, friendly service',
    'See how we can help',
    'Request a callback',
  ];
  for (const extra of extras) {
    if (out.length >= HEADLINE_COUNT) break;
    const t = clampChars(extra, HEADLINE_MAX);
    if (t && !out.some((h) => h.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, HEADLINE_COUNT);
}

function padDescriptions(list, business) {
  const out = list.slice();
  const extras = [
    `Choose ${business || 'us'} for clear advice and a straightforward next step. Get in touch today.`,
    'Tell us what you need. We will come back with practical options — no pressure, no jargon.',
  ];
  for (const extra of extras) {
    if (out.length >= DESCRIPTION_COUNT) break;
    const t = clampChars(extra, DESCRIPTION_MAX);
    if (t && !out.some((d) => d.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, DESCRIPTION_COUNT);
}

function normaliseAd(raw, allowed, fallbackUrl, business) {
  const headlines = padHeadlines(uniqueStrings(raw?.headlines || raw?.headline, HEADLINE_MAX, HEADLINE_COUNT));
  const descriptions = padDescriptions(
    uniqueStrings(raw?.descriptions || raw?.description, DESCRIPTION_MAX, DESCRIPTION_COUNT),
    business
  );
  return {
    adGroup: clampChars(raw?.adGroup || raw?.name || 'Ad group', 64) || 'Ad group',
    finalUrl: pickUrl(raw?.finalUrl || raw?.url || raw?.destinationUrl, allowed, fallbackUrl),
    path1: asPath(raw?.path1 || raw?.path_1),
    path2: asPath(raw?.path2 || raw?.path_2),
    headlines,
    descriptions,
  };
}

function normaliseSitelink(raw, allowed, fallbackUrl) {
  const text = clampChars(raw?.text || raw?.name || raw?.title, SITELINK_TEXT_MAX);
  if (!text) return null;
  return {
    text,
    url: pickUrl(raw?.url || raw?.finalUrl, allowed, fallbackUrl),
    description1: clampChars(raw?.description1 || raw?.desc1, SITELINK_DESC_MAX),
    description2: clampChars(raw?.description2 || raw?.desc2, SITELINK_DESC_MAX),
  };
}

async function generateGoogleAdsCopy(userId, snapshot, { notes = '', keywords = [], business = '', geo = '' } = {}) {
  assertUsableScrape(snapshot);
  const modelId = await resolveModel(userId);
  const brief = siteBrief(snapshot, notes);
  const pages = (snapshot.pages || []).map((p) => `${p.title || ''} ${p.url}`).join('\n');
  const kwSample = (keywords || []).slice(0, 30).map((k) => k.phrase).join(', ');
  const home = snapshot.finalUrl || snapshot.url;
  const allowed = allowedUrls(snapshot);

  const parsed = await callJson(userId, modelId, `${brief}

Scraped page URLs (use these as destination URLs only):
${pages || home}

Business: ${business || snapshot.title || ''}
Geo: ${geo || ''}
Sample keywords: ${kwSample}

Write ${AD_COUNT} Responsive Search Ads plus sitelinks.
Return JSON:
{
  "campaignName": "...",
  "ads": [
    {
      "adGroup": "...",
      "finalUrl": "https://...",
      "path1": "services",
      "path2": "quote",
      "headlines": ["...", "..."],
      "descriptions": ["...", "..."]
    }
  ],
  "sitelinks": [
    { "text": "...", "url": "https://...", "description1": "...", "description2": "..." }
  ]
}
Each ads[] item MUST have exactly ${HEADLINE_COUNT} headlines and ${DESCRIPTION_COUNT} descriptions.`, {
    system: COPY_SYSTEM,
    maxTokens: 6000,
    feature: 'seo_ads',
  });

  const adsRaw = Array.isArray(parsed?.ads) ? parsed.ads : [];
  const ads = adsRaw
    .slice(0, AD_COUNT)
    .map((ad) => normaliseAd(ad, allowed, home, business || snapshot.title))
    .filter((ad) => ad.headlines.length && ad.descriptions.length);

  const sitelinks = [];
  const seenLink = new Set();
  for (const raw of parsed?.sitelinks || []) {
    const link = normaliseSitelink(raw, allowed, home);
    if (!link) continue;
    const key = `${link.text.toLowerCase()}|${link.url}`;
    if (seenLink.has(key)) continue;
    seenLink.add(key);
    sitelinks.push(link);
    if (sitelinks.length >= 8) break;
  }

  if (sitelinks.length < 2) {
    for (const page of snapshot.pages || []) {
      if (sitelinks.length >= 4) break;
      const text = clampChars(page.title || 'Learn more', SITELINK_TEXT_MAX);
      if (!text) continue;
      const key = `${text.toLowerCase()}|${page.url}`;
      if (seenLink.has(key)) continue;
      seenLink.add(key);
      sitelinks.push({ text, url: page.url, description1: '', description2: '' });
    }
  }

  return {
    kind: 'google_ads_copy',
    campaignName: clampChars(parsed?.campaignName || snapshot.title || 'Search campaign', 80),
    ads,
    sitelinks,
    counts: {
      ads: ads.length,
      headlines: ads.reduce((n, a) => n + a.headlines.length, 0),
      descriptions: ads.reduce((n, a) => n + a.descriptions.length, 0),
      sitelinks: sitelinks.length,
    },
    generatedAt: new Date().toISOString(),
    model: modelId,
  };
}

async function reportCopyGaps(userId, projectId, payload) {
  const shortAds = (payload?.ads || []).filter(
    (a) => a.headlines.length < HEADLINE_COUNT || a.descriptions.length < DESCRIPTION_COUNT
  );
  await captureIf(shortAds.length > 0 || (payload?.ads || []).length < AD_COUNT, {
    userId,
    source: 'seo',
    category: 'alert',
    fingerprint: makeFingerprint('seo', `short-ads:${projectId}`),
    title: 'SEO ad copy came in short of a full RSA set',
    body: `Project ${projectId} has ${payload?.counts?.ads || 0} ads (target ${AD_COUNT}), with some headline/description counts below 15/4. Regenerate ads, or add notes about the offer.`,
    context: `/seo/${projectId}`,
  });
}

module.exports = {
  HEADLINE_MAX,
  DESCRIPTION_MAX,
  generateGoogleAdsCopy,
  reportCopyGaps,
};
