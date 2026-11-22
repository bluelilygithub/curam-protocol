'use strict';

const express = require('express');
const multer = require('multer');
const { pool } = require('../../db');
const { BUILTIN_THEMES, PresentationError } = require('../../services/presentations/schema');
const store = require('../../services/presentations/store');
const { themeFromPptx } = require('../../services/presentations/templates');
const { sendError } = require('./shared');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

router.get('/templates', async (req, res) => {
  try {
    res.json({
      builtins: BUILTIN_THEMES,
      themes: await store.listThemes(pool, req.user.id),
      max: store.MAX_THEMES_PER_USER,
    });
  } catch (err) { sendError(res, err, 'Themes could not be listed.'); }
});

router.post('/templates', async (req, res) => {
  try {
    const body = req.body || {};
    const theme = await store.saveTheme(pool, req.user.id, { theme: body.theme || body, name: body.name, source: 'saved' });
    res.json({ theme });
  } catch (err) { sendError(res, err, 'That theme could not be saved.'); }
});

router.post('/templates/import', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return sendError(res, err, 'That theme file could not be read.');
    return next();
  });
}, async (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new PresentationError('Choose a .pptx or .potx file first.', 400);
    if (!/\.(pptx|potx)$/i.test(String(file.originalname || ''))) throw new PresentationError('Only .pptx and .potx theme files can be imported.', 400);
    const imported = await themeFromPptx(file.buffer);
    const theme = await store.saveTheme(pool, req.user.id, {
      theme: imported, name: `${imported.label} (imported)`.slice(0, 80), source: 'import',
    });
    res.json({ theme });
  } catch (err) { sendError(res, err, 'That theme file could not be imported.'); }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const binId = await store.deleteTheme(req.user.id, req.params.id);
    if (!binId) return res.status(404).json({ error: 'That theme was not found.' });
    return res.json({ ok: true, binId });
  } catch (err) { return sendError(res, err, 'That theme could not be deleted.'); }
});

module.exports = router;
