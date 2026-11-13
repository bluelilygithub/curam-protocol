'use strict';

/**
 * Question analysis for the AI Visibility audit (report version 2).
 *
 * Each buyer question gets two separate checks:
 *
 *   1. Search ranking: one live web search (Brave/Serper/SerpAPI, top 10). Where does the
 *      site rank? This is a search-engine signal, reported as such.
 *   2. Real AI assistants: the question is put to Claude (web search), Gemini (Google Search)
 *      and Perplexity where connected. Each assistant searches for itself. For each one:
 *      was the business named in the answer, and was a page on the site among its sources?
 *
 * Version 1 of the report had the configured model "answer" from the top five search
 * results only, so being named depended almost entirely on ranking in those five. That is
 * why the two checks are now separate and the assistants search for themselves.
 */

const { callModel } = require('../callModel');
const { searchWeb } = require('./searchClient');
const { evaluateFacts, normalise } = require('./facts');
const { askAssistant } = require('./assistants');

const SEARCH_RESULTS = 10;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}

/** The site's host, or one of its subdomains (shop.example.com counts for example.com). */
function hostMatches(host, domain) {
  const h = String(host || '').replace(/^www\./i, '').toLowerCase();
  const d = String(domain || '').replace(/^www\./i, '').toLowerCase();
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function extractUrls(text) {
  const found = new Set();
  const source = String(text || '');
  // Markdown links and bare URLs both count.
  for (const m of source.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)) found.add(m[1]);
  for (const m of source.matchAll(/https?:\/\/[^\s)\]"'<>]+/gi)) found.add(m[0]);
  return [...found].map((u) => u.replace(/[.,;:]+$/, ''));
}

// ── Brand matching ──────────────────────────────────────────────────────────

// A page title's first segment is often a page name, not a business name.
const GENERIC_TITLES = new Set(['home', 'homepage', 'home page', 'welcome', 'index', 'shop', 'store', 'about', 'about us', 'contact', 'contact us', 'products', 'services', 'blog', 'news']);
// Legal suffixes only. Place words such as "Australia" stay: in a descriptive name like
// "Walk-In Wine Cabinets Australia" they are what keeps it from being a generic phrase.
const LEGAL_SUFFIXES = /\b(pty\.?\s*ltd\.?|pty|ltd\.?|limited|inc\.?|llc|corp\.?)\s*$/i;

function tokens(value) {
  return normalise(String(value || '').replace(/[™®©]/g, ' '))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Words with a trailing plural "s" dropped, so "cabinet" and "cabinets" compare equal. */
function singular(words) {
  return words.map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

/**
 * Ways an answer might name the business: the brand as written, the brand without a legal
 * suffix (Pty Ltd, Inc…), and the domain label ("curam-ai" → "curam ai", "wiwc"). Each
 * variant is a list of words; a match allows a space, hyphen or nothing between them
 * ("Curam AI", "Curam-AI", "CuramAI").
 *
 * Variants that would match ordinary words are dropped: very short ones, page names such as
 * "Home", and any variant the question itself contains. A descriptive brand such as
 * "Walk-In Wine Cabinets Australia" asked about "a walk in wine cabinet" must not count as
 * "named" just because the answer repeats the product words. (Before 2026-11-13 the first
 * two words were also a variant, which made "walk in" count as naming wiwc.)
 */
function brandVariants(brand, domain, question = '') {
  const q = ` ${singular(tokens(question))} `;
  const out = [];
  const add = (words) => {
    const w = words.filter(Boolean);
    if (!w.length) return;
    const joined = w.join('');
    if (joined.length < 4) return;
    if (w.length === 1 && GENERIC_TITLES.has(w[0])) return;
    if (question && q.includes(` ${singular(w)} `)) return;
    const key = w.join(' ');
    if (!out.some((v) => v.join(' ') === key)) out.push(w);
  };
  const b = tokens(brand);
  if (b.length) {
    add(b);
    add(tokens(String(brand || '').replace(/[™®©]/g, '').replace(LEGAL_SUFFIXES, '')));
  }
  const label = String(domain || '').replace(/^www\./i, '').split('.')[0] || '';
  add(tokens(label.replace(/-/g, ' ')));
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Which brand variant (if any) the text names, as written in the text. */
function brandNamed(text, variants) {
  const hay = normalise(String(text || '')).replace(/[^a-z0-9]+/g, ' ');
  for (const words of variants || []) {
    const re = new RegExp(`(?:^|\\s)(${words.map(escapeRe).join('\\s?')})(?:\\s|$)`);
    const m = hay.match(re);
    if (m) return words.join(' ');
  }
  return '';
}

/** A usable brand from the page title: its first segment, unless that is a page name. */
function brandFromTitle(title, host) {
  const first = String(title || '').split(/\s*[|–—:·]\s*|\s+-\s+/)[0].replace(/[™®©]/g, '').trim();
  const label = String(host || '').split('.')[0] || '';
  if (!first || first.length > 60 || GENERIC_TITLES.has(first.toLowerCase())) return label;
  return first;
}

// ── Search ranking ──────────────────────────────────────────────────────────

/** Ranking score for one question: #1 100, top 3 85, top 5 70, top 10 50, not found 0. */
function rankScore(rank) {
  if (!rank) return 0;
  if (rank === 1) return 100;
  if (rank <= 3) return 85;
  if (rank <= 5) return 70;
  if (rank <= 10) return 50;
  return 0;
}

function rankOf(results, domain) {
  const i = (results || []).findIndex((r) => hostMatches(hostOf(r.url), domain));
  return i >= 0 ? i + 1 : null;
}

// ── Assistant verdicts ──────────────────────────────────────────────────────

/**
 * Per assistant: named (the brand or domain appears in the answer) and cited (a page on the
 * site is among its sources, or linked in the answer). 50 points each. Pure.
 */
function assistantVerdict(result, { domain, variants }) {
  if (!result || result.error || !result.answer) return { ...result, named: false, cited: false, score: null };
  const answer = String(result.answer);
  const namedAs = brandNamed(answer, variants);
  const domainNamed = !!domain && answer.toLowerCase().includes(domain);
  const sourceHits = (result.sources || []).filter((s) => hostMatches(hostOf(s.url), domain) || hostMatches(s.domain || '', domain));
  const linked = extractUrls(answer).filter((u) => hostMatches(hostOf(u), domain));
  const citedUrls = [...new Set([...sourceHits.map((s) => s.url || s.domain), ...linked])].slice(0, 6);
  const named = !!namedAs || domainNamed;
  const cited = citedUrls.length > 0;
  return {
    ...result,
    named,
    namedAs: namedAs || (domainNamed ? domain : ''),
    cited,
    citedUrls,
    score: (named ? 50 : 0) + (cited ? 50 : 0),
  };
}

// ── Questions ───────────────────────────────────────────────────────────────

function parseQueryList(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  // Prefer a JSON array, because that is what the prompt asks for.
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((q) => String(q || '').trim()).filter(Boolean);
      }
    } catch { /* fall through to line parsing */ }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/^["']|["',]+$/g, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 180);
}

/**
 * Questions made without a model. They are deliberately plain and work for a shop or a
 * service business; the report marks them as templates and suggests writing real ones.
 * The subject is the part of the title that describes the offer: the segment after the
 * brand when there is one ("Acme | Wine cellar cooling" → "wine cellar cooling").
 */
function fallbackQueries({ title, description, brand, host }) {
  const segments = String(title || '').split(/\s*[|–—:·]\s*|\s+-\s+/).map((s) => s.replace(/[™®©]/g, '').trim()).filter(Boolean);
  const brandWords = tokens(brand).join(' ');
  const describing = segments.find((s) => tokens(s).join(' ') !== brandWords && !GENERIC_TITLES.has(s.toLowerCase()));
  const fromDescription = String(description || '').split(/[.!?]/)[0].trim();
  const subject = (describing || (fromDescription.length <= 80 ? fromDescription : '') || segments[0] || host || 'this business')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .toLowerCase();
  const name = String(brand || host || '').trim();
  const list = [
    `${subject} in Australia`,
    `who are the best providers of ${subject}`,
    `how do I choose ${subject}`,
  ];
  if (name) list.push(`what do people say about ${name}`);
  return [...new Set(list.filter(Boolean))].slice(0, 4);
}

/**
 * Four realistic questions for this page. The model writes them from the page's own
 * title/description/headings; if it is unavailable the templates are used and the report
 * says so.
 */
async function generateQueries({ url, title, description, headings, brand, modelId, log = () => {} }) {
  const host = hostOf(url);
  const fallback = fallbackQueries({ title, description, brand, host });
  if (!modelId) return { queries: fallback, source: 'template', error: 'No text model is configured.' };

  const system = 'You write questions that real buyers or researchers type into an AI assistant. You return only JSON.';
  const prompt = [
    'Write exactly 4 questions that a potential customer might ask an AI assistant where this business should be one of the sources.',
    'They must be specific to what the page sells or explains. Mix buying intent and research intent. At most one question may include the brand name.',
    'Return ONLY a JSON array of 4 strings. No commentary.',
    '',
    `Website: ${url}`,
    `Brand: ${brand || host}`,
    `Page title: ${title || '(none)'}`,
    `Page description: ${description || '(none)'}`,
    `Headings: ${(headings || []).slice(0, 12).join(' | ') || '(none)'}`,
  ].join('\n');

  try {
    const raw = await callModel(modelId, prompt, { maxTokens: 400, system, timeoutMs: 60000 });
    const queries = parseQueryList(raw).slice(0, 4);
    if (queries.length >= 2) return { queries, source: 'model', error: '' };
    return { queries: fallback, source: 'template', error: 'The model returned no usable questions.' };
  } catch (err) {
    log(`query generation failed: ${err.message}`);
    return { queries: fallback, source: 'template', error: err.message };
  }
}

function average(values) {
  const nums = (values || []).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Run one question: a ranking search, then each selected assistant in parallel (different
 * providers, so they do not share a rate limit). Failures are recorded, never thrown.
 */
async function runQuery({ query, domain, brand, facts, assistants, userId }) {
  const variants = brandVariants(brand, domain, query);
  const base = {
    query,
    search: { provider: '', results: [], error: '' },
    rank: null,
    discoverability: null,
    assistants: [],
    assistantScore: null,
    factScore: null,
  };

  const searchPromise = searchWeb(query, { userId, limit: SEARCH_RESULTS })
    .then((search) => {
      base.search.provider = search.provider;
      base.search.results = search.results;
      base.rank = rankOf(search.results, domain);
      base.discoverability = rankScore(base.rank);
    })
    .catch((err) => { base.search.error = err.message; });

  const answers = await Promise.all((assistants || []).map((a) => askAssistant(a, query, { userId })));
  await searchPromise;

  base.assistants = answers.map((r) => {
    const v = assistantVerdict(r, { domain, variants });
    if (v.score != null && (facts || []).length) {
      v.facts = evaluateFacts(facts, v.answer);
      v.factScore = v.facts.length ? Math.round((v.facts.filter((f) => f.present).length / v.facts.length) * 100) : null;
    } else {
      v.facts = [];
      v.factScore = null;
    }
    return v;
  });
  base.assistantScore = average(base.assistants.map((a) => a.score));
  base.factScore = average(base.assistants.map((a) => a.factScore));
  return base;
}

module.exports = {
  SEARCH_RESULTS,
  hostOf,
  hostMatches,
  extractUrls,
  brandVariants,
  brandNamed,
  brandFromTitle,
  rankScore,
  rankOf,
  assistantVerdict,
  parseQueryList,
  fallbackQueries,
  generateQueries,
  runQuery,
};
