'use strict';

// Public, read-only preview of a shared CSS-tool page: GET /api/shared/restyle/:token (no login). Mounted before requireAuth in
// server/index.js, like the other /api/shared routes. The token is 32 random bytes; the owner can stop sharing at any time. The page is
// served with a Content-Security-Policy that allows no scripts, whatever the saved page contains. See docs/restyle.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { buildSharedPage, SHARE_HEADERS } = require('../services/restyle/sharePage');
const { getLogger } = require('../middleware/requestContext');

const router = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

router.get('/:token', limiter, async (req, res) => {
  const token = String(req.params.token || '');
  Object.entries(SHARE_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(404).type('text/plain').send('This preview link is not valid.');
  try {
    const { rows } = await pool.query('SELECT name, html FROM restyle_projects WHERE "shareToken" = $1', [token]);
    if (!rows[0]) return res.status(404).type('text/plain').send('This preview is no longer shared.');
    const view = req.query.view === 'original' ? 'original' : 'changes';
    res.type('html').send(buildSharedPage(rows[0], { view }));
  } catch (err) {
    getLogger().error({ err }, '[restyle/shared]');
    res.status(500).type('text/plain').send('This preview could not be shown.');
  }
});

module.exports = router;
