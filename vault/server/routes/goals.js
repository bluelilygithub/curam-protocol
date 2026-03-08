const express = require('express');
const router = express.Router();
const db = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

function buildKeyResult(kr) {
  const tasks = db.prepare('SELECT status FROM tasks WHERE keyResultId = ?').all(kr.id);
  return {
    ...kr,
    linkedTaskCount: tasks.length,
    completedTaskCount: tasks.filter(t => t.status === 'done').length,
    progress: kr.targetValue > 0 ? Math.min(100, Math.round((kr.currentValue / kr.targetValue) * 100)) : 0,
  };
}

function buildObjective(row) {
  const krs = db.prepare('SELECT * FROM key_results WHERE objectiveId = ? ORDER BY id').all(row.id).map(buildKeyResult);
  const overallProgress = krs.length
    ? Math.round(krs.reduce((s, kr) => s + kr.progress, 0) / krs.length)
    : 0;
  return { ...row, keyResults: krs, overallProgress };
}

// GET /api/goals — list all objectives with nested KRs
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM objectives ORDER BY createdAt DESC').all();
    res.json(rows.map(buildObjective));
  } catch (err) {
    console.error('[goals GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/dashboard — summary for home widget (must be before /:id)
router.get('/dashboard', (req, res) => {
  try {
    const objectives = db.prepare("SELECT * FROM objectives WHERE status = 'active'").all().map(buildObjective);
    const activeCount = objectives.length;
    const avgProgress = activeCount
      ? Math.round(objectives.reduce((s, o) => s + o.overallProgress, 0) / activeCount)
      : 0;
    const topObjectives = objectives
      .sort((a, b) => b.overallProgress - a.overallProgress)
      .slice(0, 3);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const completedThisMonth = db.prepare(
      "SELECT COUNT(*) as c FROM objectives WHERE status = 'completed' AND updatedAt >= ?"
    ).get(startOfMonth.toISOString())?.c || 0;
    res.json({ activeCount, avgProgress, topObjectives, completedThisMonth });
  } catch (err) {
    console.error('[goals dashboard]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/ai-suggest — SSE: stream KR suggestions (must be before /:id)
router.post('/ai-suggest', async (req, res) => {
  try {
    const { title, description, timeframe } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const prompt = `Objective: "${title}"${description ? `\nDescription: ${description}` : ''}${timeframe ? `\nTimeframe: ${timeframe}` : ''}

Suggest 3-5 SMART Key Results for this objective. For each, provide a JSON object on its own line with fields: title (string), targetValue (number), unit (string like "%", "tasks", "calls", "$", "items").

Output ONLY JSON objects, one per line, no explanations, no markdown, no array brackets. Example:
{"title":"Increase monthly revenue","targetValue":50000,"unit":"$"}
{"title":"Complete onboarding modules","targetValue":100,"unit":"%"}`;
    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: 'You are a goal-setting coach specialising in OKR frameworks. Output only JSON objects, one per line.',
      messages: [{ role: 'user', content: prompt }],
    });
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify(text)}\n\n`);
    });
    stream.on('finalMessage', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });
    stream.on('error', (err) => {
      console.error('[goals ai-suggest]', err);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    console.error('[goals ai-suggest]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/goals/key-results/:krId — update a KR (must be before /:id)
router.put('/key-results/:krId', (req, res) => {
  try {
    const { title, targetValue, currentValue, unit, dueDate, status } = req.body;
    const kr = db.prepare('SELECT * FROM key_results WHERE id = ?').get(req.params.krId);
    if (!kr) return res.status(404).json({ error: 'Key result not found' });
    db.prepare(
      "UPDATE key_results SET title=?, targetValue=?, currentValue=?, unit=?, dueDate=?, status=?, updatedAt=datetime('now') WHERE id=?"
    ).run(
      title ?? kr.title,
      targetValue ?? kr.targetValue,
      currentValue ?? kr.currentValue,
      unit ?? kr.unit,
      dueDate !== undefined ? dueDate : kr.dueDate,
      status ?? kr.status,
      kr.id
    );
    res.json(buildKeyResult(db.prepare('SELECT * FROM key_results WHERE id = ?').get(kr.id)));
  } catch (err) {
    console.error('[goals KR PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/goals/key-results/:krId — delete a KR (must be before /:id)
router.delete('/key-results/:krId', (req, res) => {
  try {
    const kr = db.prepare('SELECT * FROM key_results WHERE id = ?').get(req.params.krId);
    if (!kr) return res.status(404).json({ error: 'Key result not found' });
    db.prepare('UPDATE tasks SET keyResultId = NULL WHERE keyResultId = ?').run(kr.id);
    db.prepare('DELETE FROM key_results WHERE id = ?').run(kr.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[goals KR DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals — create objective
router.post('/', (req, res) => {
  try {
    const { title, description, timeframe, color } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const r = db.prepare(
      "INSERT INTO objectives (title, description, timeframe, color) VALUES (?, ?, ?, ?)"
    ).run(title.trim(), description || null, timeframe || null, color || '#6366f1');
    const obj = db.prepare('SELECT * FROM objectives WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(buildObjective(obj));
  } catch (err) {
    console.error('[goals POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/:id — single objective with KRs
router.get('/:id', (req, res) => {
  try {
    const obj = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Objective not found' });
    res.json(buildObjective(obj));
  } catch (err) {
    console.error('[goals GET /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/goals/:id — update objective
router.put('/:id', (req, res) => {
  try {
    const obj = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Objective not found' });
    const { title, description, timeframe, color, status } = req.body;
    db.prepare(
      "UPDATE objectives SET title=?, description=?, timeframe=?, color=?, status=?, updatedAt=datetime('now') WHERE id=?"
    ).run(
      title ?? obj.title,
      description !== undefined ? description : obj.description,
      timeframe !== undefined ? timeframe : obj.timeframe,
      color ?? obj.color,
      status ?? obj.status,
      obj.id
    );
    res.json(buildObjective(db.prepare('SELECT * FROM objectives WHERE id = ?').get(obj.id)));
  } catch (err) {
    console.error('[goals PUT /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/goals/:id — delete objective
router.delete('/:id', (req, res) => {
  try {
    const obj = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Objective not found' });
    // Unlink tasks from KRs belonging to this objective
    const krs = db.prepare('SELECT id FROM key_results WHERE objectiveId = ?').all(obj.id);
    for (const kr of krs) {
      db.prepare('UPDATE tasks SET keyResultId = NULL WHERE keyResultId = ?').run(kr.id);
    }
    db.prepare('DELETE FROM objectives WHERE id = ?').run(obj.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[goals DELETE /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/:id/key-results — add KR to objective
router.post('/:id/key-results', (req, res) => {
  try {
    const obj = db.prepare('SELECT * FROM objectives WHERE id = ?').get(req.params.id);
    if (!obj) return res.status(404).json({ error: 'Objective not found' });
    const { title, targetValue, currentValue, unit, dueDate } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const r = db.prepare(
      'INSERT INTO key_results (objectiveId, title, targetValue, currentValue, unit, dueDate) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(obj.id, title.trim(), targetValue ?? 100, currentValue ?? 0, unit || '%', dueDate || null);
    const kr = db.prepare('SELECT * FROM key_results WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(buildKeyResult(kr));
  } catch (err) {
    console.error('[goals KR POST]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
