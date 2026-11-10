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
const { normaliseHttpUrl } = require('../htmlFetch');
const { createPageFetcher } = require('./pageFetch');
const { extractStyled, rewriteCssUrls } = require('../webExtractorService');

// A WordPress page can link 30 or more style files, most of them plugins, with the theme's own files near the end (finestone.com.au: 31,
// theme from the 13th on). A limit of 12 kept the plugins and dropped the theme, so the page came out unstyled. Now 40 files and 8 MB in all,
// and when a page has more than that, the site's own files are kept ahead of plugin and library files (still applied in the page's order).
const MAX_SHEETS = 40;
const MAX_SHEET_CHARS = 1.5 * 1024 * 1024;
const MAX_TOTAL_CHARS = 8 * 1024 * 1024;
const SHEET_CONCURRENCY = 4;

/** A readable name for a fetched style file: its file name, else the site. */
function sheetName(href) {
  try {
    const u = new URL(href);
    return path.posix.basename(u.pathname) || u.hostname;
  } catch { return 'Style file'; }
}

/** How much a style file matters to the look of the page: 0 the site's own (theme) files, 1 plugin and WordPress files, 2 other sites. */
function sheetRank(href, pageUrl) {
  let u; let page;
  try { u = new URL(href); page = new URL(pageUrl); } catch { return 2; }
  const host = (h) => h.replace(/^www\./, '');
  if (host(u.hostname) !== host(page.hostname)) return 2;
  return /\/(wp-content\/plugins|wp-includes|wp-admin)\//i.test(u.pathname) ? 1 : 0;
}

/** Which style files to fetch, by position in the page: the most important first when there are too many. Kept in the page's order. */
function chooseSheets(links, pageUrl, max = MAX_SHEETS) {
  const ranked = links.map((l, i) => ({ i, rank: sheetRank(l.href, pageUrl) }));
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.slice(0, max).map((r) => r.i).sort((a, b) => a - b);
}

/** Wraps a sheet that only applies to some media; null means leave it out (print only). */
function applyMedia(css, media) {
  const m = String(media || '').trim().toLowerCase();
  if (!m || m === 'all' || m === 'screen') return css;
  if (/^print$/.test(m)) return null;
  return `@media ${m} {\n${css}\n}`;
}

/**
 * The page's HTML, by a plain fetch or (render) by a headless browser that has run the page's scripts. Shared with scrapeCss.js.
 * @returns {Promise<{raw:string, finalUrl:string, rendered:boolean, url:string}>}
 */
async function getPageHtml(rawUrl, opts = {}, deps = {}) {
  const doFetch = deps.fetchHtml || createPageFetcher();
  const url = normaliseHttpUrl(rawUrl);
  if (opts.render) {
    const render = deps.render || require('./renderPage').renderPage;
    const out = await render(url);
    return { raw: out.html, finalUrl: out.finalUrl || url, rendered: true, url };
  }
  const { body, statusCode, finalUrl } = await doFetch(url);
  if (statusCode >= 400) throw new Error(`Server returned ${statusCode}`);
  // After redirects: relative addresses in the page are relative to where it ended up, which can be another site.
  return { raw: body, finalUrl: finalUrl || url, rendered: false, url };
}

/**
 * @param {string} rawUrl
 * @param {{render?: boolean}} [opts]
 * @param {{fetchHtml?: Function, render?: Function}} [deps]  replaced in tests
 * @returns {Promise<{html:string, rawHtml:string, cssFiles:Array<{filename:string, css:string}>, flags:string[], finalUrl:string, rendered:boolean}>}
 */
async function loadPageFromUrl(rawUrl, opts = {}, deps = {}) {
  // One fetcher for the page and its style files: the identity that got the page is the one the style files are asked for with.
  const doFetch = deps.fetchHtml || createPageFetcher();
  const flags = [];
  const { raw, finalUrl, rendered } = await getPageHtml(rawUrl, opts, { ...deps, fetchHtml: doFetch });

  // Every address in the page made complete, scripts removed (the same step Web Extractor's "Exact scrape" uses).
  const absolute = extractStyled(raw, finalUrl).html;

  // Pull the linked style files out of the page; they come back as separate files.
  const dom = new JSDOM(absolute, { url: finalUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]')).map((l) => ({ href: l.href, media: l.getAttribute('media') }));
  doc.querySelectorAll('link[rel~="stylesheet"], link[rel~="preload"][as="style"]').forEach((l) => l.remove());
  const html = dom.serialize();

  const chosen = chooseSheets(links, finalUrl);
  const wanted = chosen.map((i) => links[i]);
  if (links.length > MAX_SHEETS) flags.push(`The page has ${links.length} style files; ${MAX_SHEETS} were loaded (the site's own files first), so the preview may look a little different from the live page.`);

  // Fetched most important first (so the size budget is spent on the files that matter), returned in the page's order.
  const fetchOrder = wanted.map((l, i) => ({ i, rank: sheetRank(l.href, finalUrl) })).sort((a, b) => a.rank - b.rank || a.i - b.i).map((x) => x.i);
  const results = new Array(wanted.length).fill(null);
  let next = 0;
  let failed = 0;
  let overBudget = 0;
  let totalChars = 0;
  let imports = 0;
  const worker = async () => {
    while (next < fetchOrder.length) {
      const i = fetchOrder[next++];
      try {
        const { body, statusCode } = await doFetch(wanted[i].href, { asset: true });
        if (statusCode >= 400 || String(body).length > MAX_SHEET_CHARS) throw new Error('unusable');
        if (totalChars + String(body).length > MAX_TOTAL_CHARS) { overBudget += 1; continue; }
        totalChars += String(body).length;
        if (/@import/i.test(body)) imports += (body.match(/@import/gi) || []).length;
        const css = applyMedia(rewriteCssUrls(String(body), wanted[i].href), wanted[i].media);
        if (css) results[i] = { filename: sheetName(wanted[i].href), css };
      } catch { failed += 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHEET_CONCURRENCY, wanted.length) }, worker));

  if (overBudget) flags.push(`${overBudget} of the page's style files were left out because the page's styles add up to more than ${MAX_TOTAL_CHARS / 1024 / 1024} MB.`);
  if (failed) flags.push(`${failed} of the page's style files could not be loaded (blocked, missing or too large), so the preview may look different from the live page.`);
  if (imports) flags.push('Some style files pull in other style files, which are not loaded. If the preview looks wrong, add those files yourself.');
  if (rendered) flags.push('This page was loaded in a browser that ran its scripts first. The preview is a still copy: scripts do not run in it.');

  // `rawHtml` is the page exactly as it came back (before addresses were made complete and scripts removed), for the source view.
  return { html, rawHtml: raw, cssFiles: results.filter(Boolean), flags, finalUrl, rendered };
}

module.exports = { loadPageFromUrl, getPageHtml, applyMedia, sheetName, sheetRank, chooseSheets, MAX_SHEETS };
