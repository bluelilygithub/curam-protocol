const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/folders
router.get('/', (req, res) => {
  const folders = db.prepare('SELECT * FROM folders ORDER BY name ASC').all();
  res.json(folders);
});

// POST /api/folders
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO folders (name) VALUES (?)').run(name.trim());
  res.status(201).json(db.prepare('SELECT * FROM folders WHERE id=?').get(result.lastInsertRowid));
});

// PUT /api/folders/:id
router.put('/:id', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name.trim(), req.params.id);
  res.json(db.prepare('SELECT * FROM folders WHERE id=?').get(req.params.id));
});

// DELETE /api/folders/:id — unassign projects first
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE projects SET folderId=NULL WHERE folderId=?').run(req.params.id);
  db.prepare('DELETE FROM folders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
