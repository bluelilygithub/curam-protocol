const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/personas
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM personas ORDER BY name ASC').all());
});

// POST /api/personas
router.post('/', (req, res) => {
  const { name, description, systemPrompt } = req.body;
  if (!name?.trim() || !systemPrompt?.trim()) return res.status(400).json({ error: 'name and systemPrompt required' });
  const result = db.prepare(
    'INSERT INTO personas (name, description, systemPrompt) VALUES (?, ?, ?)'
  ).run(name.trim(), description || '', systemPrompt.trim());
  res.status(201).json(db.prepare('SELECT * FROM personas WHERE id=?').get(result.lastInsertRowid));
});

// PUT /api/personas/:id
router.put('/:id', (req, res) => {
  const { name, description, systemPrompt } = req.body;
  if (!name?.trim() || !systemPrompt?.trim()) return res.status(400).json({ error: 'name and systemPrompt required' });
  db.prepare(
    "UPDATE personas SET name=?, description=?, systemPrompt=?, updatedAt=datetime('now') WHERE id=?"
  ).run(name.trim(), description || '', systemPrompt.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM personas WHERE id=?').get(req.params.id));
});

// DELETE /api/personas/:id
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE projects SET personaId=NULL WHERE personaId=?').run(req.params.id);
  db.prepare('UPDATE sessions SET personaId=NULL WHERE personaId=?').run(req.params.id);
  db.prepare('DELETE FROM personas WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
