const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/settings
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  rows.forEach((r) => { result[r.key] = r.value; });
  res.json(result);
});

// POST /api/settings  — body: { key, value }
// Set value to '' or null to delete the key
router.post('/', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  if (value === null || value === undefined || value === '') {
    db.prepare('DELETE FROM settings WHERE key=?').run(key);
  } else {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    ).run(key, String(value));
  }
  res.json({ ok: true });
});

module.exports = router;
