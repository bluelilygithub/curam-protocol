const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/notes  — list with optional ?q=search&project_id=N
router.get('/', (req, res) => {
  const userId = req.user.id;
  const { q, project_id } = req.query;

  let sql = 'SELECT * FROM notes WHERE user_id=?';
  const params = [userId];

  if (project_id) {
    sql += ' AND project_id=?';
    params.push(Number(project_id));
  }
  if (q) {
    sql += ' AND (title LIKE ? OR body LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term);
  }

  sql += ' ORDER BY updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/notes/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// POST /api/notes
router.post('/', (req, res) => {
  const { title = 'Untitled', body = '', project_id = null } = req.body;
  const result = db.prepare(
    'INSERT INTO notes (user_id, project_id, title, body) VALUES (?, ?, ?, ?)'
  ).run(req.user.id, project_id || null, title.trim() || 'Untitled', body);
  const row = db.prepare('SELECT * FROM notes WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/notes/:id
router.put('/:id', (req, res) => {
  const { title, body, project_id } = req.body;
  const existing = db.prepare('SELECT * FROM notes WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const newTitle = title !== undefined ? (title.trim() || 'Untitled') : existing.title;
  const newBody  = body  !== undefined ? body  : existing.body;
  const newProj  = project_id !== undefined ? (project_id || null) : existing.project_id;

  db.prepare(
    "UPDATE notes SET title=?, body=?, project_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?"
  ).run(newTitle, newBody, newProj, req.params.id, req.user.id);

  res.json(db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id));
});

// DELETE /api/notes/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM notes WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
