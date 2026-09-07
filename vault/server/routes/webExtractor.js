'use strict';

const express = require('express');
const JSZip = require('jszip');
const { runExtraction, fetchBinary } = require('../services/webExtractorService');
const { normaliseHttpUrl } = require('../services/htmlFetch');
const { generateArticlePdf } = require('../services/webExtractorPdf');

const router = express.Router();

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

const MODES = new Set(['article', 'images', 'styled']);

router.post('/extract', async (req, res) => {
  const { url, mode } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const chosenMode = MODES.has(mode) ? mode : 'article';
  try {
    const result = await runExtraction(url, chosenMode);
    res.json(result);
  } catch (err) {
    console.error('[web-extractor/extract]', err.message);
    const status = /private|DNS|too large|Invalid URL/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/pdf', async (req, res) => {
  const { title, byline, url, text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const buffer = await generateArticlePdf({ title, byline, url, text });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(title)}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error('[web-extractor/pdf]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/download-image', async (req, res) => {
  const { src } = req.body || {};
  if (!src || typeof src !== 'string') {
    return res.status(400).json({ error: 'src is required' });
  }
  try {
    const url = normaliseHttpUrl(src);
    const { buffer, contentType } = await fetchBinary(url);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${imageFilename(url, 0, contentType)}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[web-extractor/download-image]', err.message);
    const status = /private|DNS|too large|Invalid URL/i.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/download-images-zip', async (req, res) => {
  const { images } = req.body || {};
  if (!Array.isArray(images) || !images.length) {
    return res.status(400).json({ error: 'images array is required' });
  }
  const capped = images.slice(0, 60);
  try {
    const zip = new JSZip();
    const results = await Promise.allSettled(capped.map(async (img, i) => {
      const url = normaliseHttpUrl(String(img?.src || img));
      const { buffer, contentType } = await fetchBinary(url);
      zip.file(imageFilename(url, i, contentType), buffer);
    }));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === capped.length) {
      return res.status(502).json({ error: 'Could not download any of the images' });
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="images.zip"');
    res.send(buffer);
  } catch (err) {
    console.error('[web-extractor/download-images-zip]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
