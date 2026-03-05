const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/prompts?projectId=
router.get('/', (req, res) => {
  const { projectId } = req.query;
  const rows = projectId
    ? db.prepare('SELECT * FROM prompts WHERE projectId=? OR projectId IS NULL ORDER BY updatedAt DESC').all(projectId)
    : db.prepare('SELECT * FROM prompts ORDER BY updatedAt DESC').all();
  res.json(rows);
});

// POST /api/prompts
router.post('/', (req, res) => {
  const { title, content, tags, projectId } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'title and content required' });
  const result = db.prepare(
    'INSERT INTO prompts (title, content, tags, projectId) VALUES (?, ?, ?, ?)'
  ).run(title.trim(), content.trim(), tags || '', projectId || null);
  res.status(201).json(db.prepare('SELECT * FROM prompts WHERE id=?').get(result.lastInsertRowid));
});

// PUT /api/prompts/:id
router.put('/:id', (req, res) => {
  const { title, content, tags, projectId } = req.body;
  const existing = db.prepare('SELECT * FROM prompts WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE prompts SET title=?, content=?, tags=?, projectId=?, updatedAt=datetime('now') WHERE id=?").run(
    title ?? existing.title,
    content ?? existing.content,
    tags ?? existing.tags,
    projectId !== undefined ? projectId : existing.projectId,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM prompts WHERE id=?').get(req.params.id));
});

// DELETE /api/prompts/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM prompts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
