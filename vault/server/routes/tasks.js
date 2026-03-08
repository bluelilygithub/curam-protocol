const express = require('express');
const router = express.Router();
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

const client = new Anthropic();

function getTags(taskId) {
  return db.prepare('SELECT tag FROM task_tags WHERE taskId=?').all(taskId).map(r => r.tag);
}

function getSubtaskStats(taskId) {
  const subs = db.prepare('SELECT status FROM tasks WHERE parentTaskId=?').all(taskId);
  return { subtaskCount: subs.length, subtaskDone: subs.filter(s => s.status === 'done').length };
}

function getKrInfo(keyResultId) {
  if (!keyResultId) return { keyResultTitle: null, objectiveTitle: null };
  const kr = db.prepare('SELECT kr.title as krTitle, o.title as objTitle FROM key_results kr LEFT JOIN objectives o ON o.id = kr.objectiveId WHERE kr.id = ?').get(keyResultId);
  return { keyResultTitle: kr?.krTitle || null, objectiveTitle: kr?.objTitle || null };
}

function getBlockerCount(taskId) {
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM task_dependencies td JOIN tasks t ON t.id = td.blockedByTaskId WHERE td.taskId = ? AND t.status != 'done'"
  ).get(taskId);
  return row?.c || 0;
}

function buildTask(row) {
  return { ...row, tags: getTags(row.id), ...getSubtaskStats(row.id), ...getKrInfo(row.keyResultId), blockerCount: getBlockerCount(row.id) };
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

// GET /api/tasks/morning-digest — must be before /:id routes
router.get('/morning-digest', async (req, res) => {
  try {
    const todayStart = new Date().toISOString().slice(0, 10);
    const todayEnd = todayStart + 'T23:59:59';
    const overdue = db.prepare(
      "SELECT * FROM tasks WHERE parentTaskId IS NULL AND status IN ('todo','in-progress') AND dueDate IS NOT NULL AND dueDate < ? ORDER BY dueDate ASC, CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 10"
    ).all(todayStart).map(buildTask);
    const today = db.prepare(
      "SELECT * FROM tasks WHERE parentTaskId IS NULL AND status IN ('todo','in-progress') AND dueDate >= ? AND dueDate <= ? ORDER BY dueDate ASC, CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 10"
    ).all(todayStart, todayEnd).map(buildTask);
    let suggestion = '';
    if (overdue.length > 0 || today.length > 0) {
      const lines = [
        ...overdue.map(t => `[OVERDUE] ${t.title} (${t.priority} priority, due ${t.dueDate?.slice(0, 10)})`),
        ...today.map(t => `[TODAY] ${t.title} (${t.priority} priority${t.dueDate?.includes('T') ? ', at ' + t.dueDate.slice(11, 16) : ''})`),
      ];
      try {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          system: 'You are a productivity assistant. Given the user\'s task list, recommend what to focus on first today and explain briefly why in 2-3 sentences. Be direct and specific.',
          messages: [{ role: 'user', content: `My tasks:\n${lines.join('\n')}\n\nWhat should I focus on first?` }],
        });
        suggestion = response.content[0]?.text?.trim() || '';
      } catch { suggestion = ''; }
    }
    res.json({ overdue, today, suggestion });
  } catch (err) {
    console.error('[morning-digest]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/weekly-review-suggestions — SSE stream — must be before /:id routes
router.post('/weekly-review-suggestions', async (req, res) => {
  try {
    const tasks = db.prepare(
      "SELECT * FROM tasks WHERE status != 'done' AND parentTaskId IS NULL ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, dueDate ASC LIMIT 20"
    ).all().map(buildTask);
    if (tasks.length === 0) {
      res.json({ text: 'No open tasks found. You\'re all caught up — use the new week to plan fresh goals!' });
      return;
    }
    const lines = tasks.map(t =>
      `- ${t.title} [${t.priority} priority, status: ${t.status}${t.dueDate ? ', due ' + t.dueDate.slice(0, 10) : ''}${t.estimatedMinutes ? ', ~' + t.estimatedMinutes + 'min' : ''}]`
    ).join('\n');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'You are a productivity coach. Based on the user\'s open tasks, give 3-5 concrete, actionable suggestions for the coming week. Be specific, encouraging, and prioritise by impact. Use bullet points.',
      messages: [{ role: 'user', content: `Here are my open tasks:\n${lines}\n\nWhat should I focus on this week?` }],
    });
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify(text)}\n\n`);
    });
    stream.on('finalMessage', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });
    stream.on('error', (err) => {
      console.error('[weekly-review-suggestions]', err);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    console.error('[weekly-review-suggestions]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/import — bulk CSV import — must be before /:id routes
router.post('/import', (req, res) => {
  try {
    const { tasks: rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'tasks array required' });
    const validStatuses = ['todo', 'in-progress', 'done'];
    const validPriorities = ['high', 'medium', 'low'];
    let created = 0, skipped = 0;
    const errors = [];
    const insertTask = db.prepare(
      "INSERT INTO tasks (title,notes,status,priority,category,projectId,dueDate,estimatedMinutes,timeSpentMinutes,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))"
    );
    const insertTag = db.prepare('INSERT INTO task_tags (taskId,tag) VALUES (?,?)');
    const tx = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i];
        if (!t.title || !t.title.trim()) { errors.push({ row: i + 1, reason: 'title required' }); skipped++; continue; }
        const status = validStatuses.includes(t.status) ? t.status : 'todo';
        const priority = validPriorities.includes(t.priority) ? t.priority : 'medium';
        // Validate projectId exists
        let projectId = null;
        if (t.projectId) {
          const proj = db.prepare('SELECT id FROM projects WHERE id=?').get(Number(t.projectId));
          projectId = proj ? Number(t.projectId) : null;
        }
        const r = insertTask.run(
          t.title.trim(), t.notes || null, status, priority,
          t.category || null, projectId, t.dueDate || null,
          t.estimatedMinutes != null ? Number(t.estimatedMinutes) : null,
          t.timeSpentMinutes != null ? Number(t.timeSpentMinutes) : 0
        );
        const taskId = r.lastInsertRowid;
        if (t.tags) {
          const tags = String(t.tags).split(',').map(s => s.trim()).filter(Boolean);
          tags.forEach(tag => insertTag.run(taskId, tag));
        }
        created++;
      }
    });
    tx();
    res.json({ created, skipped, errors });
  } catch (err) {
    console.error('[tasks import]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/share — generate share token — must be before /:id routes
router.post('/:id/share', (req, res) => {
  try {
    const task = db.prepare('SELECT id, shareToken FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const token = task.shareToken || crypto.randomBytes(16).toString('hex');
    if (!task.shareToken) {
      db.prepare("UPDATE tasks SET shareToken=?, updatedAt=datetime('now') WHERE id=?").run(token, req.params.id);
    }
    const appUrl = process.env.APP_URL || 'https://curam-vault.up.railway.app';
    res.json({ shareUrl: `${appUrl}/shared/task/${token}`, token });
  } catch (err) {
    console.error('[tasks share]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id/share — revoke share token — must be before /:id routes
router.delete('/:id/share', (req, res) => {
  try {
    const task = db.prepare('SELECT id FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    db.prepare("UPDATE tasks SET shareToken=NULL, updatedAt=datetime('now') WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks unshare]', err);
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
      ? 'You are a task planning assistant. Generate subtasks for the given task. Return ONLY a valid JSON array of objects with fields: title, notes (optional), estimatedMinutes (number of minutes or null). No other text.'
      : 'You are a task planning assistant. Extract or generate a structured task list from the user input. Return ONLY a valid JSON array of task objects with fields: title, notes (optional), priority (high/medium/low), category (optional), dueDate (ISO date string or null), estimatedMinutes (number of minutes or null). No other text.';
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
        "INSERT INTO tasks (title,notes,status,priority,category,projectId,parentTaskId,dueDate,estimatedMinutes,updatedAt) VALUES (?,?,'todo',?,?,?,?,?,?,datetime('now'))"
      ).run(t.title, t.notes||null, t.priority||'medium', t.category||null, projectId||null, aiParentId||null, t.dueDate||null, t.estimatedMinutes != null ? Number(t.estimatedMinutes) : null);
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

// GET /api/tasks/:id/dependencies
router.get('/:id/dependencies', (req, res) => {
  try {
    const blockers = db.prepare(
      'SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id = td.blockedByTaskId WHERE td.taskId = ?'
    ).all(req.params.id);
    const dependents = db.prepare(
      'SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id = td.taskId WHERE td.blockedByTaskId = ?'
    ).all(req.params.id);
    res.json({ blockers, dependents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/dependencies
router.post('/:id/dependencies', (req, res) => {
  try {
    const { blockedByTaskId } = req.body;
    if (!blockedByTaskId) return res.status(400).json({ error: 'blockedByTaskId required' });
    const taskId = Number(req.params.id);
    const blockerId = Number(blockedByTaskId);
    if (taskId === blockerId) return res.status(400).json({ error: 'task cannot block itself' });
    // BFS circular dependency check: if taskId is reachable from blockerId, adding this dep would create a cycle
    const visited = new Set();
    const queue = [blockerId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === taskId) return res.status(400).json({ error: 'circular dependency detected' });
      if (visited.has(current)) continue;
      visited.add(current);
      const upstream = db.prepare('SELECT blockedByTaskId FROM task_dependencies WHERE taskId = ?').all(current);
      upstream.forEach(r => queue.push(r.blockedByTaskId));
    }
    db.prepare('INSERT OR IGNORE INTO task_dependencies (taskId, blockedByTaskId) VALUES (?,?)').run(taskId, blockerId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[task dependencies POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id/dependencies/:blockedByTaskId
router.delete('/:id/dependencies/:blockedByTaskId', (req, res) => {
  try {
    db.prepare('DELETE FROM task_dependencies WHERE taskId=? AND blockedByTaskId=?').run(req.params.id, req.params.blockedByTaskId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post('/', (req, res) => {
  try {
    const { title, notes, status, priority, category, projectId, parentTaskId, dueDate, tags, recurrence, recurrenceConfig, estimatedMinutes, keyResultId } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const r = db.prepare(
      "INSERT INTO tasks (title,notes,status,priority,category,projectId,parentTaskId,dueDate,recurrence,recurrenceConfig,estimatedMinutes,keyResultId,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))"
    ).run(title, notes||null, status||'todo', priority||'medium', category||null, projectId||null, parentTaskId||null, dueDate||null, recurrence||'none', recurrenceConfig ? JSON.stringify(recurrenceConfig) : null, estimatedMinutes != null ? Number(estimatedMinutes) : null, keyResultId||null);
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
    const newEstimated = 'estimatedMinutes' in req.body
      ? (req.body.estimatedMinutes != null ? Number(req.body.estimatedMinutes) : null)
      : task.estimatedMinutes;
    const newKeyResultId = 'keyResultId' in req.body
      ? (req.body.keyResultId != null ? Number(req.body.keyResultId) : null)
      : task.keyResultId;
    const newTimeSpent = 'timeSpentMinutes' in req.body
      ? (req.body.timeSpentMinutes != null ? Number(req.body.timeSpentMinutes) : 0)
      : task.timeSpentMinutes;
    db.prepare(
      "UPDATE tasks SET title=?,notes=?,status=?,priority=?,category=?,projectId=?,parentTaskId=?,dueDate=?,recurrence=?,recurrenceConfig=?,estimatedMinutes=?,keyResultId=?,timeSpentMinutes=?,updatedAt=datetime('now') WHERE id=?"
    ).run(v('title'),v('notes'),v('status'),v('priority'),v('category'),v('projectId'),v('parentTaskId'),v('dueDate'),v('recurrence'),rcfg,newEstimated,newKeyResultId,newTimeSpent,id);
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
