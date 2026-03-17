'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/prompts?projectId=
router.get('/', async (req, res) => {
  const { projectId } = req.query;
  try {
    const { rows } = projectId
      ? await pool.query(
          'SELECT * FROM prompts WHERE "userId"=$1 AND ("projectId"=$2 OR "projectId" IS NULL) ORDER BY "updatedAt" DESC',
          [req.user.id, projectId]
        )
      : await pool.query('SELECT * FROM prompts WHERE "userId"=$1 ORDER BY "updatedAt" DESC', [req.user.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prompts
router.post('/', async (req, res) => {
  const { title, content, tags, projectId } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'title and content required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO prompts (title, content, tags, "projectId", "userId") VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title.trim(), content.trim(), tags || '', projectId || null, req.user.id]
    );
    const { rows: prompt } = await pool.query('SELECT * FROM prompts WHERE id=$1', [rows[0].id]);
    res.status(201).json(prompt[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/prompts/:id
router.put('/:id', async (req, res) => {
  const { title, content, tags, projectId } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT * FROM prompts WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const e = existing[0];
    await pool.query(
      'UPDATE prompts SET title=$1, content=$2, tags=$3, "projectId"=$4, "updatedAt"=NOW() WHERE id=$5 AND "userId"=$6',
      [
        title ?? e.title,
        content ?? e.content,
        tags ?? e.tags,
        projectId !== undefined ? projectId : e.projectId,
        req.params.id,
        req.user.id,
      ]
    );
    const { rows: updated } = await pool.query('SELECT * FROM prompts WHERE id=$1', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/prompts/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM prompts WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
