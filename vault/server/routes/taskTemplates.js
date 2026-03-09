'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

async function getTags(taskId) {
  const { rows } = await pool.query('SELECT tag FROM task_tags WHERE "taskId"=$1', [taskId]);
  return rows.map(r => r.tag);
}

async function buildTemplate(row) {
  const { rows: subtasks } = await pool.query(
    'SELECT * FROM template_subtasks WHERE "templateId"=$1 ORDER BY "order" ASC',
    [row.id]
  );
  return { ...row, subtasks };
}

// GET /api/task-templates
router.get('/', async (req, res) => {
  try {
    const { rows: templates } = await pool.query('SELECT * FROM task_templates ORDER BY "updatedAt" DESC');
    res.json(await Promise.all(templates.map(buildTemplate)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-templates
router.post('/', async (req, res) => {
  try {
    const { name, description, category, priority, recurrence, tags, subtasks } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await pool.query(
      `INSERT INTO task_templates (name,description,category,priority,recurrence,tags,"updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id`,
      [name, description || null, category || null, priority || 'medium', recurrence || 'none',
       Array.isArray(tags) ? tags.join(',') : (tags || '')]
    );
    const id = rows[0].id;
    if (Array.isArray(subtasks)) {
      for (let i = 0; i < subtasks.length; i++) {
        const title = typeof subtasks[i] === 'string' ? subtasks[i] : subtasks[i].title;
        if (title) await pool.query(
          'INSERT INTO template_subtasks ("templateId",title,"order") VALUES ($1,$2,$3)',
          [id, title, i]
        );
      }
    }
    const { rows: tmpl } = await pool.query('SELECT * FROM task_templates WHERE id=$1', [id]);
    res.json(await buildTemplate(tmpl[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/task-templates/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM task_templates WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'not found' });
    const tmpl = existing[0];
    const { name, description, category, priority, recurrence, tags, subtasks } = req.body;
    await pool.query(
      `UPDATE task_templates SET name=$1,description=$2,category=$3,priority=$4,recurrence=$5,tags=$6,"updatedAt"=NOW() WHERE id=$7`,
      [name || tmpl.name, description || null, category || null, priority || tmpl.priority,
       recurrence || tmpl.recurrence, Array.isArray(tags) ? tags.join(',') : (tags || ''), req.params.id]
    );
    if (Array.isArray(subtasks)) {
      await pool.query('DELETE FROM template_subtasks WHERE "templateId"=$1', [req.params.id]);
      for (let i = 0; i < subtasks.length; i++) {
        const title = typeof subtasks[i] === 'string' ? subtasks[i] : subtasks[i].title;
        if (title) await pool.query(
          'INSERT INTO template_subtasks ("templateId",title,"order") VALUES ($1,$2,$3)',
          [req.params.id, title, i]
        );
      }
    }
    const { rows: updated } = await pool.query('SELECT * FROM task_templates WHERE id=$1', [req.params.id]);
    res.json(await buildTemplate(updated[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/task-templates/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM task_templates WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-templates/:id/apply — creates tasks from template
router.post('/:id/apply', async (req, res) => {
  try {
    const { rows: tmpls } = await pool.query('SELECT * FROM task_templates WHERE id=$1', [req.params.id]);
    if (!tmpls[0]) return res.status(404).json({ error: 'not found' });
    const tmpl = tmpls[0];
    const { projectId, category } = req.body;

    const { rows: taskRows } = await pool.query(
      `INSERT INTO tasks (title,notes,status,priority,category,"projectId",recurrence,"updatedAt")
       VALUES ($1,$2,'todo',$3,$4,$5,$6,NOW()) RETURNING id`,
      [tmpl.name, tmpl.description, tmpl.priority, category || tmpl.category, projectId || null, tmpl.recurrence]
    );
    const taskId = taskRows[0].id;

    // Copy tags
    if (tmpl.tags) {
      for (const tag of tmpl.tags.split(',').map(t => t.trim()).filter(Boolean)) {
        await pool.query('INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2)', [taskId, tag]);
      }
    }
    // Copy subtasks
    const { rows: subs } = await pool.query(
      'SELECT * FROM template_subtasks WHERE "templateId"=$1 ORDER BY "order" ASC',
      [tmpl.id]
    );
    for (const sub of subs) {
      await pool.query(
        `INSERT INTO tasks (title,status,priority,"parentTaskId","updatedAt") VALUES ($1,'todo','medium',$2,NOW())`,
        [sub.title, taskId]
      );
    }
    res.json({ taskId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
