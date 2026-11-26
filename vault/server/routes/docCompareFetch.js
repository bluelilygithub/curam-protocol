'use strict';

// DocCompare "Fetch a web page": downloads one public web page and returns its raw HTML, nothing else. All reading, extracting and
// comparing happens in the person's browser (vault/doc-compare/src/readers/html.ts); no file, draft or result ever comes here.
// Mounted at /api/doc-compare/fetch after requireAuth (logged-in users only) and behind the docCompare flag.
//
// The download goes through safeFetch.fetchPublicFile, Vault's SSRF guard: http and https only, ports 80 and 443, no login in the URL,
// every address the name resolves to must be public (no localhost, private, link-local or cloud metadata addresses), the connection is
// pinned to the checked address, every redirect is checked again (5 at most). On top of that: 5 MB at most, 10 s of silence or 20 s
// in all, and only HTML comes back. No third-party relay is ever used, so only Vault's server sees the address.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { fetchPublicFile } = require('../utils/safeFetch');

const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (compatible; CuramVault-DocCompare/1.0; checks a page the user asked for)';
const looksLikeHtml = (buf) => /<(!doctype html|html|head|body|main|article|div|p)[\s>]/i.test(buf.subarray(0, 4096).toString('latin1'));

/** `deps` (resolver, allowed addresses, ports) and smaller `limits` exist for tests only; production uses the defaults. */
function createDocCompareFetchRouter({ fetchFile = fetchPublicFile, deps, limits = {} } = {}) {
  const router = express.Router();
  router.use(rateLimit({
    windowMs: 10 * 60 * 1000,
    max: limits.maxRequests ?? 30, // per person, every 10 minutes
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: 'Too many pages fetched in a short time. Wait a few minutes and try again.' },
  }));

  router.post('/', async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'Enter the address of a web page' });
    if (url.length > 2048) return res.status(400).json({ error: 'That address is too long' });
    try {
      const { buffer, contentType, finalUrl } = await fetchFile(url, {
        maxBytes: limits.maxBytes ?? MAX_BYTES, timeoutMs: limits.timeoutMs ?? 10000, totalTimeoutMs: limits.totalTimeoutMs ?? 20000, maxRedirects: 5,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', userAgent: USER_AGENT, ...(deps ? { deps } : {}),
      });
      if (!/html|xml/i.test(contentType) && !looksLikeHtml(buffer)) {
        return res.status(415).json({ error: `That address is not a web page (${contentType.split(';')[0] || 'unknown type'})` });
      }
      res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Final-Url': finalUrl, /* URL.toString() is already ASCII */ 'X-Page-Content-Type': contentType });
      return res.send(buffer);
    } catch (err) {
      // safeFetch's own errors (status 400) are written to be shown; anything else is a network failure
      return res.status(err.status === 400 ? 400 : 502).json({ error: err.status === 400 ? err.message : 'Could not fetch that page' });
    }
  });
  return router;
}

module.exports = createDocCompareFetchRouter();
module.exports.createDocCompareFetchRouter = createDocCompareFetchRouter;
