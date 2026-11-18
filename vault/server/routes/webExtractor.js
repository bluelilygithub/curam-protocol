'use strict';

const express = require('express');
const JSZip = require('jszip');
const { runExtraction, fetchBinary } = require('../services/webExtractorService');
const { normaliseHttpUrl } = require('../services/htmlFetch');
const { generateArticlePdf, winAnsiSafe } = require('../services/webExtractorPdf');
const { getLogger } = require('../middleware/requestContext');
const { renderAvailable } = require('../services/restyle/renderPage');

const router = express.Router();

const MAX_PDF_TEXT_CHARS = 500000;
const MAX_ZIP_IMAGES = 60;
const ZIP_CONCURRENCY = 4;
const MAX_ZIP_BYTES = 150 * 1024 * 1024; // everything is held in memory while the zip is built

function safeFilename(s) {
  return String(s || 'article').replace(/[^\w\-]+/g, '-').slice(0, 60) || 'article';
}

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
};

function extFromContentType(type) {
  return EXT_BY_TYPE[String(type || '').split(';')[0].trim().toLowerCase()] || 'jpg';
}

function imageFilename(src, index, contentType) {
  let base = 'image';
  try {
    base = decodeURIComponent(new URL(src).pathname.split('/').pop() || 'image').replace(/\.[a-z0-9]+$/i, '');
  } catch { /* keep default */ }
  base = base.replace(/[^\w\-]+/g, '-').slice(0, 40) || 'image';
  return `${String(index + 1).padStart(2, '0')}-${base}.${extFromContentType(contentType)}`;
}

/** What went wrong, as an HTTP status: the person's address (400), the other website (502), or us (500). */
const REFUSED_MESSAGE = 'That website refused to give us the page (it turns away automatic visitors). If you have the page, open it in your browser, choose File, Save page as, and use the .html file in the CSS tool instead. Article content can sometimes still read the text.';

function statusFor(err) {
  const m = String((err && err.message) || '');
  if (/private|DNS|too large|Invalid URL|Only http|Invalid CSS selector/i.test(m)) return 400;
  if (/Server returned|timed out|Too many redirects|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|Not an image/i.test(m)) return 502;
  return 500;
}

/** Fetch something that must be a picture: a page or a download that says it is not an image is refused. */
async function fetchImage(src) {
  const url = normaliseHttpUrl(src);
  const got = await fetchBinary(url);
  const type = String(got.contentType || '').split(';')[0].trim().toLowerCase();
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') throw new Error('Not an image');
  return { url, ...got, contentType: type.startsWith('image/') ? type : 'application/octet-stream' };
}

const MODES = new Set(['article', 'images', 'styled', 'links', 'tables', 'metadata', 'palette']);
const MAX_SELECTOR_CHARS = 200;

// Loading a page in the real browser starts Chromium, so it is limited per person (the CSS tool keeps its own count).
const RENDERS_PER_HOUR = 12;
const renderHits = new Map(); // userId -> [timestamps]
function renderAllowed(userId) {
  const now = Date.now();
  const recent = (renderHits.get(userId) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= RENDERS_PER_HOUR) { renderHits.set(userId, recent); return false; }
  recent.push(now);
  renderHits.set(userId, recent);
  return true;
}

const SIGN_IN_REFUSED = 'The website still refused the page after signing in (it answered "not allowed"). Check the username and password, and that this account can open that page.';
const RENDERED_REFUSED = 'That website refused the page even in a real browser (it turns away automatic visitors).';

/** The password must never reach a log or an error message, whatever a library put in its text. */
function scrub(message, secret) {
  const m = String(message || '');
  return secret && secret.length >= 3 ? m.split(secret).join('***') : m;
}

router.post('/extract', async (req, res) => {
  const { url, mode, excludeSections, selector, pages, render, username, password, loginUrl } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const chosenMode = MODES.has(mode) ? mode : 'article';
  const customExcludes = Array.isArray(excludeSections)
    ? excludeSections.map((s) => String(s || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    : [];
  // Sign-in details are used for this one request and dropped: never saved, never logged.
  const pass = typeof password === 'string' ? password.slice(0, 500) : '';
  const user = typeof username === 'string' ? username.trim().slice(0, 300) : '';
  const signInPage = typeof loginUrl === 'string' ? loginUrl.trim().slice(0, 2000) : '';
  if (!pass && (user || signInPage)) return res.status(400).json({ error: 'Type the password too, or clear the sign-in boxes.' });
  const login = pass ? { username: user, password: pass, loginUrl: signInPage } : null;
  const useBrowser = !!(render || login);
  if (useBrowser && !renderAvailable()) {
    return res.status(400).json({ error: 'Loading pages in a real browser (and signing in) is not set up on this server.' });
  }
  if (useBrowser && !renderAllowed(req.user.id)) {
    return res.status(429).json({ error: `You can load ${RENDERS_PER_HOUR} pages in the real browser an hour. Untick it to read the page normally, or wait a little.` });
  }
  try {
    const cssSelector = typeof selector === 'string' ? selector.trim().slice(0, MAX_SELECTOR_CHARS) : '';
    const result = await runExtraction(url, chosenMode, customExcludes, {
      selector: cssSelector, pages: Number(pages) || 1, render: !!render, login,
    });
    res.json(result);
  } catch (err) {
    const message = scrub(err && err.message, pass);
    getLogger().error({ err: { message, name: err && err.name } }, '[web-extractor/extract]');
    const refused = /Server returned (202|401|403|406|429)\b/.test(message);
    let error = message;
    let status = statusFor({ message });
    if (/^Sign-in/.test(message)) status = 422;
    else if (/busy/i.test(message)) status = 503;
    else if (/Connection dropped/i.test(message)) status = 502;
    if (refused) error = login ? SIGN_IN_REFUSED : useBrowser ? RENDERED_REFUSED : `${REFUSED_MESSAGE} Ticking "Load with a real browser" sometimes gets in.`;
    res.status(status).json({ error });
  }
});

router.post('/pdf', async (req, res) => {
  const { title, byline, url, text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_PDF_TEXT_CHARS) {
    return res.status(413).json({ error: 'That text is too long for one PDF.' });
  }
  try {
    const body = winAnsiSafe(text);
    const buffer = await generateArticlePdf({
      title: winAnsiSafe(title).text, byline: winAnsiSafe(byline).text, url: typeof url === 'string' ? url : '', text: body.text,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(title)}.pdf"`);
    res.setHeader('X-Pdf-Replaced', String(body.replaced)); // letters the PDF font cannot draw, shown as "?"
    res.send(buffer);
  } catch (err) {
    getLogger().error({ err }, '[web-extractor/pdf]');
    res.status(500).json({ error: err.message });
  }
});

router.post('/download-image', async (req, res) => {
  const { src } = req.body || {};
  if (!src || typeof src !== 'string') {
    return res.status(400).json({ error: 'src is required' });
  }
  try {
    const { url, buffer, contentType } = await fetchImage(src);
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox'); // an SVG from a stranger must never run script if opened
    res.setHeader('Content-Disposition', `attachment; filename="${imageFilename(url, 0, contentType)}"`);
    res.send(buffer);
  } catch (err) {
    getLogger().error({ err }, '[web-extractor/download-image]');
    res.status(statusFor(err)).json({ error: err.message });
  }
});

router.post('/download-images-zip', async (req, res) => {
  const { images } = req.body || {};
  if (!Array.isArray(images) || !images.length) {
    return res.status(400).json({ error: 'images array is required' });
  }
  const capped = images.slice(0, MAX_ZIP_IMAGES);
  try {
    const zip = new JSZip();
    let totalBytes = 0;
    let failed = 0;
    let next = 0;
    // A few at a time: 60 pictures of up to 20 MB each fetched at once would exhaust the server's memory.
    const worker = async () => {
      while (next < capped.length) {
        const i = next++;
        if (totalBytes >= MAX_ZIP_BYTES) { failed += 1; continue; }
        try {
          const img = capped[i];
          const { url, buffer, contentType } = await fetchImage(String((img && img.src) || img));
          totalBytes += buffer.length;
          zip.file(imageFilename(url, i, contentType), buffer);
        } catch {
          failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ZIP_CONCURRENCY, capped.length) }, worker));
    if (failed === capped.length) {
      return res.status(502).json({ error: 'Could not download any of the images' });
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="images.zip"');
    res.setHeader('X-Images-Total', String(capped.length));
    res.setHeader('X-Images-Failed', String(failed));
    res.send(buffer);
  } catch (err) {
    getLogger().error({ err }, '[web-extractor/download-images-zip]');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
