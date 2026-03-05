const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/memory
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM memory ORDER BY createdAt DESC').all();
  res.json(rows);
});

// POST /api/memory
router.post('/', (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  const result = db.prepare('INSERT INTO memory (content) VALUES (?)').run(content.trim());
  const row = db.prepare('SELECT * FROM memory WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/memory/:id
router.put('/:id', (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  db.prepare("UPDATE memory SET content=?, updatedAt=datetime('now') WHERE id=?").run(content.trim(), req.params.id);
  const row = db.prepare('SELECT * FROM memory WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// DELETE /api/memory/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM memory WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
