'use strict';

// Cellar Planner LITE: the public, static "play" tool (built from cellar-planner/lite.html into dist/cellar-lite/). It is files only: no login, no
// database, no API calls, no cookies. Mounted in server/index.js BEFORE helmet and requireAuth, with its own response headers, because it has to be
// embeddable in the business's own website (an iframe) while the rest of Vault must not be framed by anyone.
//
// CELLAR_LITE_FRAME_ANCESTORS: the origins allowed to embed it, space or comma separated, for example "https://www.example.com.au". Unset = only
// Vault itself can frame it (the page still opens on its own address). Only plain http(s) origins are accepted: no wildcards, no paths, nothing that
// could add a header directive. Docs: docs/cellar-planner.md ("Lite version for the public website").

const express = require('express');
const fs = require('fs');
const path = require('path');

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

/** Parse the allow-list: keep valid origins, report the rest (never put an unchecked string into a header). */
function parseFrameAncestors(raw) {
  const valid = [], rejected = [];
  for (const token of String(raw || '').split(/[\s,]+/).filter(Boolean)) (ORIGIN.test(token) ? valid : rejected).push(token.toLowerCase());
  return { valid, rejected };
}

/** The page's own Content-Security-Policy: everything from itself, nothing external, and only the named sites may frame it. */
function litePageCsp(frameAncestors) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // the tour and the drawings set inline styles
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${["'self'", ...frameAncestors].join(' ')}`,
  ].join('; ');
}

/**
 * @param {{ dir: string, frameAncestors?: string }} opts  dir = the built folder (contains index.html), frameAncestors = the raw env value
 * @returns an Express router for /cellar-lite
 */
function createCellarLiteRouter({ dir, frameAncestors = '', log = () => {} }) {
  const router = express.Router();
  const { valid, rejected } = parseFrameAncestors(frameAncestors);
  if (rejected.length) log(`[cellar-lite] ignoring invalid CELLAR_LITE_FRAME_ANCESTORS entries: ${rejected.join(' ')}`);
  const csp = litePageCsp(valid);

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET, HEAD').end();
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    // an old X-Frame-Options would stop the embed even where frame-ancestors allows it, so none is sent here
    res.removeHeader('X-Frame-Options');
    next();
  });

  router.use(express.static(dir, {
    index: 'index.html',
    redirect: true, // /cellar-lite -> /cellar-lite/ so the page's relative asset paths resolve
    fallthrough: false,
    setHeaders(res, file) {
      // the page itself is never cached (an update must show at once); the hashed files under assets/ never change
      if (path.basename(file) === 'index.html') res.set('Cache-Control', 'no-cache');
      else res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  // a missing or refused file is a plain 4xx, never Vault's own app (and never a stack trace)
  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    const status = [400, 403, 404].includes(err && (err.status || err.statusCode)) ? (err.status || err.statusCode) : 500;
    res.status(status).type('text/plain').send(status === 404 ? 'Not found' : status === 500 ? 'Server error' : 'Bad request');
  });
  return router;
}

/** Mount helper for index.js: only when the bundle has been built. */
function cellarLiteAvailable(dir) {
  try { return fs.existsSync(path.join(dir, 'index.html')); } catch { return false; }
}

module.exports = { createCellarLiteRouter, cellarLiteAvailable, parseFrameAncestors };
