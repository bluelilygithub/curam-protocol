'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/bookmarks/count — total bookmark count (for badge)
router.get('/count', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS count FROM bookmarks');
    res.json({ count: Number(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookmarks/session/:sessionId — bookmarked messageIds for one session
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT "messageId" FROM bookmarks WHERE "sessionId"=$1',
      [req.params.sessionId]
    );
    res.json(rows.map(r => r.messageId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookmarks — all bookmarks with message + session context
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        b.id,
        b."messageId",
        b."sessionId",
        b."createdAt",
        m.role,
        m.content,
        m."createdAt" AS "messageCreatedAt",
        s.title AS "sessionTitle",
        s."projectId",
        p.name AS "projectName"
      FROM bookmarks b
      JOIN messages m ON m.id = b."messageId"
      JOIN sessions s ON s."sessionId" = b."sessionId"
      LEFT JOIN projects p ON p.id = s."projectId"
      ORDER BY b."createdAt" DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookmarks/:messageId — toggle bookmark (creates or removes)
router.post('/:messageId', async (req, res) => {
  const messageId = Number(req.params.messageId);
  const { sessionId } = req.body;
  if (!messageId || !sessionId) return res.status(400).json({ error: 'messageId and sessionId required' });

  try {
    const { rows } = await pool.query('SELECT id FROM bookmarks WHERE "messageId"=$1', [messageId]);
    if (rows.length > 0) {
      await pool.query('DELETE FROM bookmarks WHERE "messageId"=$1', [messageId]);
      res.json({ bookmarked: false });
    } else {
      await pool.query(
        'INSERT INTO bookmarks ("messageId","sessionId") VALUES ($1,$2)',
        [messageId, sessionId]
      );
      res.json({ bookmarked: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
