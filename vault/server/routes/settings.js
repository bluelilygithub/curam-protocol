'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings WHERE "userId"=$1', [req.user.id]);
    const result = {};
    rows.forEach((r) => { result[r.key] = r.value; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings  — body: { key, value }
// Set value to '' or null to delete the key
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    if (value === null || value === undefined || value === '') {
      await pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [req.user.id, key]);
    } else {
      await pool.query(
        'INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value',
        [req.user.id, key, String(value)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
