'use strict';

// The recycle bin for every tool that uses it (see services/recycleBin and docs/recycle-bin.md). Mounted at /api/recycle-bin behind
// requireAuth: a person only ever sees and restores their own items.

const express = require('express');
const router = express.Router();
const { getLogger } = require('../middleware/requestContext');
const bin = require('../services/recycleBin');

bin.loadAdapters();

// ?type=note or ?types=note,note-template limits the list to some kinds of thing
const typesOf = (req) => {
  const raw = req.query.types || req.query.type;
  const list = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
};

// GET /api/recycle-bin  -> { retentionDays, items: [{ id, entityType, label, title, detail, deletedAt, expiresAt, daysLeft }] }
router.get('/', async (req, res) => {
  try {
    res.json({ retentionDays: bin.RETENTION_DAYS, items: await bin.list(req.user.id, { types: typesOf(req) }) });
  } catch (err) {
    getLogger().error({ err }, '[recycle-bin list]');
    res.status(500).json({ error: 'Could not load the recycle bin. Try again.' });
  }
});

// DELETE /api/recycle-bin  (?types=...)  -> empty the bin. Named route: before /:id.
router.delete('/', async (req, res) => {
  try {
    res.json({ removed: await bin.emptyBin(req.user.id, { types: typesOf(req) }) });
  } catch (err) {
    getLogger().error({ err }, '[recycle-bin empty]');
    res.status(500).json({ error: 'Could not empty the recycle bin. Try again.' });
  }
});

// POST /api/recycle-bin/:id/restore  -> { id, type, entityId, title }
router.post('/:id/restore', async (req, res) => {
  try {
    res.json(await bin.restoreItem(req.user.id, req.params.id));
  } catch (err) {
    if (err instanceof bin.RestoreError) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err }, '[recycle-bin restore]');
    res.status(500).json({ error: 'That item could not be restored. It is still in the recycle bin.' });
  }
});

// DELETE /api/recycle-bin/:id  -> delete one item for good
router.delete('/:id', async (req, res) => {
  try {
    if (!(await bin.deleteForever(req.user.id, req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    getLogger().error({ err }, '[recycle-bin delete]');
    res.status(500).json({ error: 'Could not delete that item. Try again.' });
  }
});

module.exports = router;
