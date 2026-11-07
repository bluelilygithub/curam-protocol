'use strict';

// /api/changelog — admin-only, read-only. Registered behind requireAdmin in server/index.js. See docs/changelog.md.

const express = require('express');
const router = express.Router();
const { listChangelog } = require('../services/changelog');

router.get('/', async (req, res) => {
  try {
    res.json({ entries: await listChangelog() });
  } catch (err) {
    console.error('[changelog] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
