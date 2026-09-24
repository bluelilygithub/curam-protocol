const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// List archived runs for the signed-in user — most recent first.
router.get('/runs', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, instruction, outcome, summary, "startedAt", "endedAt"
     FROM browser_agent_runs WHERE "userId"=$1 ORDER BY "startedAt" DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
});

// Named route before /:id.
router.get('/runs/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM browser_agent_runs WHERE id=$1 AND "userId"=$2`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Run not found' });
  res.json(rows[0]);
});

router.delete('/runs/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM browser_agent_runs WHERE id=$1 AND "userId"=$2`,
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Run not found' });
  res.json({ ok: true });
});

// Bulk delete — the Archive view's multi-select checkboxes.
router.post('/runs/delete', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const { rowCount } = await pool.query(
    `DELETE FROM browser_agent_runs WHERE id = ANY($1) AND "userId"=$2`,
    [ids, req.user.id]
  );
  res.json({ ok: true, deleted: rowCount });
});

module.exports = router;
