'use strict';

// /api/shares/watchlist — the Shares Watchlist tab. Registered before /api/shares in server/index.js. See docs/shares-watchlist.md.

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { aiLimiter } = require('../middleware/aiRateLimit');
const bin = require('../services/recycleBin');
const svc = require('../services/sharesWatchlist');

const idOf = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const fail = (res, err, what) => {
  if (!err.status) console.error(`[sharesWatchlist] ${what} error:`, err.message);
  res.status(err.status || 500).json({ error: err.message || `${what} failed` });
};

// GET /api/shares/watchlist — watched companies with a cached quote and their latest report date
router.get('/', async (req, res) => {
  try { res.json(await svc.listWatchlist(req.user.id)); } catch (err) { fail(res, err, 'list'); }
});

// POST /api/shares/watchlist — add a company (body: symbol, exchange, name?, note?)
router.post('/', async (req, res) => {
  const { value, error } = svc.sanitizeWatchInput(req.body);
  if (error) return res.status(400).json({ error });
  try { res.json(await svc.addWatch(req.user.id, value)); } catch (err) { fail(res, err, 'add'); }
});

// PUT /api/shares/watchlist/:id — edit the name and note
router.put('/:id', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try {
    const row = await svc.updateWatch(req.user.id, id, req.body || {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) { fail(res, err, 'update'); }
});

// GET /api/shares/watchlist/:id/reports — research reports, newest first
router.get('/:id/reports', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try { res.json(await svc.listReports(req.user.id, id)); } catch (err) { fail(res, err, 'reports'); }
});

// POST /api/shares/watchlist/:id/research — run a research report now (web searches + one model call)
router.post('/:id/research', aiLimiter, async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  try { res.json(await svc.runResearch(req.user.id, id)); } catch (err) { fail(res, err, 'research'); }
});

// DELETE /api/shares/watchlist/:id — to the recycle bin with its reports (30 days)
router.delete('/:id', async (req, res) => {
  const id = idOf(req);
  if (!id) return res.status(400).json({ error: 'bad id' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM share_watchlist WHERE id=$1 AND "userId"=$2 FOR UPDATE', [id, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const reports = (await db.query('SELECT * FROM share_research_reports WHERE "watchId"=$1 AND "userId"=$2 ORDER BY id', [id, req.user.id])).rows;
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'share-watch', id,
      title: `${rows[0].symbol} (watchlist)`, detail: `${reports.length} report${reports.length === 1 ? '' : 's'} · Shares`,
      payload: { watch: rows[0], reports },
    });
    await db.query('DELETE FROM share_watchlist WHERE id=$1 AND "userId"=$2', [id, req.user.id]); // reports go with it (ON DELETE CASCADE)
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    fail(res, err, 'delete');
  } finally {
    db.release();
  }
});

module.exports = router;
