'use strict';

// Fetching a live page, and the style files it uses, for the CSS tool. Unlike htmlFetch.fetchHtml (made for reading text), this NEVER falls
// back to a text-only copy of the page (Serper, the WordPress REST API, Jina): those give you the words without the markup or the styling,
// which is exactly what makes a restyling tool look "terrible". Either the real page comes back or an honest error does.
//
// Some sites' firewalls turn away one browser identity and accept another (one we met answers 403 to "Chrome 128 on Windows" and 200 to a
// plain, honest agent or to Firefox), so a refused request is retried with other identities. The identity that worked is remembered for
// the rest of the job, so the style files are asked for the way the page was. Every request still goes through the SSRF checks in
// htmlFetch.fetchOnce. Test: node server/services/restyle/restyleFetch.test.js

const htmlFetch = require('../htmlFetch');

const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

// Header sets, tried in this order. Chrome first: it is what most sites expect, and it is what everything else in Vault sends.
const PROFILES = [
  { id: 'chrome', headers: htmlFetch.CHROME_HEADERS },
  { id: 'firefox', headers: { 'User-Agent': FIREFOX_UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-AU,en;q=0.5', 'Accept-Encoding': 'gzip, deflate' } },
  { id: 'plain', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaultCSSTool/1.0)', Accept: 'text/html,*/*;q=0.8', 'Accept-Encoding': 'gzip, deflate' } },
  { id: 'minimal', headers: { 'User-Agent': 'curl/8.5.0', Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' } },
];

// A page that says it is an error or a check, even though it came back 200.
// A leading error number, or a title that is nothing but a refusal (optionally followed by the site's name): "Forbidden | Site", not "Forbidden fruit".
const BLOCKED_TITLE = /^\s*(?:(?:403|401|429)\b|(?:forbidden|access denied|attention required!?|just a moment\.{0,3}|are you a robot\??|robot challenge(?: screen)?|captcha|request blocked|security check|verify you are human|checking your browser)\s*(?:[|–—:.!-].*)?$)/i;
const MIN_PAGE_CHARS = 200;

const titleOfHtml = (html) => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || '').slice(0, 20000)); return m ? m[1].trim() : ''; };
const looksLikePage = (body) => /<(html|body|head)[\s>]/i.test(String(body || '').slice(0, 20000));

/** Is this response the real page (not an error, a check or a stub)? */
function isRealPage(result) {
  // 200 only: a 202 or 204 is "come back later" or "nothing", which is how some firewalls hand out their challenge page
  if (!result || result.statusCode !== 200) return false;
  const body = String(result.body || '');
  return body.length >= MIN_PAGE_CHARS && looksLikePage(body) && !BLOCKED_TITLE.test(titleOfHtml(body));
}

/** Is this response a usable style file or asset? */
const isRealAsset = (result) => !!result && result.statusCode === 200 && String(result.body || '').length > 0;

/**
 * @param {{fetchOnce?: Function}} [deps]  replaced in tests
 * @returns {(url: string, opts?: {asset?: boolean}) => Promise<{body:string, statusCode:number, finalUrl:string, profile:string}>}
 *   Throws Error(`Server returned <status>`) when every identity was refused, so callers describe it like any other failed load.
 */
function createPageFetcher(deps = {}) {
  const fetchOnce = deps.fetchOnce || htmlFetch.fetchOnce;
  let winner = null; // the identity that last worked for this job

  return async function fetchPage(url, { asset = false } = {}) {
    const order = winner ? [winner, ...PROFILES.filter((p) => p.id !== winner.id)] : PROFILES;
    let lastStatus = 0;
    let lastError = null;
    for (const profile of order) {
      try {
        const result = await fetchOnce(url, 5, 12000, asset ? { Accept: 'text/css,*/*;q=0.1' } : {}, {}, profile.headers);
        lastStatus = result.statusCode || lastStatus;
        if (asset ? isRealAsset(result) : isRealPage(result)) {
          winner = profile;
          return { body: result.body, statusCode: result.statusCode, finalUrl: result.finalUrl || url, profile: profile.id };
        }
        // a 404 or 410 is the site's real answer, not a refusal: no other identity will find the file
        if (result.statusCode === 404 || result.statusCode === 410) { lastStatus = result.statusCode; break; }
      } catch (err) {
        lastError = err;
        // a private address, an invalid address or a timeout will not be different with another identity
        if (/private|DNS|Invalid URL|Only http|too large|Too many redirects/i.test(err.message)) throw err;
      }
    }
    if (lastStatus) throw new Error(`Server returned ${lastStatus}`);
    throw lastError || new Error('Request timed out');
  };
}

module.exports = { createPageFetcher, isRealPage, titleOfHtml, PROFILES, BLOCKED_TITLE };
