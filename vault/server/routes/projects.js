const express = require('express');
const router = express.Router();
const db = require('../db');

function syncSearchIndex(project) {
  db.prepare(`DELETE FROM search_index WHERE type='project' AND projectId=?`).run(String(project.id));
  db.prepare(`INSERT INTO search_index(type, projectId, title, body) VALUES (?, ?, ?, ?)`).run(
    'project',
    String(project.id),
    project.name || '',
    [project.goal, project.problem, project.notes].filter(Boolean).join(' ')
  );
}

// GET /api/projects
router.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, COUNT(DISTINCT m.sessionId) as chatCount
    FROM projects p
    LEFT JOIN messages m ON m.projectId = p.id
    GROUP BY p.id
    ORDER BY p.sortOrder ASC, p.updatedAt DESC
  `).all();
  res.json(projects);
});

// PATCH /api/projects/reorder
router.patch('/reorder', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const update = db.prepare('UPDATE projects SET sortOrder=? WHERE id=?');
  const updateAll = db.transaction((ids) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  updateAll(ids);
  res.json({ ok: true });
});

// POST /api/projects
router.post('/', (req, res) => {
  const { name, goal, problem, audience, techStack, constraints, successCriteria, tone, notes, model, projectType, typeConfig } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO projects (name, goal, problem, audience, techStack, constraints, successCriteria, tone, notes, model, projectType, typeConfig)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, goal || '', problem || '', audience || '', techStack || '', constraints || '', successCriteria || '', tone || '', notes || '', model || 'claude-sonnet-4-6', projectType || null, typeConfig ? JSON.stringify(typeConfig) : null);

  const project = db.prepare(`SELECT * FROM projects WHERE id=?`).get(result.lastInsertRowid);
  syncSearchIndex(project);
  res.status(201).json(project);
});

// GET /api/projects/:id
router.get('/:id', (req, res) => {
  const project = db.prepare(`SELECT * FROM projects WHERE id=?`).get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

// PUT /api/projects/:id
router.put('/:id', (req, res) => {
  const { name, goal, problem, audience, techStack, constraints, successCriteria, tone, notes, model, projectType, typeConfig } = req.body;
  const project = db.prepare(`SELECT * FROM projects WHERE id=?`).get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE projects SET
      name=?, goal=?, problem=?, audience=?, techStack=?, constraints=?,
      successCriteria=?, tone=?, notes=?, model=?, projectType=?, typeConfig=?, updatedAt=datetime('now')
    WHERE id=?
  `).run(
    name ?? project.name,
    goal ?? project.goal,
    problem ?? project.problem,
    audience ?? project.audience,
    techStack ?? project.techStack,
    constraints ?? project.constraints,
    successCriteria ?? project.successCriteria,
    tone ?? project.tone,
    notes ?? project.notes,
    model ?? project.model ?? 'claude-sonnet-4-6',
    projectType ?? project.projectType ?? null,
    typeConfig !== undefined ? JSON.stringify(typeConfig) : (project.typeConfig ?? null),
    req.params.id
  );

  const updated = db.prepare(`SELECT * FROM projects WHERE id=?`).get(req.params.id);
  syncSearchIndex(updated);
  res.json(updated);
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const project = db.prepare(`SELECT * FROM projects WHERE id=?`).get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });

  // Delete files from disk
  const fs = require('fs');
  const path = require('path');
  const files = db.prepare(`SELECT * FROM files WHERE projectId=?`).all(req.params.id);
  for (const file of files) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }

  db.prepare(`DELETE FROM projects WHERE id=?`).run(req.params.id);
  try { db.prepare(`DELETE FROM search_index WHERE projectId=?`).run(String(req.params.id)); } catch (e) {}
  res.json({ ok: true });
});

module.exports = router;
