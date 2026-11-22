'use strict';

const express = require('express');
const fs = require('fs/promises');
const { pool } = require('../../db');
const { normalizeDeck, PresentationError } = require('../../services/presentations/schema');
const store = require('../../services/presentations/store');
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
      const saved = await store.getDeck(pool, req.user.id, body.deckId);
      if (!saved) throw new PresentationError('That deck was not found.', 404);
      raw = saved.data;
    }
    const deck = normalizeDeck(raw);
    const applyBrand = body.applyBrand === true;
    const brand = await store.getBrand(pool, req.user.id);
    if (applyBrand && !brand.available) throw new PresentationError('There is no Graphics Brand Kit to apply yet.', 400);
    const theme = await store.resolveThemeForUser(pool, req.user.id, body.theme || body.themeId || deck.themeId, brand, { applyBrand });
    const font = applyBrand ? await store.getBrandFont(pool, req.user.id, brand) : null;
    const input = { userId: req.user.id, deck, format, theme, brand, applyBrand, font, deckId: body.deckId ? Number(body.deckId) || null : null };

    const job = startJob({
      userId: req.user.id,
      kind: 'export',
      input,
      runner: async ({ signal, setProgress }) => {
        const out = await exportDeck({ ...input, onProgress: setProgress });
        if (signal.aborted) return null;
        const bytes = await fs.stat(out.filePath).then((s) => s.size).catch(() => 0);
        const saved = await store.saveExport(pool, req.user.id, {
          deckId: input.deckId, format: out.format, fileName: out.fileName, mimeType: out.mimeType,
          filePath: out.filePath, bytes,
        });
        return {
          format,
          fileName: out.fileName,
          mimeType: out.mimeType,
          exportId: saved.id,
          url: `/api/presentations/exports/${saved.id}/file`,
        };
      },
    });
    res.status(202).json({ jobId: job.id });
  } catch (err) { sendError(res, err, 'That export could not be started.'); }
});

// Kept for links made before downloads were stored in the database.
router.get('/export/:id/file/:format', async (req, res) => {
  const job = getInternal(req.user.id, req.params.id);
  if (!job || job.status !== 'done' || job.kind !== 'export' || !job.result) {
    return res.status(404).json({ error: 'That download is not ready.' });
  }
  if (String(req.params.format).toLowerCase() !== job.result.format) {
    return res.status(404).json({ error: 'That file was not found.' });
  }
  if (job.result.exportId) {
    const row = await store.getExportFile(pool, req.user.id, job.result.exportId);
    if (!row) return res.status(404).json({ error: 'That download has expired.' });
    return res.download(row.filePath, row.fileName, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'That file is no longer on the server.' });
    });
  }
  return res.status(404).json({ error: 'That download has expired.' });
});

module.exports = router;
