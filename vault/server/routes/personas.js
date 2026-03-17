'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/personas
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM personas WHERE "userId"=$1 ORDER BY name ASC', [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personas
router.post('/', async (req, res) => {
  const { name, description, systemPrompt } = req.body;
  if (!name?.trim() || !systemPrompt?.trim()) return res.status(400).json({ error: 'name and systemPrompt required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO personas (name, description, "systemPrompt", "userId") VALUES ($1, $2, $3, $4) RETURNING id',
      [name.trim(), description || '', systemPrompt.trim(), req.user.id]
    );
    const { rows: persona } = await pool.query('SELECT * FROM personas WHERE id=$1', [rows[0].id]);
    res.status(201).json(persona[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/personas/:id
router.put('/:id', async (req, res) => {
  const { name, description, systemPrompt } = req.body;
  if (!name?.trim() || !systemPrompt?.trim()) return res.status(400).json({ error: 'name and systemPrompt required' });
  try {
    await pool.query(
      'UPDATE personas SET name=$1, description=$2, "systemPrompt"=$3, "updatedAt"=NOW() WHERE id=$4 AND "userId"=$5',
      [name.trim(), description || '', systemPrompt.trim(), req.params.id, req.user.id]
    );
    const { rows } = await pool.query('SELECT * FROM personas WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/personas/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE projects SET "personaId"=NULL WHERE "personaId"=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    await pool.query('UPDATE sessions SET "personaId"=NULL WHERE "personaId"=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    await pool.query('DELETE FROM personas WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
