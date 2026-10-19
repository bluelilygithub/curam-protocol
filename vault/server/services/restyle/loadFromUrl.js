'use strict';

// Loads a live page by its web address for the CSS tool: the page's HTML, with every address made complete, and its linked style files
// fetched and returned beside it (the tool's preview cannot load files from other sites itself: Vault's Content-Security-Policy only
// allows its own, data: and blob: sources, which is also why pictures are inlined, see inlineImages.js).
//
// Two ways to get the HTML: a plain fetch (default) or a headless browser that runs the page's scripts first (renderPage.js, opt-in).
// Everything is fetched through htmlFetch.js, so the same SSRF checks, redirect limits and size caps as the other URL tools apply.
// Test: node server/services/restyle/restyleLoad.test.js

const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { fetchHtml, normaliseHttpUrl } = require('../htmlFetch');
const { extractStyled, rewriteCssUrls } = require('../webExtractorService');

const MAX_SHEETS = 12;
const MAX_SHEET_CHARS = 1.5 * 1024 * 1024;
const SHEET_CONCURRENCY = 4;

/** A readable name for a fetched style file: its file name, else the site. */
function sheetName(href) {
  try {
    const u = new URL(href);
    return path.posix.basename(u.pathname) || u.hostname;
  } catch { return 'Style file'; }
}

/** Wraps a sheet that only applies to some media; null means leave it out (print only). */
function applyMedia(css, media) {
  const m = String(media || '').trim().toLowerCase();
  if (!m || m === 'all' || m === 'screen') return css;
  if (/^print$/.test(m)) return null;
  return `@media ${m} {\n${css}\n}`;
}

/**
 * @param {string} rawUrl
 * @param {{render?: boolean}} [opts]
 * @param {{fetchHtml?: Function, render?: Function}} [deps]  replaced in tests
 * @returns {Promise<{html:string, cssFiles:Array<{filename:string, css:string}>, flags:string[], finalUrl:string, rendered:boolean}>}
 */
async function loadPageFromUrl(rawUrl, opts = {}, deps = {}) {
  const doFetch = deps.fetchHtml || fetchHtml;
  const url = normaliseHttpUrl(rawUrl);
  const flags = [];

  let raw; let finalUrl = url; let rendered = false;
  if (opts.render) {
    const render = deps.render || require('./renderPage').renderPage;
    const out = await render(url);
    raw = out.html; finalUrl = out.finalUrl || url; rendered = true;
  } else {
    const { body, statusCode } = await doFetch(url);
    if (statusCode >= 400) throw new Error(`Server returned ${statusCode}`);
    raw = body;
  }

  // Every address in the page made complete, scripts removed (the same step Web Extractor's "Exact scrape" uses).
  const absolute = extractStyled(raw, finalUrl).html;

  // Pull the linked style files out of the page; they come back as separate files.
  const dom = new JSDOM(absolute, { url: finalUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]')).map((l) => ({ href: l.href, media: l.getAttribute('media') }));
  doc.querySelectorAll('link[rel~="stylesheet"], link[rel~="preload"][as="style"]').forEach((l) => l.remove());
  const html = dom.serialize();

  const wanted = links.slice(0, MAX_SHEETS);
  if (links.length > MAX_SHEETS) flags.push(`The page has ${links.length} style files; only the first ${MAX_SHEETS} were loaded.`);

  const results = new Array(wanted.length).fill(null);
  let next = 0;
  let failed = 0;
  let imports = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const i = next++;
      try {
        const { body, statusCode } = await doFetch(wanted[i].href);
        if (statusCode >= 400 || String(body).length > MAX_SHEET_CHARS) throw new Error('unusable');
        if (/@import/i.test(body)) imports += (body.match(/@import/gi) || []).length;
        const css = applyMedia(rewriteCssUrls(String(body), wanted[i].href), wanted[i].media);
        if (css) results[i] = { filename: sheetName(wanted[i].href), css };
      } catch { failed += 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHEET_CONCURRENCY, wanted.length) }, worker));

  if (failed) flags.push(`${failed} of the page's style files could not be loaded (blocked, missing or too large), so the preview may look different from the live page.`);
  if (imports) flags.push('Some style files pull in other style files, which are not loaded. If the preview looks wrong, add those files yourself.');
  if (rendered) flags.push('This page was loaded in a browser that ran its scripts first. The preview is a still copy: scripts do not run in it.');

  return { html, cssFiles: results.filter(Boolean), flags, finalUrl, rendered };
}

module.exports = { loadPageFromUrl, applyMedia, sheetName };
