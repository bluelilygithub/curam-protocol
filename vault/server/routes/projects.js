'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

async function syncSearchIndex(project) {
  await pool.query(
    `DELETE FROM search_index WHERE type='project' AND "projectId"=$1`,
    [String(project.id)]
  );
  await pool.query(
    `INSERT INTO search_index(type, "projectId", title, body) VALUES ($1, $2, $3, $4)`,
    [
      'project',
      String(project.id),
      project.name || '',
      [project.goal, project.problem, project.notes].filter(Boolean).join(' '),
    ]
  );
}

// GET /api/projects
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, COUNT(DISTINCT m."sessionId") as "chatCount"
      FROM projects p
      LEFT JOIN messages m ON m."projectId" = p.id
      GROUP BY p.id
      ORDER BY p."sortOrder" ASC, p."updatedAt" DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/projects/reorder
router.patch('/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE projects SET "sortOrder"=$1 WHERE id=$2', [i, ids[i]]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /api/projects
router.post('/', async (req, res) => {
  const { name, goal, problem, audience, techStack, constraints, successCriteria, tone, notes, model, projectType, typeConfig } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO projects (name, goal, problem, audience, "techStack", constraints, "successCriteria", tone, notes, model, "projectType", "typeConfig")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [name, goal || '', problem || '', audience || '', techStack || '', constraints || '',
       successCriteria || '', tone || '', notes || '', model || 'claude-sonnet-4-6',
       projectType || null, typeConfig ? JSON.stringify(typeConfig) : null]
    );
    const { rows: project } = await pool.query('SELECT * FROM projects WHERE id=$1', [rows[0].id]);
    await syncSearchIndex(project[0]);
    res.status(201).json(project[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  const { name, goal, problem, audience, techStack, constraints, successCriteria, tone, notes, model, projectType, typeConfig, folderId } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const p = existing[0];

    await pool.query(
      `UPDATE projects SET
        name=$1, goal=$2, problem=$3, audience=$4, "techStack"=$5, constraints=$6,
        "successCriteria"=$7, tone=$8, notes=$9, model=$10, "projectType"=$11, "typeConfig"=$12,
        "folderId"=$13, "updatedAt"=NOW()
       WHERE id=$14`,
      [
        name ?? p.name,
        goal ?? p.goal,
        problem ?? p.problem,
        audience ?? p.audience,
        techStack ?? p.techStack,
        constraints ?? p.constraints,
        successCriteria ?? p.successCriteria,
        tone ?? p.tone,
        notes ?? p.notes,
        model ?? p.model ?? 'claude-sonnet-4-6',
        projectType ?? p.projectType ?? null,
        typeConfig !== undefined ? JSON.stringify(typeConfig) : (p.typeConfig ?? null),
        folderId !== undefined ? folderId : p.folderId,
        req.params.id,
      ]
    );

    const { rows: updated } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    await syncSearchIndex(updated[0]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
  const fs = require('fs');
  try {
    const { rows: existing } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    // Delete files from disk
    const { rows: files } = await pool.query('SELECT * FROM files WHERE "projectId"=$1', [req.params.id]);
    for (const file of files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }

    await pool.query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    try { await pool.query('DELETE FROM search_index WHERE "projectId"=$1', [String(req.params.id)]); } catch (e) {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
