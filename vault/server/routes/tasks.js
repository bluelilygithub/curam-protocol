'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

const anthropic = new Anthropic();

async function getTags(taskId) {
  const { rows } = await pool.query('SELECT tag FROM task_tags WHERE "taskId"=$1', [taskId]);
  return rows.map(r => r.tag);
}

async function getSubtaskStats(taskId) {
  const { rows } = await pool.query('SELECT status FROM tasks WHERE "parentTaskId"=$1', [taskId]);
  return { subtaskCount: rows.length, subtaskDone: rows.filter(s => s.status === 'done').length };
}

async function getKrInfo(keyResultId) {
  if (!keyResultId) return { keyResultTitle: null, objectiveTitle: null };
  const { rows } = await pool.query(
    'SELECT kr.title as "krTitle", o.title as "objTitle" FROM key_results kr LEFT JOIN objectives o ON o.id = kr."objectiveId" WHERE kr.id = $1',
    [keyResultId]
  );
  const kr = rows[0];
  return { keyResultTitle: kr?.krTitle || null, objectiveTitle: kr?.objTitle || null };
}

async function getBlockerCount(taskId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*) as c FROM task_dependencies td JOIN tasks t ON t.id = td.\"blockedByTaskId\" WHERE td.\"taskId\" = $1 AND t.status != 'done'",
    [taskId]
  );
  return Number(rows[0]?.c || 0);
}

async function getSourceSessionTitle(sessionId) {
  if (!sessionId) return null;
  const { rows } = await pool.query('SELECT title FROM sessions WHERE "sessionId"=$1', [sessionId]);
  return rows[0]?.title || null;
}

async function buildTask(row) {
  const [tags, subtaskStats, krInfo, blockerCount, sourceSessionTitle] = await Promise.all([
    getTags(row.id),
    getSubtaskStats(row.id),
    getKrInfo(row.keyResultId),
    getBlockerCount(row.id),
    getSourceSessionTitle(row.sourceSessionId),
  ]);
  return { ...row, tags, ...subtaskStats, ...krInfo, blockerCount, sourceSessionTitle };
}

function calculateNextDate(dateStr, recurrence) {
  const d = new Date(dateStr + 'T00:00:00Z');
  switch (recurrence) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'fortnightly': d.setUTCDate(d.getUTCDate() + 14); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'annually': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: return null;
  }
  return d.toISOString().slice(0, 10);
}

// GET /api/tasks — top-level tasks with optional filters
router.get('/', async (req, res) => {
  try {
    const { status, priority, category, projectId, tag, dueBefore, dueAfter, search, activityStatus } = req.query;
    let sql = 'SELECT * FROM tasks WHERE "parentTaskId" IS NULL AND "userId"=$1';
    const p = [req.user.id];
    let idx = 2;
    if (status) { sql += ` AND status=$${idx++}`; p.push(status); }
    if (priority) { sql += ` AND priority=$${idx++}`; p.push(priority); }
    if (category) { sql += ` AND category=$${idx++}`; p.push(category); }
    if (projectId) { sql += ` AND "projectId"=$${idx++}`; p.push(Number(projectId)); }
    if (dueBefore) { sql += ` AND "dueDate"<=$${idx++}`; p.push(dueBefore); }
    if (dueAfter) { sql += ` AND "dueDate">=$${idx++}`; p.push(dueAfter); }
    if (search) { sql += ` AND (title ILIKE $${idx} OR notes ILIKE $${idx + 1})`; p.push(`%${search}%`, `%${search}%`); idx += 2; }
    if (tag) { sql += ` AND id IN (SELECT "taskId" FROM task_tags WHERE tag=$${idx++})`; p.push(tag); }
    if (activityStatus) { sql += ` AND "activityStatus"=$${idx++}`; p.push(activityStatus); }
    sql += ' ORDER BY "order" ASC NULLS LAST, CASE priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, "dueDate" ASC NULLS LAST, "createdAt" DESC';
    const { rows } = await pool.query(sql, p);
    res.json(await Promise.all(rows.map(buildTask)));
  } catch (err) {
    console.error('[tasks GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/subtasks
router.get('/:id/subtasks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE "parentTaskId"=$1 ORDER BY "createdAt" ASC', [req.params.id]);
    res.json(await Promise.all(rows.map(buildTask)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/reorder — must be before /:id to avoid route conflict
router.put('/reorder', async (req, res) => {
  try {
    const { items } = req.body; // [{ id, order }]
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { id, order } of items) {
        await client.query('UPDATE tasks SET "order"=$1, "updatedAt"=NOW() WHERE id=$2', [order, id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks reorder]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/bulk — bulk update — must be before /:id to avoid route conflict
router.put('/bulk', async (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const allowed = ['status', 'priority', 'category'];
    const sets = allowed.filter(k => k in updates);
    if (sets.length === 0) return res.status(400).json({ error: 'no valid update fields' });
    const setClauses = sets.map((k, i) => `${k}=$${i + 1}`).join(', ');
    const setValues = sets.map(k => updates[k]);
    const idPlaceholder = `$${sets.length + 1}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        await client.query(
          `UPDATE tasks SET ${setClauses}, "updatedAt"=NOW() WHERE id=${idPlaceholder}`,
          [...setValues, id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, updated: ids.length });
  } catch (err) {
    console.error('[tasks bulk update]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/bulk — bulk delete — must be before /:id to avoid route conflict
router.delete('/bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        await client.query('DELETE FROM tasks WHERE "parentTaskId"=$1', [id]);
        await client.query('DELETE FROM tasks WHERE id=$1', [id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
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
    const { rows: overdueRows } = await pool.query(
      "SELECT * FROM tasks WHERE \"parentTaskId\" IS NULL AND \"userId\"=$1 AND status IN ('todo','in-progress') AND \"dueDate\" IS NOT NULL AND \"dueDate\" < $2 ORDER BY \"dueDate\" ASC, CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 10",
      [req.user.id, todayStart]
    );
    const { rows: todayRows } = await pool.query(
      "SELECT * FROM tasks WHERE \"parentTaskId\" IS NULL AND \"userId\"=$1 AND status IN ('todo','in-progress') AND \"dueDate\" >= $2 AND \"dueDate\" <= $3 ORDER BY \"dueDate\" ASC, CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 10",
      [req.user.id, todayStart, todayEnd]
    );
    const overdue = await Promise.all(overdueRows.map(buildTask));
    const today = await Promise.all(todayRows.map(buildTask));
    let suggestion = '';
    if (overdue.length > 0 || today.length > 0) {
      const lines = [
        ...overdue.map(t => `[OVERDUE] ${t.title} (${t.priority} priority, due ${t.dueDate?.slice(0, 10)})`),
        ...today.map(t => `[TODAY] ${t.title} (${t.priority} priority${t.dueDate?.includes('T') ? ', at ' + t.dueDate.slice(11, 16) : ''})`),
      ];
      try {
        const response = await anthropic.messages.create({
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
    const { rows } = await pool.query(
      "SELECT * FROM tasks WHERE status != 'done' AND \"parentTaskId\" IS NULL AND \"userId\"=$1 ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, \"dueDate\" ASC NULLS LAST LIMIT 20",
      [req.user.id]
    );
    const tasks = await Promise.all(rows.map(buildTask));
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
    const stream = anthropic.messages.stream({
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

// POST /api/tasks/suggest — infer priority and due date from selected text using Haiku
router.post('/suggest', async (req, res) => {
  const { text, context } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const contextBlock = context ? `\n\nSurrounding context:\n${context.substring(0, 400)}` : '';
    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: `Today is ${today}. Based on this task: "${text.substring(0, 200)}"${contextBlock}\n\nSuggest a priority and due date. Reply with only valid JSON, no markdown: {"priority":"high"|"medium"|"low","dueDate":"YYYY-MM-DD"|null}`,
      }],
    });
    const raw = result.content[0]?.text?.trim() || '{}';
    const parsed = JSON.parse(raw);
    res.json({
      priority: ['high', 'medium', 'low'].includes(parsed.priority) ? parsed.priority : 'medium',
      dueDate: parsed.dueDate || null,
    });
  } catch (err) {
    res.json({ priority: 'medium', dueDate: null });
  }
});

// POST /api/tasks/import — bulk CSV import — must be before /:id routes
router.post('/import', async (req, res) => {
  try {
    const { tasks: rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'tasks array required' });
    const validStatuses = ['todo', 'in-progress', 'done'];
    const validPriorities = ['high', 'medium', 'low'];
    let created = 0, skipped = 0;
    const errors = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i];
        if (!t.title || !t.title.trim()) { errors.push({ row: i + 1, reason: 'title required' }); skipped++; continue; }
        const status = validStatuses.includes(t.status) ? t.status : 'todo';
        const priority = validPriorities.includes(t.priority) ? t.priority : 'medium';
        let projectId = null;
        if (t.projectId) {
          const { rows: projRows } = await client.query('SELECT id FROM projects WHERE id=$1', [Number(t.projectId)]);
          projectId = projRows[0] ? Number(t.projectId) : null;
        }
        const { rows: inserted } = await client.query(
          'INSERT INTO tasks (title,notes,status,priority,category,"projectId","dueDate","estimatedMinutes","timeSpentMinutes","userId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id',
          [
            t.title.trim(), t.notes || null, status, priority,
            t.category || null, projectId, t.dueDate || null,
            t.estimatedMinutes != null ? Number(t.estimatedMinutes) : null,
            t.timeSpentMinutes != null ? Number(t.timeSpentMinutes) : 0,
            req.user.id,
          ]
        );
        const taskId = inserted[0].id;
        if (t.tags) {
          const tags = String(t.tags).split(',').map(s => s.trim()).filter(Boolean);
          for (const tag of tags) {
            await client.query('INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2)', [taskId, tag]);
          }
        }
        created++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ created, skipped, errors });
  } catch (err) {
    console.error('[tasks import]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/share — generate share token — must be before /:id routes
router.post('/:id/share', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, "shareToken" FROM tasks WHERE id=$1', [req.params.id]);
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'not found' });
    const token = task.shareToken || crypto.randomBytes(16).toString('hex');
    if (!task.shareToken) {
      await pool.query('UPDATE tasks SET "shareToken"=$1, "updatedAt"=NOW() WHERE id=$2', [token, req.params.id]);
    }
    const appUrl = process.env.APP_URL || 'https://curam-vault.up.railway.app';
    res.json({ shareUrl: `${appUrl}/shared/task/${token}`, token });
  } catch (err) {
    console.error('[tasks share]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id/share — revoke share token — must be before /:id routes
router.delete('/:id/share', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM tasks WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    await pool.query('UPDATE tasks SET "shareToken"=NULL, "updatedAt"=NOW() WHERE id=$1', [req.params.id]);
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
    const { rows: msgRows } = await pool.query(
      'SELECT role, content FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" DESC LIMIT 20',
      [sessionId]
    );
    if (msgRows.length === 0) return res.status(400).json({ error: 'no messages found' });
    const messages = msgRows.reverse();
    const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const response = await anthropic.messages.create({
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
      const { rows: inserted } = await pool.query(
        "INSERT INTO tasks (title,notes,status,priority,category,\"projectId\",\"dueDate\",\"sourceSessionId\",\"userId\",\"updatedAt\") VALUES ($1,$2,'todo',$3,$4,$5,$6,$7,$8,NOW()) RETURNING id",
        [t.title, t.notes || null, t.priority || 'medium', t.category || null, projectId || null, t.dueDate || null, sessionId, req.user.id]
      );
      const id = inserted[0].id;
      const { rows: newTask } = await pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
      created.push(await buildTask(newTask[0]));
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
    const response = await anthropic.messages.create({
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
      const { rows: inserted } = await pool.query(
        "INSERT INTO tasks (title,notes,status,priority,category,\"projectId\",\"parentTaskId\",\"dueDate\",\"estimatedMinutes\",\"userId\",\"updatedAt\") VALUES ($1,$2,'todo',$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING id",
        [t.title, t.notes || null, t.priority || 'medium', t.category || null, projectId || null, aiParentId || null, t.dueDate || null, t.estimatedMinutes != null ? Number(t.estimatedMinutes) : null, req.user.id]
      );
      const taskId = inserted[0].id;
      if (!aiParentId && Array.isArray(t.subtasks)) {
        for (const sub of t.subtasks) {
          const title = typeof sub === 'string' ? sub : sub.title;
          if (title) {
            await pool.query(
              "INSERT INTO tasks (title,status,priority,\"parentTaskId\",\"updatedAt\") VALUES ($1,'todo','medium',$2,NOW())",
              [title, taskId]
            );
          }
        }
      }
      const { rows: newTask } = await pool.query('SELECT * FROM tasks WHERE id=$1', [taskId]);
      created.push(await buildTask(newTask[0]));
    }
    res.json(created);
  } catch (err) {
    console.error('[tasks ai-generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/duplicate — must be before /:id routes
router.post('/:id/duplicate', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'not found' });
    const { rows: inserted } = await pool.query(
      `INSERT INTO tasks
        (title,notes,status,priority,category,"projectId",recurrence,"recurrenceConfig",
         "dueDate","estimatedMinutes","isUrgent","renewalDimension","keyResultId","order","userId","updatedAt")
       VALUES ($1,$2,'todo',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) RETURNING id`,
      [
        task.title + ' (copy)', task.notes, task.priority, task.category, task.projectId,
        task.recurrence, task.recurrenceConfig,
        task.dueDate, task.estimatedMinutes, task.isUrgent, task.renewalDimension, task.keyResultId,
        task.order, req.user.id,
      ]
    );
    const newId = inserted[0].id;
    const tags = await getTags(task.id);
    for (const tag of tags) {
      await pool.query('INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2)', [newId, tag]);
    }
    const { rows: subsRows } = await pool.query('SELECT * FROM tasks WHERE "parentTaskId"=$1 ORDER BY id', [task.id]);
    for (const sub of subsRows) {
      await pool.query(
        "INSERT INTO tasks (title,status,priority,\"estimatedMinutes\",\"parentTaskId\",\"updatedAt\") VALUES ($1,'todo',$2,$3,$4,NOW())",
        [sub.title, sub.priority, sub.estimatedMinutes, newId]
      );
    }
    const { rows: newTaskRows } = await pool.query('SELECT * FROM tasks WHERE id=$1', [newId]);
    res.json({ ...(await buildTask(newTaskRows[0])), _new: true });
  } catch (err) {
    console.error('[tasks duplicate]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/comments — must be before /:id routes
router.get('/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM task_comments WHERE "taskId"=$1 ORDER BY "createdAt" ASC', [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/comments — must be before /:id routes
router.post('/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM tasks WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const { content, type = 'user' } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const { rows: inserted } = await pool.query(
      'INSERT INTO task_comments ("taskId",type,content) VALUES ($1,$2,$3) RETURNING id',
      [req.params.id, type, content]
    );
    const { rows: comment } = await pool.query('SELECT * FROM task_comments WHERE id=$1', [inserted[0].id]);
    res.json(comment[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/comments/:commentId — must be before /:id routes
router.delete('/comments/:commentId', async (req, res) => {
  try {
    await pool.query('DELETE FROM task_comments WHERE id=$1', [req.params.commentId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/dependencies
router.get('/:id/dependencies', async (req, res) => {
  try {
    const { rows: blockers } = await pool.query(
      'SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id = td."blockedByTaskId" WHERE td."taskId" = $1',
      [req.params.id]
    );
    const { rows: dependents } = await pool.query(
      'SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id = td."taskId" WHERE td."blockedByTaskId" = $1',
      [req.params.id]
    );
    res.json({ blockers, dependents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/dependencies
router.post('/:id/dependencies', async (req, res) => {
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
      const { rows: upstream } = await pool.query('SELECT "blockedByTaskId" FROM task_dependencies WHERE "taskId" = $1', [current]);
      upstream.forEach(r => queue.push(r.blockedByTaskId));
    }
    await pool.query('INSERT INTO task_dependencies ("taskId", "blockedByTaskId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [taskId, blockerId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[task dependencies POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id/dependencies/:blockedByTaskId
router.delete('/:id/dependencies/:blockedByTaskId', async (req, res) => {
  try {
    await pool.query('DELETE FROM task_dependencies WHERE "taskId"=$1 AND "blockedByTaskId"=$2', [req.params.id, req.params.blockedByTaskId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    const { title, notes, status, priority, category, projectId, parentTaskId, dueDate, tags, recurrence, recurrenceConfig, estimatedMinutes, keyResultId, isUrgent, renewalDimension, sourceSessionId, activityStatus } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const recurrenceGroupId = (recurrence && recurrence !== 'none') ? crypto.randomUUID() : null;
    const validActivityStatuses = ['none', 'started', 'paused', 'waiting'];
    const safeActivityStatus = validActivityStatuses.includes(activityStatus) ? activityStatus : 'none';
    const { rows } = await pool.query(
      'INSERT INTO tasks (title,notes,status,priority,category,"projectId","parentTaskId","dueDate",recurrence,"recurrenceConfig","estimatedMinutes","keyResultId","isUrgent","renewalDimension","sourceSessionId","recurrenceGroupId","activityStatus","userId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()) RETURNING id',
      [title, notes || null, status || 'todo', priority || 'medium', category || null, projectId || null, parentTaskId || null, dueDate || null, recurrence || 'none', recurrenceConfig ? JSON.stringify(recurrenceConfig) : null, estimatedMinutes != null ? Number(estimatedMinutes) : null, keyResultId || null, isUrgent ? 1 : 0, renewalDimension || null, sourceSessionId || null, recurrenceGroupId, safeActivityStatus, req.user.id]
    );
    const id = rows[0].id;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (tag.trim()) await pool.query('INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2)', [id, tag.trim()]);
      }
    }
    const { rows: newTask } = await pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
    res.json(await buildTask(newTask[0]));
  } catch (err) {
    console.error('[tasks POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: existing } = await pool.query('SELECT * FROM tasks WHERE id=$1 AND "userId"=$2', [id, req.user.id]);
    const task = existing[0];
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
    const newIsUrgent = 'isUrgent' in req.body ? (req.body.isUrgent ? 1 : 0) : (task.isUrgent || 0);
    const newRenewalDimension = 'renewalDimension' in req.body ? (req.body.renewalDimension || null) : task.renewalDimension;
    const validActivityStatuses = ['none', 'started', 'paused', 'waiting'];
    const newActivityStatus = 'activityStatus' in req.body && validActivityStatuses.includes(req.body.activityStatus) ? req.body.activityStatus : (task.activityStatus || 'none');
    await pool.query(
      'UPDATE tasks SET title=$1,notes=$2,status=$3,priority=$4,category=$5,"projectId"=$6,"parentTaskId"=$7,"dueDate"=$8,recurrence=$9,"recurrenceConfig"=$10,"estimatedMinutes"=$11,"keyResultId"=$12,"timeSpentMinutes"=$13,"isUrgent"=$14,"renewalDimension"=$15,"activityStatus"=$16,"updatedAt"=NOW() WHERE id=$17',
      [v('title'), v('notes'), v('status'), v('priority'), v('category'), v('projectId'), v('parentTaskId'), v('dueDate'), v('recurrence'), rcfg, newEstimated, newKeyResultId, newTimeSpent, newIsUrgent, newRenewalDimension, newActivityStatus, id]
    );
    if (Array.isArray(req.body.tags)) {
      await pool.query('DELETE FROM task_tags WHERE "taskId"=$1', [id]);
      for (const tag of req.body.tags) {
        if (tag.trim()) await pool.query('INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2)', [id, tag.trim()]);
      }
    }
    // Log activity for meaningful changes
    const logActivity = async (msg) => {
      await pool.query("INSERT INTO task_comments (\"taskId\",type,content) VALUES ($1,'system',$2)", [id, msg]);
    };
    if ('status' in req.body && req.body.status !== task.status) {
      const labels = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' };
      await logActivity(`Status changed from ${labels[task.status] || task.status} to ${labels[req.body.status] || req.body.status}`);
    }
    if ('priority' in req.body && req.body.priority !== task.priority) {
      await logActivity(`Priority changed from ${task.priority} to ${req.body.priority}`);
    }
    if ('dueDate' in req.body && req.body.dueDate !== task.dueDate) {
      await logActivity(req.body.dueDate ? `Due date set to ${req.body.dueDate.slice(0, 10)}` : 'Due date removed');
    }
    // Handle recurrence: if marked done and has recurrence, create next occurrence
    const { rows: updatedRows } = await pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
    const updatedTask = updatedRows[0];
    const wasAlreadyDone = task.status === 'done';
    const isNowDone = v('status') === 'done';
    if (isNowDone && !wasAlreadyDone && updatedTask.recurrence && updatedTask.recurrence !== 'none') {
      // Use dueDate if set, otherwise use today as the base for the next occurrence
      const baseDate = updatedTask.dueDate
        ? updatedTask.dueDate.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const nextDate = calculateNextDate(baseDate, updatedTask.recurrence);
      if (nextDate) {
        const newCount = (updatedTask.recurrenceCount || 0) + 1;
        const { rows: recurrInserted } = await pool.query(
          "INSERT INTO tasks (title,notes,status,priority,category,\"projectId\",recurrence,\"recurrenceConfig\",\"dueDate\",\"order\",\"recurrenceCount\",\"recurrenceGroupId\",\"userId\",\"updatedAt\") VALUES ($1,$2,'todo',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING id",
          [updatedTask.title, updatedTask.notes, updatedTask.priority, updatedTask.category, updatedTask.projectId, updatedTask.recurrence, updatedTask.recurrenceConfig, nextDate, updatedTask.order, newCount, updatedTask.recurrenceGroupId || null, req.user.id]
        );
        const newTaskId = recurrInserted[0].id;
        const tags = await getTags(id);
        for (const tag of tags) {
          await pool.query('INSERT INTO task_tags ("taskId",tag) VALUES ($1,$2)', [newTaskId, tag]);
        }
      }
    }
    const { rows: finalRows } = await pool.query('SELECT * FROM tasks WHERE id=$1', [id]);
    res.json(await buildTask(finalRows[0]));
  } catch (err) {
    console.error('[tasks PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    if (req.query.stopSeries === 'true') {
      // Find the recurrenceGroupId for this task, then delete all non-done tasks in the series
      const { rows } = await pool.query('SELECT "recurrenceGroupId" FROM tasks WHERE id=$1', [req.params.id]);
      const groupId = rows[0]?.recurrenceGroupId;
      if (groupId) {
        // Get all non-done sibling task IDs (excluding the task itself) to delete their subtasks first
        const { rows: siblings } = await pool.query(
          'SELECT id FROM tasks WHERE "recurrenceGroupId"=$1 AND status!=\'done\' AND id!=$2',
          [groupId, req.params.id]
        );
        for (const s of siblings) {
          await pool.query('DELETE FROM tasks WHERE "parentTaskId"=$1', [s.id]);
        }
        await pool.query('DELETE FROM tasks WHERE "recurrenceGroupId"=$1 AND status!=\'done\'', [groupId]);
      }
    }
    await pool.query('DELETE FROM tasks WHERE "parentTaskId"=$1', [req.params.id]);
    await pool.query('DELETE FROM tasks WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[tasks DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/subtasks
router.post('/:id/subtasks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM tasks WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'parent not found' });
    if (!req.body.title) return res.status(400).json({ error: 'title required' });
    const { rows: inserted } = await pool.query(
      "INSERT INTO tasks (title,status,priority,\"parentTaskId\",\"userId\",\"updatedAt\") VALUES ($1,'todo','medium',$2,$3,NOW()) RETURNING id",
      [req.body.title, req.params.id, req.user.id]
    );
    const { rows: newTask } = await pool.query('SELECT * FROM tasks WHERE id=$1', [inserted[0].id]);
    res.json(newTask[0]);
  } catch (err) {
    console.error('[tasks subtask POST]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
