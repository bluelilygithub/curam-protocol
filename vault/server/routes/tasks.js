const express = require('express');
const router = express.Router();
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function getTags(taskId) {
  return db.prepare('SELECT tag FROM task_tags WHERE taskId=?').all(taskId).map(r => r.tag);
}

function getSubtaskStats(taskId) {
  const subs = db.prepare('SELECT status FROM tasks WHERE parentTaskId=?').all(taskId);
  return { subtaskCount: subs.length, subtaskDone: subs.filter(s => s.status === 'done').length };
}

function buildTask(row) {
  return { ...row, tags: getTags(row.id), ...getSubtaskStats(row.id) };
}

function calculateNextDate(dateStr, recurrence) {
  const d = new Date(dateStr + 'T00:00:00Z');
  switch (recurrence) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'fortnightly': d.setUTCDate(d.getUTCDate() + 14); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'annually': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: return null;
  }
  return d.toISOString().slice(0, 10);
}

// GET /api/tasks — top-level tasks with optional filters
router.get('/', (req, res) => {
  try {
    const { status, priority, category, projectId, tag, dueBefore, dueAfter, search } = req.query;
    let sql = 'SELECT * FROM tasks WHERE parentTaskId IS NULL';
    const p = [];
    if (status) { sql += ' AND status=?'; p.push(status); }
    if (priority) { sql += ' AND priority=?'; p.push(priority); }
    if (category) { sql += ' AND category=?'; p.push(category); }
    if (projectId) { sql += ' AND projectId=?'; p.push(Number(projectId)); }
    if (dueBefore) { sql += ' AND dueDate<=?'; p.push(dueBefore); }
    if (dueAfter) { sql += ' AND dueDate>=?'; p.push(dueAfter); }
    if (search) { sql += ' AND (title LIKE ? OR notes LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
    if (tag) { sql += ' AND id IN (SELECT taskId FROM task_tags WHERE tag=?)'; p.push(tag); }
    sql += ' ORDER BY "order" ASC, CASE priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, dueDate ASC, createdAt DESC';
    res.json(db.prepare(sql).all(...p).map(buildTask));
  } catch (err) {
    console.error('[tasks GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/subtasks
router.get('/:id/subtasks', (req, res) => {
  try {
    const subs = db.prepare('SELECT * FROM tasks WHERE parentTaskId=? ORDER BY createdAt ASC').all(req.params.id);
    res.json(subs.map(buildTask));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/reorder — must be before /:id to avoid route conflict
router.put('/reorder', (req, res) => {
  try {
    const { items } = req.body; // [{ id, order }]
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
    const update = db.prepare('UPDATE tasks SET "order"=?, updatedAt=datetime(\'now\') WHERE id=?');
    const transaction = db.transaction((items) => {
      for (const { id, order } of items) update.run(order, id);
    });
    transaction(items);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks reorder]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/bulk — bulk update — must be before /:id to avoid route conflict
router.put('/bulk', (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const allowed = ['status', 'priority', 'category'];
    const sets = allowed.filter(k => k in updates);
    if (sets.length === 0) return res.status(400).json({ error: 'no valid update fields' });
    const setClauses = sets.map(k => `${k}=?`).join(', ');
    const values = sets.map(k => updates[k]);
    const stmt = db.prepare(`UPDATE tasks SET ${setClauses}, updatedAt=datetime('now') WHERE id=?`);
    const tx = db.transaction((ids) => { for (const id of ids) stmt.run(...values, id); });
    tx(ids);
    res.json({ ok: true, updated: ids.length });
  } catch (err) {
    console.error('[tasks bulk update]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/bulk — bulk delete — must be before /:id to avoid route conflict
router.delete('/bulk', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const del = db.prepare('DELETE FROM tasks WHERE id=?');
    const delSubs = db.prepare('DELETE FROM tasks WHERE parentTaskId=?');
    const tx = db.transaction((ids) => { for (const id of ids) { delSubs.run(id); del.run(id); } });
    tx(ids);
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    console.error('[tasks bulk delete]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/extract — extract tasks from a chat session — must be before /:id routes
router.post('/extract', async (req, res) => {
  try {
    const { sessionId, projectId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const messages = db.prepare(
      'SELECT role, content FROM messages WHERE sessionId=? ORDER BY createdAt DESC LIMIT 20'
    ).all(sessionId).reverse();
    if (messages.length === 0) return res.status(400).json({ error: 'no messages found' });
    const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: 'You are a task extraction assistant. Read this conversation and extract all action items, next steps, and tasks mentioned. Return ONLY a valid JSON array of task objects with fields: title, priority (high/medium/low), category, dueDate (ISO string or null), notes. No other text.',
      messages: [{ role: 'user', content: conversation }],
    });
    const raw = response.content[0]?.text || '[]';
    let extracted;
    try {
      const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      extracted = JSON.parse(clean);
      if (!Array.isArray(extracted)) throw new Error('not array');
    } catch {
      return res.status(422).json({ error: 'AI returned invalid JSON', raw });
    }
    const created = [];
    for (const t of extracted) {
      if (!t.title) continue;
      const r = db.prepare(
        "INSERT INTO tasks (title,notes,status,priority,category,projectId,dueDate,sourceSessionId,updatedAt) VALUES (?,?,'todo',?,?,?,?,?,datetime('now'))"
      ).run(t.title, t.notes || null, t.priority || 'medium', t.category || null, projectId || null, t.dueDate || null, sessionId);
      created.push(buildTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid)));
    }
    res.json({ tasks: created, count: created.length });
  } catch (err) {
    console.error('[tasks extract]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/ai-generate — must be before /:id routes
router.post('/ai-generate', async (req, res) => {
  try {
    const { prompt, projectId, parentTaskId: aiParentId } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const systemPrompt = aiParentId
      ? 'You are a task planning assistant. Generate subtasks for the given task. Return ONLY a valid JSON array of objects with fields: title, notes (optional). No other text.'
      : 'You are a task planning assistant. Extract or generate a structured task list from the user input. Return ONLY a valid JSON array of task objects, no other text.';
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0]?.text || '[]';
    let aiTasks;
    try {
      const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      aiTasks = JSON.parse(clean);
      if (!Array.isArray(aiTasks)) throw new Error('not array');
    } catch {
      return res.status(422).json({ error: 'AI returned invalid JSON', raw });
    }
    const created = [];
    for (const t of aiTasks) {
      if (!t.title) continue;
      const r = db.prepare(
        "INSERT INTO tasks (title,notes,status,priority,category,projectId,parentTaskId,dueDate,updatedAt) VALUES (?,?,'todo',?,?,?,?,?,datetime('now'))"
      ).run(t.title, t.notes||null, t.priority||'medium', t.category||null, projectId||null, aiParentId||null, t.dueDate||null);
      const taskId = r.lastInsertRowid;
      if (!aiParentId && Array.isArray(t.subtasks)) {
        for (const sub of t.subtasks) {
          const title = typeof sub === 'string' ? sub : sub.title;
          if (title) db.prepare("INSERT INTO tasks (title,status,priority,parentTaskId,updatedAt) VALUES (?,'todo','medium',?,datetime('now'))").run(title, taskId);
        }
      }
      created.push(buildTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId)));
    }
    res.json(created);
  } catch (err) {
    console.error('[tasks ai-generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/duplicate — must be before /:id routes
router.post('/:id/duplicate', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const r = db.prepare(
      "INSERT INTO tasks (title,notes,status,priority,category,projectId,recurrence,recurrenceConfig,dueDate,\"order\",updatedAt) VALUES (?,?,'todo',?,?,?,?,?,?,?,datetime('now'))"
    ).run(task.title + ' (copy)', task.notes, task.priority, task.category, task.projectId, task.recurrence, task.recurrenceConfig, task.dueDate, task.order);
    const newId = r.lastInsertRowid;
    getTags(task.id).forEach(tag => db.prepare('INSERT INTO task_tags (taskId,tag) VALUES (?,?)').run(newId, tag));
    const subs = db.prepare('SELECT * FROM tasks WHERE parentTaskId=?').all(task.id);
    for (const sub of subs) {
      db.prepare("INSERT INTO tasks (title,status,priority,parentTaskId,updatedAt) VALUES (?,'todo',?,?,datetime('now'))").run(sub.title, sub.priority, newId);
    }
    res.json({ ...buildTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(newId)), _new: true });
  } catch (err) {
    console.error('[tasks duplicate]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/comments — must be before /:id routes
router.get('/:id/comments', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM task_comments WHERE taskId=? ORDER BY createdAt ASC').all(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/comments — must be before /:id routes
router.post('/:id/comments', (req, res) => {
  try {
    const task = db.prepare('SELECT id FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const { content, type = 'user' } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const r = db.prepare("INSERT INTO task_comments (taskId,type,content) VALUES (?,?,?)").run(req.params.id, type, content);
    res.json(db.prepare('SELECT * FROM task_comments WHERE id=?').get(r.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/comments/:commentId — must be before /:id routes
router.delete('/comments/:commentId', (req, res) => {
  try {
    db.prepare('DELETE FROM task_comments WHERE id=?').run(req.params.commentId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post('/', (req, res) => {
  try {
    const { title, notes, status, priority, category, projectId, parentTaskId, dueDate, tags, recurrence, recurrenceConfig } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = db.prepare(
      "INSERT INTO tasks (title,notes,status,priority,category,projectId,parentTaskId,dueDate,recurrence,recurrenceConfig,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))"
    ).run(title, notes||null, status||'todo', priority||'medium', category||null, projectId||null, parentTaskId||null, dueDate||null, recurrence||'none', recurrenceConfig ? JSON.stringify(recurrenceConfig) : null);
    const id = r.lastInsertRowid;
    if (Array.isArray(tags)) tags.forEach(tag => { if (tag.trim()) db.prepare('INSERT INTO task_tags (taskId,tag) VALUES (?,?)').run(id, tag.trim()); });
    res.json(buildTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)));
  } catch (err) {
    console.error('[tasks POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const v = (k) => k in req.body ? req.body[k] : task[k];
    const rcfg = 'recurrenceConfig' in req.body
      ? (req.body.recurrenceConfig ? JSON.stringify(req.body.recurrenceConfig) : null)
      : task.recurrenceConfig;
    db.prepare(
      "UPDATE tasks SET title=?,notes=?,status=?,priority=?,category=?,projectId=?,parentTaskId=?,dueDate=?,recurrence=?,recurrenceConfig=?,updatedAt=datetime('now') WHERE id=?"
    ).run(v('title'),v('notes'),v('status'),v('priority'),v('category'),v('projectId'),v('parentTaskId'),v('dueDate'),v('recurrence'),rcfg,id);
    if (Array.isArray(req.body.tags)) {
      db.prepare('DELETE FROM task_tags WHERE taskId=?').run(id);
      req.body.tags.forEach(tag => { if (tag.trim()) db.prepare('INSERT INTO task_tags (taskId,tag) VALUES (?,?)').run(id, tag.trim()); });
    }
    // Log activity for meaningful changes
    const logActivity = (msg) => db.prepare("INSERT INTO task_comments (taskId,type,content) VALUES (?,'system',?)").run(id, msg);
    if ('status' in req.body && req.body.status !== task.status) {
      const labels = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
      logActivity(`Status changed from ${labels[task.status] || task.status} to ${labels[req.body.status] || req.body.status}`);
    }
    if ('priority' in req.body && req.body.priority !== task.priority) {
      logActivity(`Priority changed from ${task.priority} to ${req.body.priority}`);
    }
    if ('dueDate' in req.body && req.body.dueDate !== task.dueDate) {
      logActivity(req.body.dueDate ? `Due date set to ${req.body.dueDate.slice(0,10)}` : 'Due date removed');
    }
    // Handle recurrence: if marked done and has recurrence, create next occurrence
    const updatedTask = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (v('status') === 'done' && updatedTask.recurrence && updatedTask.recurrence !== 'none' && updatedTask.dueDate) {
      const nextDate = calculateNextDate(updatedTask.dueDate, updatedTask.recurrence);
      if (nextDate) {
        const newCount = (updatedTask.recurrenceCount || 0) + 1;
        const newTask = db.prepare(
          "INSERT INTO tasks (title,notes,status,priority,category,projectId,recurrence,recurrenceConfig,dueDate,\"order\",recurrenceCount,updatedAt) VALUES (?,?,'todo',?,?,?,?,?,?,?,?,datetime('now'))"
        ).run(updatedTask.title, updatedTask.notes, updatedTask.priority, updatedTask.category, updatedTask.projectId, updatedTask.recurrence, updatedTask.recurrenceConfig, nextDate, updatedTask.order, newCount);
        getTags(id).forEach(tag => db.prepare('INSERT INTO task_tags (taskId,tag) VALUES (?,?)').run(newTask.lastInsertRowid, tag));
      }
    }
    res.json(buildTask(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)));
  } catch (err) {
    console.error('[tasks PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  try {
    // Subtasks cascade via FK, but also delete orphaned deeper nesting
    db.prepare('DELETE FROM tasks WHERE parentTaskId=?').run(req.params.id);
    db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/subtasks
router.post('/:id/subtasks', (req, res) => {
  try {
    const parent = db.prepare('SELECT id FROM tasks WHERE id=?').get(req.params.id);
    if (!parent) return res.status(404).json({ error: 'parent not found' });
    if (!req.body.title) return res.status(400).json({ error: 'title required' });
    const r = db.prepare("INSERT INTO tasks (title,status,priority,parentTaskId,updatedAt) VALUES (?,'todo','medium',?,datetime('now'))").run(req.body.title, req.params.id);
    res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid));
  } catch (err) {
    console.error('[tasks subtask POST]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
