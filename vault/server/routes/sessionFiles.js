'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/session-files/:sessionId
router.get('/:sessionId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.mimetype, f.size
       FROM session_files sf
       JOIN files f ON f.id = sf."fileId"
       WHERE sf."sessionId" = $1`,
      [req.params.sessionId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/session-files/:sessionId — add a file to the session
router.post('/:sessionId', async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'fileId required' });
  try {
    await pool.query(
      `INSERT INTO session_files ("sessionId", "fileId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.sessionId, fileId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/session-files/:sessionId/:fileId — remove a file from the session
router.delete('/:sessionId/:fileId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM session_files WHERE "sessionId" = $1 AND "fileId" = $2`,
      [req.params.sessionId, req.params.fileId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
