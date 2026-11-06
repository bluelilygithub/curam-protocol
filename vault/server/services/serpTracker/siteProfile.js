'use strict';

// SERP Tracker: the tracked site's settings (the brief's config.yaml, kept in the database and edited on the page).
// Pure: no database, no network. `validateProfile` returns every problem at once, in plain words, so the page can show them
// next to the fields instead of failing on the first one. See docs/serp-tracker.md.

const DEVICES = ['desktop', 'mobile'];
const DEFAULTS = Object.freeze({
  locationName: 'Australia',
  languageCode: 'en',
  devices: ['desktop', 'mobile'],
  serpDepth: 100,
  timezone: 'Australia/Brisbane',
});
const LIMITS = Object.freeze({ keywords: 50, brandTerms: 20, competitors: 20, competitorPages: 10, healthUrls: 50 });

const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** "https://www.Example.com.au/page" -> "example.com.au". Returns '' when it is not a plausible host name. */
function normaliseDomain(input) {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  return HOST_RE.test(s) ? s : '';
}

/** True when `host` is `domain` or a subdomain of it (www. included). Same-site test for typed URLs. */
function hostBelongsTo(host, domain) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return h === domain || h.endsWith(`.${domain}`);
}

/** An http(s) URL as typed -> its URL object, or null. */
function parseHttpUrl(input) {
  try {
    const u = new URL(String(input || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validTimezone(tz) {
  try { new Intl.DateTimeFormat('en-AU', { timeZone: tz }); return true; } catch { return false; }
}

/**
 * @param raw the profile as the page sends it
 * @returns {{ ok: boolean, profile: object|null, errors: string[] }}
 */
function validateProfile(raw) {
  const errors = [];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const domain = normaliseDomain(src.domain);
  if (!domain) errors.push('Site domain is missing or not a valid web address (for example example.com.au).');

  const brandSeen = new Set();
  const brandTerms = [];
  for (const t of Array.isArray(src.brandTerms) ? src.brandTerms : []) {
    const term = cleanText(t, 80);
    if (!term || brandSeen.has(term.toLowerCase())) continue;
    brandSeen.add(term.toLowerCase());
    brandTerms.push(term);
  }
  if (brandTerms.length > LIMITS.brandTerms) errors.push(`At most ${LIMITS.brandTerms} brand terms.`);

  const locationName = cleanText(src.locationName, 120) || DEFAULTS.locationName;
  const languageCode = cleanText(src.languageCode, 12) || DEFAULTS.languageCode;
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(languageCode)) errors.push('Language code should look like "en" or "en-AU".');

  let devices = Array.isArray(src.devices) ? [...new Set(src.devices.map((d) => String(d).toLowerCase()))] : DEFAULTS.devices.slice();
  if (!devices.length) errors.push('Choose at least one device (desktop or mobile).');
  if (devices.some((d) => !DEVICES.includes(d))) errors.push('Devices can only be desktop or mobile.');
  devices = devices.filter((d) => DEVICES.includes(d));

  const depth = src.serpDepth == null || src.serpDepth === '' ? DEFAULTS.serpDepth : Number(src.serpDepth);
  if (!Number.isInteger(depth) || depth < 10 || depth > 100 || depth % 10 !== 0) errors.push('Results to request must be a whole number from 10 to 100, in steps of 10.');

  const timezone = cleanText(src.timezone, 64) || DEFAULTS.timezone;
  if (!validTimezone(timezone)) errors.push(`"${timezone}" is not a known time zone (for example Australia/Brisbane).`);

  const keywords = [];
  const kwSeen = new Set();
  const rawKeywords = Array.isArray(src.keywords) ? src.keywords : [];
  if (rawKeywords.length > LIMITS.keywords) errors.push(`At most ${LIMITS.keywords} keywords.`);
  rawKeywords.forEach((k, i) => {
    const item = typeof k === 'string' ? { term: k } : (k || {});
    const term = cleanText(item.term, 120);
    if (!term) { errors.push(`Keyword ${i + 1} has no words.`); return; }
    if (kwSeen.has(term.toLowerCase())) { errors.push(`Keyword "${term}" is listed twice.`); return; }
    kwSeen.add(term.toLowerCase());
    const out = { term };
    const rawUrl = cleanText(item.targetUrl, 500);
    if (rawUrl) {
      const u = parseHttpUrl(rawUrl);
      if (!u) errors.push(`The target page for "${term}" is not a web address starting with http:// or https://.`);
      else if (domain && !hostBelongsTo(u.hostname, domain)) errors.push(`The target page for "${term}" is not on ${domain}.`);
      else out.targetUrl = u.toString();
    }
    keywords.push(out);
  });

  const competitors = [];
  const compSeen = new Set();
  const rawComps = Array.isArray(src.competitors) ? src.competitors : [];
  if (rawComps.length > LIMITS.competitors) errors.push(`At most ${LIMITS.competitors} competitors.`);
  rawComps.forEach((c, i) => {
    const item = typeof c === 'string' ? { domain: c } : (c || {});
    const d = normaliseDomain(item.domain);
    if (!d) { errors.push(`Competitor ${i + 1} is not a valid web address.`); return; }
    if (d === domain) { errors.push(`${d} is your own site, not a competitor.`); return; }
    if (compSeen.has(d)) { errors.push(`Competitor ${d} is listed twice.`); return; }
    compSeen.add(d);
    const pages = [];
    const rawPages = Array.isArray(item.pages) ? item.pages : [];
    if (rawPages.length > LIMITS.competitorPages) errors.push(`At most ${LIMITS.competitorPages} pages for ${d}.`);
    for (const p of rawPages) {
      const text = cleanText(p, 500);
      if (!text) continue;
      const u = parseHttpUrl(text);
      if (!u) errors.push(`"${text.slice(0, 60)}" is not a web address starting with http:// or https://.`);
      else if (!hostBelongsTo(u.hostname, d)) errors.push(`${text.slice(0, 60)} is not on ${d}.`);
      else pages.push(u.toString());
    }
    competitors.push({ domain: d, pages });
  });

  const healthCheckUrls = [];
  const rawHealth = Array.isArray(src.healthCheckUrls) ? src.healthCheckUrls : [];
  if (rawHealth.length > LIMITS.healthUrls) errors.push(`At most ${LIMITS.healthUrls} pages to health-check.`);
  for (const h of rawHealth) {
    const text = cleanText(h, 500);
    if (!text) continue;
    const u = parseHttpUrl(text);
    if (!u) errors.push(`"${text.slice(0, 60)}" is not a web address starting with http:// or https://.`);
    else if (domain && !hostBelongsTo(u.hostname, domain)) errors.push(`${text.slice(0, 60)} is not on ${domain}.`);
    else if (!healthCheckUrls.includes(u.toString())) healthCheckUrls.push(u.toString());
  }

  if (errors.length) return { ok: false, profile: null, errors };
  return { ok: true, errors: [], profile: { domain, brandTerms, locationName, languageCode, devices, serpDepth: depth, timezone, keywords, competitors, healthCheckUrls } };
}

/** The calendar date ("YYYY-MM-DD") in `timeZone` at `now`. The brief groups every report by this Brisbane date. */
function localDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** True when it is Monday in `timeZone` at `now` (weekly tasks run on those days). */
function isLocalMonday(now, timeZone) {
  return new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short' }).format(now) === 'Mon';
}

module.exports = { validateProfile, normaliseDomain, hostBelongsTo, parseHttpUrl, localDate, isLocalMonday, DEFAULTS, LIMITS, DEVICES };
