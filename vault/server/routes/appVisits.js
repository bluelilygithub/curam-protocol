'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// POST /api/app-visits { key } — the page counts one visit to a section (the nav id: 'notes', 'clients'...). Counts only, per person per day.
// Read back, for the admin, at GET /api/admin/app-usage. Never stores a path, a title or anything typed.
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/i;

router.post('/', async (req, res) => {
  const key = String((req.body && req.body.key) || '');
  if (!KEY.test(key)) return res.status(400).json({ error: 'Bad key' });
  try {
    await pool.query(
      `INSERT INTO app_visits ("userId", day, key, visits) VALUES ($1, CURRENT_DATE, $2, 1)
       ON CONFLICT ("userId", day, key) DO UPDATE SET visits = app_visits.visits + 1`,
      [req.user.id, key]
    );
    res.status(204).end();
  } catch (err) {
    console.error('[app-visits]', err.message);
    res.status(204).end(); // never bother the page over a counter
  }
});

module.exports = router;
