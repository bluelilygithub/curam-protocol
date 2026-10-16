'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/notes  — list with optional ?q=search&project_id=N
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const { q, project_id } = req.query;

  let sql = 'SELECT * FROM notes WHERE user_id=$1';
  const params = [userId];
  let idx = 2;

  if (project_id) {
    sql += ` AND project_id=$${idx++}`;
    params.push(Number(project_id));
  }
  if (q) {
    const term = `%${q}%`;
    sql += ` AND (title ILIKE $${idx} OR body ILIKE $${idx + 1})`;
    idx += 2;
    params.push(term, term);
  }

  sql += ' ORDER BY updated_at DESC';
  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A note's client_id has no foreign key (see db.js), so check here that the client exists
// and belongs to the caller. Returns true when fine; otherwise sends the 400 and returns false.
async function clientIdIsOwned(clientId, userId, res) {
  if (clientId == null || clientId === '') return true;
  const { rows } = await pool.query('SELECT 1 FROM clients WHERE id=$1 AND "userId"=$2', [Number(clientId) || 0, userId]);
  if (!rows.length) { res.status(400).json({ error: 'client_id does not match one of your clients' }); return false; }
  return true;
}

// POST /api/notes
router.post('/', async (req, res) => {
  const { title = 'Untitled', body = '', project_id = null, client_id = null } = req.body;
  try {
    if (!(await clientIdIsOwned(client_id, req.user.id, res))) return;
    const { rows } = await pool.query(
      'INSERT INTO notes (user_id, project_id, client_id, title, body) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [req.user.id, project_id || null, client_id || null, title.trim() || 'Untitled', body]
    );
    const { rows: note } = await pool.query('SELECT * FROM notes WHERE id=$1', [rows[0].id]);
    res.status(201).json(note[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notes/:id
router.put('/:id', async (req, res) => {
  const { title, body, project_id, client_id } = req.body;
  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM notes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const e = existing[0];
    if (client_id !== undefined && !(await clientIdIsOwned(client_id, req.user.id, res))) return;

    const newTitle = title !== undefined ? (title.trim() || 'Untitled') : e.title;
    const newBody  = body  !== undefined ? body  : e.body;
    const newProj  = project_id !== undefined ? (project_id || null) : e.project_id;
    // Older screens never send client_id, so an absent value keeps whatever is stored.
    const newClient = client_id !== undefined ? (client_id || null) : e.client_id;

    await pool.query(
      'UPDATE notes SET title=$1, body=$2, project_id=$3, client_id=$4, updated_at=NOW() WHERE id=$5 AND user_id=$6',
      [newTitle, newBody, newProj, newClient, req.params.id, req.user.id]
    );

    const { rows: updated } = await pool.query('SELECT * FROM notes WHERE id=$1', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM notes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
