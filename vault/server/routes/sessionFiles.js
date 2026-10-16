'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { ownsSession, ownsFile } = require('../utils/ownership');

// Files attached to a chat. Both the chat and the file must be the caller's: a file's text goes into
// the chat's prompts, so attaching someone else's file would hand it over. Anything that is not theirs
// answers exactly like something that does not exist.

// GET /api/session-files/:sessionId
router.get('/:sessionId', async (req, res) => {
  try {
    if (!(await ownsSession(req.user.id, req.params.sessionId))) return res.json([]);
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

// POST /api/session-files/:sessionId — add one of the caller's files to one of the caller's chats
router.post('/:sessionId', async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'fileId required' });
  try {
    if (!(await ownsSession(req.user.id, req.params.sessionId)) || !(await ownsFile(req.user.id, fileId))) {
      return res.status(404).json({ error: 'Not found' });
    }
    await pool.query(
      `INSERT INTO session_files ("sessionId", "fileId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.sessionId, fileId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/session-files/:sessionId/:fileId — remove a file from one of the caller's chats
router.delete('/:sessionId/:fileId', async (req, res) => {
  try {
    if (!(await ownsSession(req.user.id, req.params.sessionId))) return res.status(404).json({ error: 'Not found' });
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
