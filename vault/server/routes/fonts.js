'use strict';

/**
 * Font Customizer API. Bridges Phase 5's frontend (client/src/pages/fonts/)
 * to the Phase 1-4 Python pipeline (server/services/fonts/) via
 * fontExportPipeline.js. Stateless, dataUrl-in/dataUrl-out — same
 * convention as PDF Tools — no DB table, no persistence.
 */

const express = require('express');
const { runFontExport } = require('../services/fontExportPipeline');

const router = express.Router();

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
