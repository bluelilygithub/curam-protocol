'use strict';

// Topic Research: may a page be read? Fetches and obeys a site's robots.txt (RFC 9309) before any article page is downloaded.
//   - fetched through the SSRF-safe fetcher with our honest user agent (never the SEO crawler's browser-impersonating fetch);
//   - the group for our agent name ("curamvault") is used, else the "*" group; Allow/Disallow are decided by the longest matching rule
//     (Allow wins a tie), with * and $ in a rule understood; Crawl-delay is passed on;
//   - a missing robots.txt (404, 410 and other 4xx) means everything is allowed; one that cannot be read (5xx, timeout, refused) means
//     nothing is read from that site this time, which is what the standard says;
//   - the answer for a site is kept for an hour, and two pages of one site never fetch it twice at once.
// See docs/topic-research.md.

const { fetchPublicFile } = require('../../utils/safeFetch');

const AGENT_TOKEN = 'curamvault';
const TTL_MS = 60 * 60 * 1000;
const MAX_ROBOTS_BYTES = 512 * 1024; // the standard asks crawlers to read at least 500 KiB
const MAX_CRAWL_DELAY_MS = 10000; // a site that asks for longer than this is not worth waiting for

const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** robots.txt text -> groups: [{ agents: [lower-case names], rules: [{ allow, pattern }], crawlDelayMs|null }] */
function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [], crawlDelayMs: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (value) current.rules.push({ allow: field === 'allow', pattern: value }); // an empty Disallow allows everything: no rule
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelayMs = Math.round(n * 1000);
    }
  }
  return groups;
}

const patternToRegex = (pattern) => {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map(escapeRe).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
};

/** The rules and crawl delay that apply to us: the groups naming us, else the "*" groups. */
function rulesFor(groups, token = AGENT_TOKEN) {
  let mine = groups.filter((g) => g.agents.includes(token));
  if (!mine.length) mine = groups.filter((g) => g.agents.includes('*'));
  const delays = mine.map((g) => g.crawlDelayMs).filter((d) => d != null);
  return { rules: mine.flatMap((g) => g.rules), crawlDelayMs: delays.length ? Math.max(...delays) : null };
}

/** Longest matching rule wins; Allow wins a tie; no matching rule means allowed. `path` is the path plus query. */
function isAllowed(rules, path) {
  let best = null;
  for (const r of rules) {
    if (!patternToRegex(r.pattern).test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}

const httpStatusOf = (err) => {
  const m = /HTTP (\d{3})/.exec(String(err?.message || ''));
  return m ? Number(m[1]) : null;
};

/**
 * @param fetchFile injectable so tests need no network (same signature as fetchPublicFile)
 * @returns { check(url) -> { allowed, reason: 'allowed'|'disallowed'|'unavailable', crawlDelayMs|null } }
 */
function createRobotsChecker({ fetchFile = fetchPublicFile, now = Date.now, ttlMs = TTL_MS, token = AGENT_TOKEN } = {}) {
  const cache = new Map(); // origin -> { at, promise }

  async function load(origin) {
    try {
      const file = await fetchFile(`${origin}/robots.txt`, { maxBytes: MAX_ROBOTS_BYTES, timeoutMs: 8000, accept: 'text/plain, */*;q=0.5' });
      return { kind: 'rules', ...rulesFor(parseRobots(file.buffer.toString('utf8')), token) };
    } catch (err) {
      const status = httpStatusOf(err);
      // no robots.txt (404, 410...) means everything is allowed. A site that refuses even to hand over its robots.txt (401, 403) or asks us
      // to slow down (429) is treated as "do not read": RFC 9309 would allow it for a 4xx, but the spirit of the guardrail is not to push in.
      if (status && status >= 400 && status < 500 && ![401, 403, 429].includes(status)) return { kind: 'none' };
      return { kind: 'unavailable' };
    }
  }

  return {
    async check(rawUrl) {
      let u;
      try { u = new URL(rawUrl); } catch { return { allowed: false, reason: 'unavailable', crawlDelayMs: null }; }
      const origin = u.origin;
      let entry = cache.get(origin);
      if (!entry || now() - entry.at > ttlMs) {
        entry = { at: now(), promise: load(origin) };
        cache.set(origin, entry);
      }
      const r = await entry.promise;
      if (r.kind === 'none') return { allowed: true, reason: 'allowed', crawlDelayMs: null };
      if (r.kind === 'unavailable') return { allowed: false, reason: 'unavailable', crawlDelayMs: null };
      if (r.crawlDelayMs != null && r.crawlDelayMs > MAX_CRAWL_DELAY_MS) return { allowed: false, reason: 'disallowed', crawlDelayMs: r.crawlDelayMs };
      const allowed = isAllowed(r.rules, `${u.pathname}${u.search}`);
      return { allowed, reason: allowed ? 'allowed' : 'disallowed', crawlDelayMs: r.crawlDelayMs };
    },
  };
}

module.exports = { parseRobots, rulesFor, isAllowed, createRobotsChecker, AGENT_TOKEN, MAX_CRAWL_DELAY_MS };
