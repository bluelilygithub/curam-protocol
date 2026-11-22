'use strict';

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../../db');
const store = require('../../services/presentations/store');
const { EXPORT_ROOT } = require('../../services/presentations/export');
const { sendError } = require('./shared');

const router = express.Router();

router.get('/decks', async (req, res) => {
  try {
    res.json({ decks: await store.listDecks(pool, req.user.id), max: store.MAX_DECKS_PER_USER });
  } catch (err) { sendError(res, err, 'Your decks could not be listed.'); }
});

router.post('/decks', async (req, res) => {
  try {
    const deck = await store.saveDeck(pool, req.user.id, req.body || {});
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That deck could not be saved.'); }
});

router.get('/decks/:id', async (req, res) => {
  try {
    const deck = await store.getDeck(pool, req.user.id, req.params.id);
    if (!deck) return res.status(404).json({ error: 'That deck was not found.' });
    return res.json({ deck });
  } catch (err) { return sendError(res, err, 'That deck could not be opened.'); }
});

router.patch('/decks/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const deck = await store.saveDeck(pool, req.user.id, { ...body, id: req.params.id });
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That deck could not be saved.'); }
});

router.post('/decks/:id/duplicate', async (req, res) => {
  try {
    const deck = await store.duplicateDeck(pool, req.user.id, req.params.id);
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That deck could not be duplicated.'); }
});

router.delete('/decks/:id', async (req, res) => {
  try {
    const binId = await store.deleteDeck(req.user.id, req.params.id);
    if (!binId) return res.status(404).json({ error: 'That deck was not found.' });
    return res.json({ ok: true, binId });
  } catch (err) { return sendError(res, err, 'That deck could not be deleted.'); }
});

router.get('/decks/:id/versions', async (req, res) => {
  try {
    res.json({ versions: await store.listVersions(pool, req.user.id, req.params.id) });
  } catch (err) { sendError(res, err, 'The versions could not be listed.'); }
});

router.post('/decks/:id/restore', async (req, res) => {
  try {
    const deck = await store.restoreVersion(pool, req.user.id, req.params.id, req.body?.versionId);
    res.json({ deck });
  } catch (err) { sendError(res, err, 'That version could not be restored.'); }
});

router.get('/decks/:id/exports', async (req, res) => {
  try {
    res.json({ exports: await store.listExports(pool, req.user.id, req.params.id) });
  } catch (err) { sendError(res, err, 'The downloads could not be listed.'); }
});

router.get('/exports/:id/file', async (req, res) => {
  try {
    const row = await store.getExportFile(pool, req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: 'That download was not found.' });
    const filePath = path.resolve(row.filePath);
    if (!filePath.startsWith(path.resolve(EXPORT_ROOT) + path.sep)) {
      return res.status(404).json({ error: 'That download is no longer on the server.' });
    }
    await fs.access(filePath);
    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    return res.download(filePath, row.fileName);
  } catch (err) {
    if (err?.code === 'ENOENT') return res.status(404).json({ error: 'That file is no longer on the server.' });
    return sendError(res, err, 'That download could not be served.');
  }
});

module.exports = router;
