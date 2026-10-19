'use strict';

// Turns a fetched page into one that shows properly inside Vault, with nothing left to load from elsewhere: every address made complete,
// scripts removed, each linked style file fetched and placed where its <link> was (as a <style>, in the same order, wrapped in @media for
// files meant for some screens only), and pictures copied in as data: URIs (Vault's Content-Security-Policy only lets a preview load its
// own, data: and blob: pictures, so a page that merely points at its pictures shows them as empty boxes). Used by the Web Extractor's
// "Exact scrape". Test: node server/services/restyle/restyleSelfContained.test.js

const { JSDOM, VirtualConsole } = require('jsdom');
const { extractStyled, rewriteCssUrls } = require('../webExtractorService');
const { applyMedia } = require('./loadFromUrl');
const inlineImages = require('./inlineImages');

const MAX_SHEETS = 12;
const MAX_SHEET_CHARS = 1.5 * 1024 * 1024;
const CONCURRENCY = 4;

/**
 * @param {string} rawHtml  the page as fetched
 * @param {string} pageUrl  where it was fetched from (after redirects)
 * @param {{fetcher: Function, inlineFragment?: Function}} deps  `fetcher(url, {asset})` is a pageFetch fetcher; the picture step can be replaced in tests
 * @returns {Promise<{html:string, cssInlined:number, cssFailed:number, imagesInlined:number, imagesFailed:number}>}
 */
async function buildSelfContainedPage(rawHtml, pageUrl, deps) {
  const inlineFragment = deps.inlineFragment || inlineImages.inlineImagesInHtmlFragment;
  const doc = new JSDOM(extractStyled(rawHtml, pageUrl).html, { url: pageUrl, virtualConsole: new VirtualConsole() }).window.document;

  // 1. each linked style file becomes a <style> in the same place, so the order of the cascade is the page's own
  const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]')).slice(0, MAX_SHEETS);
  const texts = new Array(links.length).fill(null);
  let next = 0;
  let cssFailed = 0;
  const worker = async () => {
    while (next < links.length) {
      const i = next++;
      try {
        const { body } = await deps.fetcher(links[i].href, { asset: true });
        if (String(body).length > MAX_SHEET_CHARS) throw new Error('too big');
        texts[i] = String(body);
      } catch { cssFailed += 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, links.length) }, worker));
  let cssInlined = 0;
  links.forEach((link, i) => {
    if (texts[i] == null) return; // left as a link: a browser may still be able to load it
    const css = applyMedia(rewriteCssUrls(texts[i], link.href), link.getAttribute('media'));
    if (css === null) { link.remove(); return; } // print only
    const style = doc.createElement('style');
    style.setAttribute('data-from', link.href);
    style.textContent = css;
    link.replaceWith(style);
    cssInlined += 1;
  });
  doc.querySelectorAll('link[rel~="preload"], link[rel~="prefetch"], link[rel~="modulepreload"]').forEach((l) => l.remove());

  // 2. pictures (the <img> tags, inline backgrounds, and url(...) inside every <style>, including the ones just made)
  const [head, body] = await Promise.all([inlineFragment(doc.head.innerHTML, pageUrl), inlineFragment(doc.body.innerHTML, pageUrl)]);
  doc.head.innerHTML = head.html;
  doc.body.innerHTML = body.html;

  return {
    html: `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
    cssInlined,
    cssFailed,
    imagesInlined: head.inlinedCount + body.inlinedCount,
    imagesFailed: head.failedCount + body.failedCount,
  };
}

module.exports = { buildSelfContainedPage };
