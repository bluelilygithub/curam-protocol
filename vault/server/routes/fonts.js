'use strict';

/**
 * Font Customizer API. Bridges Phase 5's frontend (client/src/pages/fonts/)
 * to the Phase 1-4 Python pipeline (server/services/fonts/) via
 * fontExportPipeline.js. Stateless, dataUrl-in/dataUrl-out — same
 * convention as PDF Tools — no DB table, no persistence.
 */

const express = require('express');
const { runFontExport, runFontFetchFreeze } = require('../services/fontExportPipeline');
const { getCatalog } = require('../services/fontGoogleCatalog');
const sessionCache = require('../services/fontSessionCache');

sessionCache.startSweeper();

const router = express.Router();

// GET /api/fonts/catalog — the OFL-filtered, cached Google Fonts list for the picker's
// search/autocomplete. Search convenience only; POST /customize-export below still runs
// the real fetch/freeze/license-check against the live repo on selection, unconditionally.
router.get('/catalog', async (req, res) => {
  try {
    const catalog = await getCatalog();
    res.json(catalog);
  } catch (err) {
    console.error('Font catalog:', err);
    if (err.code === 'ENOENT') {
      return res.status(500).json({
        error: 'The font catalog builder is not available on this server (Python/fontTools not installed). The server image may still be deploying — please try again shortly.',
      });
    }
    res.status(500).json({ error: err.message || 'Could not load the font catalog.' });
  }
});

// POST /api/fonts/catalog/refresh — force-rebuild the cache now, instead of waiting out the TTL.
router.post('/catalog/refresh', async (req, res) => {
  try {
    const catalog = await getCatalog({ forceRefresh: true });
    res.json(catalog);
  } catch (err) {
    console.error('Font catalog refresh:', err);
    res.status(500).json({ error: err.message || 'Could not refresh the font catalog.' });
  }
});

// POST /api/fonts/session — { family }. Runs Phase 1 fetch+freeze ONCE
// (the slow part, ~3-4s of network I/O) and caches the resulting static
// font bytes server-side, keyed by a new session id. The single-screen
// editor calls this once when a font is selected, then hits
// /session/:id/preview repeatedly (debounced) as the designer adjusts
// sliders — each of those calls skips the fetch entirely.
router.post('/session', async (req, res) => {
  try {
    const { family } = req.body || {};
    if (!family || !family.trim()) {
      return res.status(400).json({ error: 'A Google Fonts family name is required.' });
    }

    const { fontBuffer, meta } = await runFontFetchFreeze(family);
    const sessionId = sessionCache.createSession({ fontBuffer, meta });

    res.json({ sessionId, meta, expiresInMs: sessionCache.TTL_MS });
  } catch (err) {
    console.error('Font session create:', err);
    if (err.code === 'ENOENT') {
      return res.status(500).json({
        error: 'The font pipeline is not available on this server (Python/fontTools not installed). The server image may still be deploying — please try again shortly.',
      });
    }
    if (err.code === 'FONT_EXPORT_USER_ERROR') {
      return res.status(400).json({ error: err.message, errorType: err.pythonErrorType });
    }
    res.status(500).json({ error: err.message || 'Could not fetch this font.' });
  }
});

// POST /api/fonts/session/:id/preview — { recipe, rename, rangeIds?, formats? }.
// Runs transform+export against the CACHED base font bytes (no re-fetch).
// Same endpoint serves both the fast debounced live preview (formats:
// ['ttf']) and the final download (formats: ['ttf','woff2','otf']) — the
// transform is never re-run for the download, only the requested output
// formats are (re)generated from the same cached base + same recipe.
router.post('/session/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const session = sessionCache.getSession(id);
    if (!session) {
      return res.status(404).json({
        error: 'This preview session has expired or was not found. Re-select the font to continue.',
        code: 'SESSION_EXPIRED',
      });
    }

    const { recipe, rename, rangeIds, formats } = req.body || {};
    if (!rename?.familyName) {
      return res.status(400).json({ error: 'A new family name is required for the OFL-compliant export.' });
    }

    const { outputs, report } = await runFontExport({
      fontBuffer: session.fontBuffer,
      recipe,
      rename,
      rangeIds,
      formats: formats && formats.length ? formats : ['ttf'],
    });

    const formatsOut = {};
    for (const [fmt, buf] of Object.entries(outputs)) {
      formatsOut[fmt] = `data:${MIME_BY_FORMAT[fmt] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
    }

    res.json({ formats: formatsOut, report, meta: session.meta });
  } catch (err) {
    console.error('Font session preview:', err, err.pythonTraceback || '');
    if (err.code === 'ENOENT') {
      return res.status(500).json({
        error: 'The font pipeline is not available on this server (Python/fontTools not installed). The server image may still be deploying — please try again shortly.',
      });
    }
    if (err.code === 'FONT_EXPORT_USER_ERROR') {
      return res.status(400).json({ error: err.message, errorType: err.pythonErrorType });
    }
    res.status(500).json({ error: err.message || 'Preview failed.', errorType: err.pythonErrorType });
  }
});

const MIME_BY_FORMAT = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff2: 'font/woff2',
};

function bufferFromDataUrl(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  if (comma === -1) throw new Error('Invalid font data URL.');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

// POST /api/fonts/customize-export
// body: { family?, fontDataUrl?, fontExt?, recipe, rename, rangeIds?, formats? }
// Exactly one of `family` (a Google Fonts name — Phase 1 fetches + license-checks it)
// or `fontDataUrl` (an already-loaded font, e.g. from Phase 2's file drop) is required.
router.post('/customize-export', async (req, res) => {
  try {
    const { family, fontDataUrl, fontExt, recipe, rename, rangeIds, formats } = req.body || {};

    if (!rename?.familyName) {
      return res.status(400).json({ error: 'A new family name is required for the OFL-compliant export.' });
    }
    if (!family && !fontDataUrl) {
      return res.status(400).json({ error: 'Provide either a Google Fonts family name or an uploaded font file.' });
    }
    if (family && fontDataUrl) {
      return res.status(400).json({ error: 'Provide either a Google Fonts family name or an uploaded font file, not both.' });
    }

    const fontBuffer = fontDataUrl ? bufferFromDataUrl(fontDataUrl) : undefined;

    const { outputs, report } = await runFontExport({
      family: family || undefined,
      fontBuffer,
      fontExt: fontExt || '.ttf',
      recipe,
      rename,
      rangeIds,
      formats,
    });

    const formatsOut = {};
    for (const [fmt, buf] of Object.entries(outputs)) {
      formatsOut[fmt] = `data:${MIME_BY_FORMAT[fmt] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
    }

    res.json({ formats: formatsOut, report });
  } catch (err) {
    console.error('Font customize-export:', err, err.pythonTraceback || '');

    if (err.code === 'ENOENT') {
      return res.status(500).json({
        error: 'The font export pipeline is not available on this server (Python/fontTools not installed). The server image may still be deploying — please try again shortly.',
      });
    }
    if (err.code === 'FONT_EXPORT_USER_ERROR') {
      // Bad input / license / OFL-compliance failure — the designer needs to change something, not retry blindly.
      return res.status(400).json({ error: err.message, errorType: err.pythonErrorType });
    }
    if (err.code === 'FONT_EXPORT_FAILED') {
      return res.status(500).json({ error: err.message, errorType: err.pythonErrorType });
    }
    res.status(500).json({ error: err.message || 'Font export failed.' });
  }
});

module.exports = router;
