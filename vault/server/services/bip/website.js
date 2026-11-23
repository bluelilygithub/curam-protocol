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

function extractContact(text) {
  const emails = [...String(text || '').matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map((m) => m[0].toLowerCase());
  const phones = [...String(text || '').matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)]
    .map((m) => m[0].trim())
    .filter((s) => { const d = s.replace(/\D/g, ''); return d.length >= 8 && d.length <= 15; });
  const addresses = String(text || '')
    .split(/[\n.!?]/)
    .map((line) => cleanText(line, 200))
    .filter((line) => /\d/.test(line) && /(?:street|\bst\b|road|\brd\b|avenue|\bave\b|drive|\bdr\b|lane|\bln\b|way|place|\bpl\b|crescent|\bcres\b|boulevard|\bblvd\b|parade|\bpde\b|level|suite|unit)/i.test(line) && /(?:VIC|NSW|QLD|WA|SA|TAS|NT|ACT|Australia|\d{4})/i.test(line));
  return { emails: unique(emails).slice(0, 20), phones: unique(phones).slice(0, 12), addresses: unique(addresses).slice(0, 12) };
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

/** Stage 1 website scrape: homepage, /about, /contact and /sitemap.xml. */
async function scrapeWebsite(domain, deps = {}) {
  const base = `https://${domain}`;
  const pages = await Promise.all(PATHS.map((p) => fetchPage(`${base}${p}`, deps)));
  const live = pages.filter((p) => p && p.text);
  const allText = live.map((p) => p.text).join('\n');
  const allHtml = live.map((p) => p.html).join('\n');
  const homepage = pages[0] || {};
  const contact = extractContact(allText);
  const analytics = extractAnalytics(allHtml);
  const socialLinks = unique(extractSocialLinks(allHtml).map((l) => l.url)).map((url) => {
    const found = extractSocialLinks(allHtml).find((l) => l.url === url);
    return found;
  });
  return {
    domain,
    pages: pages.filter(Boolean).map(({ url, status, title, text, error }) => ({ url, status, title, textLength: text.length, error: error || null })),
    description: meta(homepage.html, ['description', 'og:description']) || meta(allHtml, ['description', 'og:description']),
    keywords: keywords(`${allText} ${meta(allHtml, ['keywords']) || ''}`),
    ...extractFacts(allText),
    ...contact,
    people: extractPeople(live.find((p) => /about/i.test(p.url))?.text || allText),
    socialLinks,
    analytics,
    tech: techFromHtml(allHtml, analytics),
    sitemapUrls: [...String(pages[3]?.html || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, 100),
    raw: { homepage: (homepage.html || '').slice(0, MAX_HTML), about: (pages[1]?.html || '').slice(0, MAX_HTML), contact: (pages[2]?.html || '').slice(0, MAX_HTML) },
  };
}

module.exports = { PATHS, meta, extractSocialLinks, extractAnalytics, extractContact, extractPeople, extractFacts, techFromHtml, scrapeWebsite };
