'use strict';

// BIP stage 1: the public pages of the target website. All fetches go through htmlFetch, which carries Vault's SSRF guard.
// Extraction is deterministic: it records what was on the page, with the page it came from, and leaves conflict decisions to Stage 3.

const fetchLib = require('../htmlFetch');
const { cleanText, keywords, unique } = require('./normalise');

const PATHS = ['/', '/about', '/contact', '/sitemap.xml'];
const MAX_TEXT = 24000;
const MAX_HTML = 400000;

const SOCIAL_PATTERNS = [
  { network: 'facebook', re: /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/([^"'<>\s?#]+)/gi },
  { network: 'instagram', re: /https?:\/\/(?:www\.)?instagram\.com\/([^"'<>\s?#]+)/gi },
  { network: 'twitter', re: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([^"'<>\s?#]+)/gi },
  { network: 'linkedin', re: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([^"'<>\s?#]+)/gi },
  { network: 'youtube', re: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|user\/)?([^"'<>\s?#]+)/gi },
];

const ANALYTICS_PATTERNS = [
  { name: 'Google Analytics', re: /google-analytics\.com|googletagmanager\.com\/gtag/i },
  { name: 'Google Tag Manager', re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i },
  { name: 'Meta Pixel', re: /connect\.facebook\.net|fbevents\.js/i },
  { name: 'Google Ads', re: /googleadservices\.com|gclid/i },
  { name: 'Hotjar', re: /static\.hotjar\.com/i },
];

function meta(html, names) {
  for (const name of names) {
    const re = new RegExp(`<meta\\s+[^>]*?(?:name|property)=["']${name}["'][^>]*?content=["']([^"']+)["']`, 'i');
    const m = String(html || '').match(re);
    if (m) return cleanText(m[1].replace(/&amp;/g, '&'), 500);
  }
  return null;
}

function extractSocialLinks(html) {
  const links = [];
  for (const { network, re } of SOCIAL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(String(html || ''))) && links.length < 40) {
      const url = m[0].replace(/&amp;/g, '&');
      const handle = decodeURIComponent(m[1]).split('/')[0];
      const ignored = new Set(['share', 'intent', 'home', 'login', 'signup', 'p', 'channels', 'watch', 'c', 'about', 'jobs']);
      if (ignored.has(String(handle).toLowerCase())) continue;
      links.push({ network, url, handle: handle || null });
    }
  }
  return links;
}

function extractAnalytics(html) {
  return ANALYTICS_PATTERNS.filter((p) => p.re.test(String(html || ''))).map((p) => p.name);
}

/**
 * A phone number, not a date, year range or id: international (+, 8-15 digits) or an Australian shape (0X XXXX XXXX, 1300/1800).
 * Dates such as 2026-11-10 and ids such as 313209466-1 used to pass a plain "8 to 15 digits" test.
 */
function looksLikePhone(s) {
  const raw = String(s || '').trim();
  if (/\b(?:19|20)\d{2}\s*[-–/.]\s*(?:\d{1,2}\b|(?:19|20)\d{2}\b)/.test(raw)) return false;
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return d.length >= 8 && d.length <= 15;
  return /^0[2-478]\d{8}$/.test(d) || /^1[38]00\d{6}$/.test(d);
}

// whole words only ("replaces" is not "place"), with a street number before the street word, or a Level/Suite/Unit/PO Box line
const STREET_WORD = String.raw`(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|place|pl|crescent|cres|boulevard|blvd|parade|pde|highway|hwy|terrace|tce|court|ct|circuit|cct)`;
const STREET_RE = new RegExp(String.raw`(?:\b\d+[A-Za-z]?(?:\s*[-/]\s*\d+)?\s+(?:[A-Za-z'.-]+\s+){1,4}${STREET_WORD}\b|^\s*(?:level|suite|unit|shop)\s+\d+|\bp\.?\s?o\.?\s?box\s+\d+)`, 'i');
// a state (optionally with its postcode) or the country; a bare 4-digit number is too often a year
const STATE_RE = /\b(?:VIC|NSW|QLD|WA|SA|TAS|NT|ACT|Victoria|New South Wales|Queensland|Tasmania)\b|\bAustralia\b/i;

/** Addresses, read across line breaks: "Level 10, 637 Flinders Street" + "Docklands VIC 3008" (a <br> between them) is one address. */
function extractAddresses(text) {
  const lines = String(text || '').split(/\n|[!?]|\.\s+(?=[A-Z])/).map((line) => cleanText(line, 200)).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > 120 || !STREET_RE.test(lines[i])) continue;
    for (let n = 0; n < 3 && i + n < lines.length; n += 1) {
      if (!STATE_RE.test(lines[i + n])) continue;
      // "…, Docklands VIC 3008, Australia" and "…, Docklands VIC 3008" are the same address
      const joined = lines.slice(i, i + n + 1).join(', ').replace(/,?\s*Australia\.?$/i, '').trim();
      if (joined.length <= 200 && joined.length > 8) out.push(joined);
      break;
    }
  }
  return out;
}

function extractContact(text) {
  const emails = [...String(text || '').matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map((m) => m[0].toLowerCase());
  const phones = [...String(text || '').matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)]
    .map((m) => m[0].trim())
    .filter(looksLikePhone);
  const abns = [...String(text || '').matchAll(/\bA\.?B\.?N\.?\s*(?:no\.?|number)?[:\s]*((?:\d\s?){11})/gi)].map((m) => m[1].replace(/\s+/g, ' ').trim());
  return {
    emails: unique(emails).slice(0, 20),
    phones: unique(phones).slice(0, 12),
    addresses: unique(extractAddresses(text)).slice(0, 12),
    abns: unique(abns).slice(0, 5),
  };
}

const LEGAL_SUFFIX = String.raw`(?:Pty\.?\s*Ltd\.?|Pty\.?\s*Limited|Proprietary\s+Limited|Limited|Ltd\.?|Inc\.?|LLC|Incorporated)`;

/**
 * The business's own names on its pages: the legal name in a "© 2005-2026 SalesLogs Pty Ltd" line (only when it ends in a company
 * suffix), and the site name from og:site_name or the part of a page title after "|" / "–" ("About Us | SalesLogs" -> SalesLogs).
 */
function extractNames(pages) {
  const text = pages.map((p) => p.text || '').join('\n');
  // a legal page's "SalesLogs Pty Limited ABN 69 161 409 132" first (the registered name), then the footer's "© 2005-2026 SalesLogs Pty Ltd"
  // the first word needs 2+ letters and no dot, so a list label such as "A." is not taken as part of the name
  const withAbn = text.match(new RegExp(String.raw`\b([A-Z][A-Za-z0-9&'\-]+(?: [A-Za-z0-9&'.\-]+){0,6}? ${LEGAL_SUFFIX})\s*\(?\s*(?:ABN|ACN)\b`));
  const legal = withAbn || text.match(new RegExp(String.raw`(?:©|\(c\)|copyright)\s*(?:copyright\s*)?(?:(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?)?[\s,.]*([A-Z][A-Za-z0-9&'.\- ]{0,60}?\s${LEGAL_SUFFIX})`, 'i'));
  const fromTitles = pages
    .map((p) => String(p.title || '').split(/\s+[|–—-]\s+/))
    .filter((parts) => parts.length > 1)
    .map((parts) => cleanText(parts[parts.length - 1], 60))
    .filter((s) => s && s.length <= 40 && !/^(home|welcome)$/i.test(s));
  const counts = new Map();
  for (const s of fromTitles) counts.set(s, (counts.get(s) || 0) + 1);
  const titleName = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    legalName: legal ? cleanText(legal[1], 80) : null,
    siteName: meta(pages[0]?.html, ['og:site_name']) || titleName,
  };
}

const ROLE_RE = /\b(CEO|CTO|CFO|COO|CMO|founder|co-founder|managing director|director|chair(?:man|woman)?|general manager|head of [A-Za-z ]{2,30}|operations manager|sales manager|marketing manager|principal|owner)\b/i;

function extractPeople(text, pages = []) {
  const people = [];
  for (const line of String(text || '').split(/\n+/)) {
    const clean = cleanText(line, 180);
    if (!clean || clean.length > 160 || !ROLE_RE.test(clean)) continue;
    const role = clean.match(ROLE_RE)[1];
    const name = clean.split(/\s+[,\-–—|]\s*|\s*,\s*/)[0].replace(ROLE_RE, '').replace(/^(?:is|our|the|meet)\s+/i, '').replace(/[^A-Za-z .'-]/g, '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 5) continue;
    people.push({ name: cleanText(name, 100), role: cleanText(role, 80), sourcePage: pages.find((p) => String(p).includes(clean.slice(0, 40))) || null });
  }
  return unique(people.map((p) => `${p.name} — ${p.role}`)).slice(0, 20).map((s) => {
    const [name, role] = s.split(' — ');
    return { name, role };
  });
}

/** A few facts the profile cards use. Only explicit statements are taken; nothing is inferred from a name. */
function extractFacts(text) {
  const s = String(text || '');
  const employees = s.match(/\b(?:team of|over|around|about|approximately|~)?\s*(\d{1,5})\s*(?:people|employees|staff|team members)\b/i)
    || s.match(/\bemployed\s+(\d{1,5})\b/i);
  const founded = s.match(/\b(?:founded|established|started|formed)\s+(?:in\s+)?(19\d{2}|20\d{2})\b/i)
    || s.match(/\b(?:est\.?|since)\s*(19\d{2}|20\d{2})\b/i);
  const industries = [
    ['automotive SaaS', /\bautomotive\b/i],
    ['software / SaaS', /\b(?:saas|software|cloud platform)\b/i],
    ['professional services', /\b(?:consulting|professional services)\b/i],
    ['retail', /\bretail\b/i],
    ['healthcare', /\b(?:healthcare|medical|clinical)\b/i],
  ];
  return {
    employeeCount: employees ? Number(employees[1]) : null,
    foundedYear: founded ? Number(founded[1]) : null,
    industryHints: industries.filter(([, re]) => re.test(s)).map(([label]) => label),
  };
}

function techFromHtml(html, analytics) {
  const detected = [];
  for (const { name, re } of ANALYTICS_PATTERNS) if (re.test(String(html || ''))) detected.push({ category: 'Analytics', name, evidence: 'website source' });
  const cms = [
    { name: 'WordPress', re: /wp-content|wp-includes/i },
    { name: 'Shopify', re: /cdn\.shopify\.com|myshopify\.com/i },
    { name: 'Wix', re: /wix\.com|static\.wixstatic/i },
    { name: 'Squarespace', re: /squarespace\.com/i },
    { name: 'Webflow', re: /webflow\.io|wf-page/i },
  ];
  for (const c of cms) if (c.re.test(String(html || ''))) detected.push({ category: 'CMS', name: c.name, evidence: 'website source' });
  return { analytics, detected };
}

async function fetchPage(normalisedUrl, deps = {}) {
  const fetchHtml = deps.fetchHtml || fetchLib.fetchHtml;
  const normaliseHttpUrl = deps.normaliseHttpUrl || fetchLib.normaliseHttpUrl;
  const htmlToText = deps.htmlToText || fetchLib.htmlToText;
  const target = normaliseHttpUrl(normalisedUrl);
  if (!target) return null;
  try {
    const res = await fetchHtml(target);
    if (res.statusCode >= 400 || !res.body) return { url: target, status: res.statusCode, text: '', html: '' };
    return {
      url: target,
      status: res.statusCode,
      title: fetchLib.extractTitle ? fetchLib.extractTitle(res.body) : null,
      text: htmlToText(res.body, MAX_TEXT),
      html: String(res.body || '').slice(0, MAX_HTML),
    };
  } catch (err) {
    return { url: target, status: 0, text: '', html: '', error: err.message };
  }
}

// Further pages worth reading, by the LAST part of their path (so /teams or /benefits-sales-team, product pages, are not "team"):
// legal pages carry the entity name and ABN ("SalesLogs Pty Limited ABN 69 161 409 132"), the others name people and history.
const EXTRA_PAGES = [
  /^(terms|terms-of-use|terms-of-service|terms-and-conditions|legal|disclaimer)$/,
  /^(privacy|privacy-policy)$/,
  /^(team|our-team|meet-the-team|leadership|management|founders?|people|our-people|who-we-are)$/,
  /^(history|our-story|story|company|about-us)$/,
  /^(press|media|newsroom|in-the-news)$/,
  /^(case-studies|customers|testimonials)$/,
  /^(careers|jobs)$/,
];
const MAX_EXTRA = 8;

/** Same-site links (homepage hrefs and sitemap URLs) whose last path part matches EXTRA_PAGES, best first, at most MAX_EXTRA. */
function pickExtraPages(domain, homeHtml, sitemapUrls, alreadyFetched = []) {
  const host = String(domain).replace(/^www\./i, '').toLowerCase();
  const seen = new Set(alreadyFetched.map((u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return u; } }));
  const hrefs = [...String(homeHtml || '').matchAll(/href=["']([^"'#?]+)["']/gi)].map((m) => m[1]);
  const scored = [];
  for (const raw of [...hrefs, ...(sitemapUrls || [])]) {
    let url;
    try { url = new URL(raw, `https://${domain}/`); } catch { continue; }
    if (url.hostname.replace(/^www\./i, '').toLowerCase() !== host || !/^https?:$/.test(url.protocol)) continue;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (seen.has(path) || /\.(pdf|jpe?g|png|gif|svg|webp|zip|xml|css|js)$/i.test(path)) continue;
    const last = path.split('/').pop().toLowerCase();
    const rank = EXTRA_PAGES.findIndex((re) => re.test(last));
    if (rank < 0) continue;
    seen.add(path);
    scored.push({ rank, url: `${url.origin}${path}` });
  }
  return scored.sort((a, b) => a.rank - b.rank).slice(0, MAX_EXTRA).map((s) => s.url);
}

/** Stage 1 website scrape: homepage, /about, /contact and /sitemap.xml, then up to MAX_EXTRA legal, people and history pages. */
async function scrapeWebsite(domain, deps = {}) {
  const base = `https://${domain}`;
  const firstPages = await Promise.all(PATHS.map((p) => fetchPage(`${base}${p}`, deps)));
  const sitemapLocs = [...String(firstPages[3]?.html || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  const extraUrls = pickExtraPages(domain, firstPages[0]?.html, sitemapLocs, PATHS.map((p) => `${base}${p}`));
  const extraPages = await Promise.all(extraUrls.map((u) => fetchPage(u, deps)));
  const pages = [...firstPages, ...extraPages];
  // the HTML pages only: sitemap.xml is a list of URLs and <lastmod> dates, which became "keywords" (hubfs, thumbnail…) and "phones"
  const live = pages.filter((p, i) => i !== 3 && p && p.text);
  const allText = live.map((p) => p.text).join('\n');
  const allHtml = live.map((p) => p.html).join('\n');
  const homepage = pages[0] || {};
  // phones, emails and addresses from the business's own pages, not its legal pages: a privacy policy lists the regulator's
  // contact details (OAIC 1300 363 992). ABNs are read everywhere, since the legal pages are where they usually are.
  const ownText = live.filter((p) => !/\/(terms|privacy|legal|disclaimer)[^/]*$/i.test(p.url)).map((p) => p.text).join('\n');
  const contact = { ...extractContact(ownText), abns: extractContact(allText).abns };
  const analytics = extractAnalytics(allHtml);
  const socialLinks = unique(extractSocialLinks(allHtml).map((l) => l.url)).map((url) => {
    const found = extractSocialLinks(allHtml).find((l) => l.url === url);
    return found;
  });
  return {
    domain,
    pages: pages.filter(Boolean).map(({ url, status, title, text, error }) => ({ url, status, title, textLength: text.length, error: error || null })),
    ...extractNames(live),
    description: meta(homepage.html, ['description', 'og:description']) || meta(allHtml, ['description', 'og:description']),
    keywords: keywords(`${allText} ${meta(allHtml, ['keywords']) || ''}`),
    ...extractFacts(allText),
    ...contact,
    people: extractPeople(live.filter((p) => /about|team|leadership|management|founder|people|history|story/i.test(p.url)).map((p) => p.text).join('\n') || allText),
    socialLinks,
    analytics,
    tech: techFromHtml(allHtml, analytics),
    sitemapUrls: sitemapLocs.slice(0, 100),
    // text of the extra pages for the summary and web research (the first three pages keep their HTML in `raw`)
    extraPages: extraPages.filter((p) => p && p.text).map((p) => ({ url: p.url, title: p.title || null, text: p.text.slice(0, 4000) })),
    raw: { homepage: (homepage.html || '').slice(0, MAX_HTML), about: (pages[1]?.html || '').slice(0, MAX_HTML), contact: (pages[2]?.html || '').slice(0, MAX_HTML) },
  };
}

module.exports = {
  PATHS, meta, extractSocialLinks, extractAnalytics, extractContact, extractAddresses, extractNames, looksLikePhone, pickExtraPages,
  extractPeople, extractFacts, techFromHtml, scrapeWebsite,
};
