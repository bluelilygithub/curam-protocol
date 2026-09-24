const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { encrypt } = require('../utils/encryption');

function normaliseDomain(raw) {
  let v = String(raw || '').trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return v;
}

// List archived runs for the signed-in user — most recent first.
router.get('/runs', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, instruction, outcome, summary, "startedAt", "endedAt", jsonb_array_length(log) AS steps
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

// ── Saved site logins ───────────────────────────────────────────────────────
// Passwords are write-only from the client's point of view: list/get never
// return them, only label/domain/username + whether one is set.

router.get('/credentials', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, label, domain, username, pinned, "createdAt" FROM browser_agent_credentials
     WHERE "userId"=$1 ORDER BY pinned DESC, label ASC`,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/credentials/:id/pin', async (req, res) => {
  const pinned = !!req.body?.pinned;
  const { rows } = await pool.query(
    `UPDATE browser_agent_credentials SET pinned=$1 WHERE id=$2 AND "userId"=$3
     RETURNING id, label, domain, username, pinned, "createdAt"`,
    [pinned, req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.post('/credentials', async (req, res) => {
  const label = String(req.body?.label || '').trim();
  const domain = normaliseDomain(req.body?.domain);
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!label || !domain || !username || !password) {
    return res.status(400).json({ error: 'label, domain, username and password are all required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO browser_agent_credentials ("userId", label, domain, username, password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, label, domain, username, "createdAt"`,
    [req.user.id, label, domain, username, encrypt(password)]
  );
  res.json(rows[0]);
});

router.delete('/credentials/:id', async (req, res) => {
  const { rowCount } = await pool.query(
    `DELETE FROM browser_agent_credentials WHERE id=$1 AND "userId"=$2`,
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
