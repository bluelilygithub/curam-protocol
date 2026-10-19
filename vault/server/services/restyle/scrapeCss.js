'use strict';

// "Download a page's CSS" in the CSS tool: fetch a live page and return the style files it depends on (the ones it links, the ones those
// import, and the styles written inside the page), each with the addresses inside made complete so it works saved on its own, plus a
// summary of the design settings they set (cssSettings.js). Nothing here changes a page or runs it; the result is text for the person
// to read and download.
//
// Fetching goes through htmlFetch.js (SSRF checks, redirect limits, size caps), the same as loading a page into the editor. `render` runs
// the page in the headless browser first (renderPage.js) for pages built by script. Test: node server/services/restyle/restyleScrape.test.js

const { JSDOM, VirtualConsole } = require('jsdom');
const { createPageFetcher } = require('./pageFetch');
const { rewriteCssUrls } = require('../webExtractorService');
const { getPageHtml, sheetName } = require('./loadFromUrl');
const { summariseCss } = require('./cssSettings');

const MAX_FILES = 25;
const MAX_FILE_CHARS = 1.5 * 1024 * 1024;
const MAX_TOTAL_CHARS = 6 * 1024 * 1024;
const MAX_IMPORT_DEPTH = 2;
const CONCURRENCY = 4;
const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi;

/**
 * @param {string} rawUrl
 * @param {{render?: boolean}} [opts]
 * @param {{fetchHtml?: Function, render?: Function}} [deps]  replaced in tests
 */
async function scrapePageCss(rawUrl, opts = {}, deps = {}) {
  const doFetch = deps.fetchHtml || createPageFetcher();
  const { raw, finalUrl, rendered, url } = await getPageHtml(rawUrl, opts, { ...deps, fetchHtml: doFetch });
  const doc = new JSDOM(raw, { url: finalUrl, virtualConsole: new VirtualConsole() }).window.document;

  const flags = [];
  let failed = 0;
  let tooBig = 0;
  let total = 0;
  let embeddedCount = 0;
  const seen = new Set();

  // The page's styles in document order: linked files and <style> blocks.
  const sources = [];
  doc.querySelectorAll('link[rel~="stylesheet"][href], style').forEach((el) => {
    if (el.tagName === 'STYLE') {
      if ((el.textContent || '').trim()) sources.push({ source: 'embedded', css: el.textContent, media: el.getAttribute('media') || '' });
    } else {
      sources.push({ source: 'linked', url: el.href, media: el.getAttribute('media') || '' });
    }
  });
  const linkedTotal = sources.filter((s) => s.source === 'linked').length;
  if (linkedTotal > MAX_FILES) flags.push(`The page links ${linkedTotal} style files; only the first ${MAX_FILES} were fetched.`);

  /** Fetches one style file. Returns its text, or null (failed, too big, already fetched, or over the total). */
  const fetchText = async (fileUrl) => {
    if (seen.has(fileUrl)) return null;
    seen.add(fileUrl);
    try {
      const { body, statusCode } = await doFetch(fileUrl, { asset: true });
      if (statusCode >= 400) throw new Error('bad status');
      const text = String(body);
      if (text.length > MAX_FILE_CHARS) { tooBig += 1; return null; }
      if (total + text.length > MAX_TOTAL_CHARS) { tooBig += 1; return null; }
      total += text.length;
      return text;
    } catch {
      failed += 1;
      return null;
    }
  };

  // The linked files, a few at a time, kept in page order.
  const wantedLinked = sources.filter((s) => s.source === 'linked').slice(0, MAX_FILES);
  const texts = new Map();
  let next = 0;
  const worker = async () => {
    while (next < wantedLinked.length) {
      const item = wantedLinked[next++];
      texts.set(item, await fetchText(item.url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wantedLinked.length) }, worker));

  /** A file and, before it (as the browser would apply them), the files it imports. */
  const expand = async (file, text, depth) => {
    const out = [];
    let css = text;
    const imports = [...text.matchAll(IMPORT_RE)];
    for (const m of imports) {
      let importUrl;
      try { importUrl = new URL(m[2], file.url || finalUrl).toString(); } catch { continue; }
      if (depth >= MAX_IMPORT_DEPTH) { flags.push(`${sheetName(file.url || finalUrl)} imports more files than are followed (${MAX_IMPORT_DEPTH} levels deep).`); break; }
      if (out.length + seen.size >= MAX_FILES * 2) break;
      const importedText = await fetchText(importUrl);
      if (importedText == null) continue;
      const child = { filename: sheetName(importUrl), url: importUrl, source: 'imported', importedBy: file.filename, media: '' };
      out.push(...await expand(child, importedText, depth + 1));
      // the imported file now stands before this one, so its @import line is only a note
      css = css.replace(m[0], `/* ${m[0].replace(/\*\//g, '* /').trim()} (this file is included above) */`);
    }
    out.push({ ...file, css: rewriteCssUrls(css, file.url || finalUrl), bytes: css.length });
    return out;
  };

  const files = [];
  for (const item of sources) {
    if (item.source === 'embedded') {
      embeddedCount += 1;
      total += item.css.length;
      files.push(...await expand({ filename: `Styles inside the page${embeddedCount > 1 ? ` (${embeddedCount})` : ''}`, url: '', source: 'embedded', media: item.media }, item.css, 0));
    } else if (texts.has(item) && texts.get(item) != null) {
      files.push(...await expand({ filename: sheetName(item.url), url: item.url, source: 'linked', media: item.media }, texts.get(item), 0));
    }
  }

  if (failed) flags.push(`${failed} style file${failed === 1 ? '' : 's'} could not be fetched (blocked, missing or timed out).`);
  if (tooBig) flags.push(`${tooBig} style file${tooBig === 1 ? ' was' : 's were'} left out for being too large.`);
  if (rendered) flags.push('The page was opened in a browser that ran its scripts first, so styles added by script are included.');
  if (!files.length) flags.push('No style files were found in the page. If it builds itself with JavaScript, try again with that option ticked.');

  const summary = summariseCss(files.map((f) => f.css));
  return { url, finalUrl, rendered, title: (doc.title || '').trim(), files, summary, flags };
}

module.exports = { scrapePageCss, MAX_FILES };
