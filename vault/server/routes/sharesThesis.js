'use strict';

// /api/shares/thesis — the Shares Thesis tab. Registered before /api/shares in server/index.js. See docs/shares-thesis.md.

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { aiLimiter } = require('../middleware/aiRateLimit');
const bin = require('../services/recycleBin');
const svc = require('../services/sharesThesis');

const idOf = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// GET /api/shares/thesis — every thesis with its latest check, plus open holdings that have none yet
router.get('/', async (req, res) => {
  try {
    res.json(await svc.listTheses(req.user.id));
  } catch (err) {
    console.error('[sharesThesis] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shares/thesis — create or replace the thesis for one holding (body: symbol, exchange, thesis, assumptions, redLines, anchors, mirror)
router.put('/', async (req, res) => {
  try {
    const { value, error } = svc.sanitizeThesisInput(req.body);
    if (error) return res.status(400).json({ error });
    res.json(await svc.saveThesis(req.user.id, value));
  } catch (err) {
    console.error('[sharesThesis] save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/thesis/:id/checks — check history, newest first
router.get('/:id/checks', async (req, res) => {
  try {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: 'bad id' });
    res.json(await svc.listChecks(req.user.id, id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/thesis/:id/check — run a check now (one model call)
router.post('/:id/check', aiLimiter, async (req, res) => {
  try {
    const id = idOf(req);
    if (!id) return res.status(400).json({ error: 'bad id' });
    res.json(await svc.runCheck(req.user.id, id));
  } catch (err) {
    console.error('[sharesThesis] check error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Check failed' });
  }
});

// DELETE /api/shares/thesis/:id — to the recycle bin with its check history (30 days)
router.delete('/:id', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM share_theses WHERE id=$1 AND "userId"=$2 FOR UPDATE', [id, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const checks = (await db.query('SELECT * FROM share_thesis_checks WHERE "thesisId"=$1 AND "userId"=$2 ORDER BY id', [id, req.user.id])).rows;
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'share-thesis', id,
      title: `${rows[0].symbol} thesis`, detail: `${checks.length} check${checks.length === 1 ? '' : 's'} · Shares`,
      payload: { thesis: rows[0], checks },
    });
    await db.query('DELETE FROM share_theses WHERE id=$1 AND "userId"=$2', [id, req.user.id]); // checks go with it (ON DELETE CASCADE)
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[sharesThesis] delete error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    db.release();
  }
});

module.exports = router;
