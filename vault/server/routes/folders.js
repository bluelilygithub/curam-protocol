'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/folders
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM folders ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/folders
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO folders (name) VALUES ($1) RETURNING id',
      [name.trim()]
    );
    const { rows: folder } = await pool.query('SELECT * FROM folders WHERE id=$1', [rows[0].id]);
    res.status(201).json(folder[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/folders/:id
router.put('/:id', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  try {
    await pool.query('UPDATE folders SET name=$1 WHERE id=$2', [name.trim(), req.params.id]);
    const { rows } = await pool.query('SELECT * FROM folders WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/folders/:id — unassign projects first
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE projects SET "folderId"=NULL WHERE "folderId"=$1', [req.params.id]);
    await pool.query('DELETE FROM folders WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
