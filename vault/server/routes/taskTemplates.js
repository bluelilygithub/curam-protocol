const express = require('express');
const router = express.Router();
const db = require('../db');

function getTags(taskId) {
  return db.prepare('SELECT tag FROM task_tags WHERE taskId=?').all(taskId).map(r => r.tag);
}

function buildTemplate(row) {
  return {
    ...row,
    subtasks: db.prepare('SELECT * FROM template_subtasks WHERE templateId=? ORDER BY "order" ASC').all(row.id),
  };
}

// GET /api/task-templates
router.get('/', (req, res) => {
  try {
    const templates = db.prepare('SELECT * FROM task_templates ORDER BY updatedAt DESC').all();
    res.json(templates.map(buildTemplate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-templates
router.post('/', (req, res) => {
  try {
    const { name, description, category, priority, recurrence, tags, subtasks } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = db.prepare(
      "INSERT INTO task_templates (name,description,category,priority,recurrence,tags,updatedAt) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).run(name, description || null, category || null, priority || 'medium', recurrence || 'none', Array.isArray(tags) ? tags.join(',') : (tags || ''));
    const id = r.lastInsertRowid;
    if (Array.isArray(subtasks)) {
      subtasks.forEach((s, i) => {
        const title = typeof s === 'string' ? s : s.title;
        if (title) db.prepare('INSERT INTO template_subtasks (templateId,title,"order") VALUES (?,?,?)').run(id, title, i);
      });
    }
    res.json(buildTemplate(db.prepare('SELECT * FROM task_templates WHERE id=?').get(id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/task-templates/:id
router.put('/:id', (req, res) => {
  try {
    const tmpl = db.prepare('SELECT * FROM task_templates WHERE id=?').get(req.params.id);
    if (!tmpl) return res.status(404).json({ error: 'not found' });
    const { name, description, category, priority, recurrence, tags, subtasks } = req.body;
    db.prepare(
      "UPDATE task_templates SET name=?,description=?,category=?,priority=?,recurrence=?,tags=?,updatedAt=datetime('now') WHERE id=?"
    ).run(name || tmpl.name, description || null, category || null, priority || tmpl.priority, recurrence || tmpl.recurrence,
      Array.isArray(tags) ? tags.join(',') : (tags || ''), req.params.id);
    if (Array.isArray(subtasks)) {
      db.prepare('DELETE FROM template_subtasks WHERE templateId=?').run(req.params.id);
      subtasks.forEach((s, i) => {
        const title = typeof s === 'string' ? s : s.title;
        if (title) db.prepare('INSERT INTO template_subtasks (templateId,title,"order") VALUES (?,?,?)').run(req.params.id, title, i);
      });
    }
    res.json(buildTemplate(db.prepare('SELECT * FROM task_templates WHERE id=?').get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/task-templates/:id
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM task_templates WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/task-templates/:id/apply — creates tasks from template
router.post('/:id/apply', (req, res) => {
  try {
    const tmpl = db.prepare('SELECT * FROM task_templates WHERE id=?').get(req.params.id);
    if (!tmpl) return res.status(404).json({ error: 'not found' });
    const { projectId, category } = req.body;
    const r = db.prepare(
      "INSERT INTO tasks (title,notes,status,priority,category,projectId,recurrence,updatedAt) VALUES (?,?,'todo',?,?,?,?,datetime('now'))"
    ).run(tmpl.name, tmpl.description, tmpl.priority, category || tmpl.category, projectId || null, tmpl.recurrence);
    const taskId = r.lastInsertRowid;
    // Copy tags
    if (tmpl.tags) {
      tmpl.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
        db.prepare('INSERT INTO task_tags (taskId,tag) VALUES (?,?)').run(taskId, tag);
      });
    }
    // Copy subtasks
    const subs = db.prepare('SELECT * FROM template_subtasks WHERE templateId=? ORDER BY "order" ASC').all(tmpl.id);
    for (const sub of subs) {
      db.prepare("INSERT INTO tasks (title,status,priority,parentTaskId,updatedAt) VALUES (?,'todo','medium',?,datetime('now'))").run(sub.title, taskId);
    }
    res.json({ taskId, ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
