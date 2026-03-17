'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/folders
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM folders WHERE "userId"=$1 ORDER BY name ASC', [req.user.id]);
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
      'INSERT INTO folders (name, "userId") VALUES ($1, $2) RETURNING id',
      [name.trim(), req.user.id]
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
    await pool.query('UPDATE folders SET name=$1 WHERE id=$2 AND "userId"=$3', [name.trim(), req.params.id, req.user.id]);
    const { rows } = await pool.query('SELECT * FROM folders WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/folders/:id — unassign projects first
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE projects SET "folderId"=NULL WHERE "folderId"=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    await pool.query('DELETE FROM folders WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
