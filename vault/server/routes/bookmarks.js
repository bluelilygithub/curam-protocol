'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { ownsSession, ownedMessage } = require('../utils/ownership');

// A bookmark carries no user of its own: it belongs to whoever owns the chat it is in (or the project
// that chat's message sits in). Every route here works only on the caller's own bookmarks; someone
// else's behave exactly like ones that do not exist.
const OWN_BOOKMARK = `(
  b."sessionId" IN (
    SELECT s."sessionId" FROM sessions s LEFT JOIN projects sp ON sp.id = s."projectId"
    WHERE s."userId" = $1 OR (s."projectId" IS NOT NULL AND sp."userId" = $1)
  )
  OR b."messageId" IN (SELECT m.id FROM messages m JOIN projects mp ON mp.id = m."projectId" WHERE mp."userId" = $1)
)`;

// GET /api/bookmarks/count — the caller's bookmark count (for badge)
router.get('/count', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM bookmarks b WHERE ${OWN_BOOKMARK}`, [req.user.id]);
    res.json({ count: Number(rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookmarks/session/:sessionId — bookmarked messageIds for one of the caller's chats
// (empty for a chat that is not theirs, the same as for one that does not exist)
router.get('/session/:sessionId', async (req, res) => {
  try {
    if (!(await ownsSession(req.user.id, req.params.sessionId))) return res.json([]);
    const { rows } = await pool.query(
      'SELECT "messageId" FROM bookmarks WHERE "sessionId"=$1',
      [req.params.sessionId]
    );
    res.json(rows.map(r => r.messageId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookmarks — the caller's bookmarks with message + session context
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
      WHERE s."deletedAt" IS NULL AND ${OWN_BOOKMARK}
      ORDER BY b."createdAt" DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookmarks/:messageId — toggle bookmark (creates or removes) on one of the caller's messages
router.post('/:messageId', async (req, res) => {
  const messageId = Number(req.params.messageId);
  const { sessionId } = req.body;
  if (!messageId || !sessionId) return res.status(400).json({ error: 'messageId and sessionId required' });

  try {
    // The message must be in a chat the caller owns. Its own chat id is used, not the one in the request body.
    const message = await ownedMessage(req.user.id, messageId);
    if (!message) return res.status(404).json({ error: 'Not found' });

    const { rows } = await pool.query('SELECT id FROM bookmarks WHERE "messageId"=$1', [messageId]);
    if (rows.length > 0) {
      await pool.query('DELETE FROM bookmarks WHERE "messageId"=$1', [messageId]);
      res.json({ bookmarked: false });
    } else {
      await pool.query(
        'INSERT INTO bookmarks ("messageId","sessionId") VALUES ($1,$2)',
        [messageId, message.sessionId]
      );
      res.json({ bookmarked: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
