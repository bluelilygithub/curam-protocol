'use strict';

const express = require('express');
const JSZip = require('jszip');
const { runExtraction, fetchBinary } = require('../services/webExtractorService');
const { normaliseHttpUrl } = require('../services/htmlFetch');
const { generateArticlePdf, winAnsiSafe } = require('../services/webExtractorPdf');
const { getLogger } = require('../middleware/requestContext');

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

const MODES = new Set(['article', 'images', 'styled', 'links', 'tables', 'metadata']);
const MAX_SELECTOR_CHARS = 200;

router.post('/extract', async (req, res) => {
  const { url, mode, excludeSections, selector } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const chosenMode = MODES.has(mode) ? mode : 'article';
  const customExcludes = Array.isArray(excludeSections)
    ? excludeSections.map((s) => String(s || '').trim().slice(0, 80)).filter(Boolean).slice(0, 20)
    : [];
  try {
    const cssSelector = typeof selector === 'string' ? selector.trim().slice(0, MAX_SELECTOR_CHARS) : '';
    const result = await runExtraction(url, chosenMode, customExcludes, { selector: cssSelector });
    res.json(result);
  } catch (err) {
    getLogger().error({ err }, '[web-extractor/extract]');
    res.status(statusFor(err)).json({ error: err.message });
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
