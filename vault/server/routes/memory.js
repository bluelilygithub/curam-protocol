'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/memory
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM memory WHERE "userId"=$1 ORDER BY "createdAt" DESC', [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/memory
router.post('/', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO memory (content, "userId") VALUES ($1, $2) RETURNING id',
      [content.trim(), req.user.id]
    );
    const { rows: mem } = await pool.query('SELECT * FROM memory WHERE id=$1', [rows[0].id]);
    res.status(201).json(mem[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/memory/:id
router.put('/:id', async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'content required' });
  try {
    await pool.query(
      'UPDATE memory SET content=$1, "updatedAt"=NOW() WHERE id=$2 AND "userId"=$3',
      [content.trim(), req.params.id, req.user.id]
    );
    const { rows } = await pool.query('SELECT * FROM memory WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/memory/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM memory WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
