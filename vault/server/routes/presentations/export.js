'use strict';

const express = require('express');
const { pool } = require('../../db');
const { normalizeDeck, PresentationError } = require('../../services/presentations/schema');
const { getBrand, resolveThemeForUser, getDeck } = require('../../services/presentations/store');
const { exportDeck, FORMATS } = require('../../services/presentations/export');
const { startJob, getInternal } = require('../../services/presentations/jobs');
const { sendError } = require('./shared');

const router = express.Router();

router.post('/export', async (req, res) => {
  try {
    const body = req.body || {};
    const format = String(body.format || '').toLowerCase();
    if (!FORMATS.includes(format)) throw new PresentationError('Choose PPTX, PDF, PNG or HTML.', 400);
    let raw = body.deck;
    if (body.deckId) {
      const saved = await getDeck(pool, req.user.id, body.deckId);
      if (!saved) throw new PresentationError('That deck was not found.', 404);
      raw = saved.data;
    }
    const deck = normalizeDeck(raw);
    const applyBrand = body.applyBrand === true;
    const brand = await getBrand(pool, req.user.id);
    if (applyBrand && !brand.available) throw new PresentationError('There is no Graphics Brand Kit to apply yet.', 400);
    const theme = await resolveThemeForUser(pool, req.user.id, body.theme || body.themeId || deck.themeId, brand, { applyBrand });
    const input = { userId: req.user.id, deck, format, theme, brand, applyBrand };

    const job = startJob({
      userId: req.user.id,
      kind: 'export',
      input,
      runner: async ({ job: running, signal, setProgress }) => {
        const out = await exportDeck({ ...input, onProgress: setProgress });
        if (signal.aborted) return null;
        return {
          format,
          fileName: out.fileName,
          mimeType: out.mimeType,
          filePath: out.filePath,
          url: `/api/presentations/export/${running.id}/file/${format}`,
        };
      },
    });
    res.status(202).json({ jobId: job.id });
  } catch (err) { sendError(res, err, 'That export could not be started.'); }
});

router.get('/export/:id/file/:format', (req, res) => {
  const job = getInternal(req.user.id, req.params.id);
  if (!job || job.status !== 'done' || job.kind !== 'export' || !job.result) {
    return res.status(404).json({ error: 'That download is not ready.' });
  }
  if (String(req.params.format).toLowerCase() !== job.result.format || !job.result.filePath) {
    return res.status(404).json({ error: 'That file was not found.' });
  }
  return res.download(job.result.filePath, job.result.fileName, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'That file is no longer on the server.' });
  });
});

module.exports = router;
