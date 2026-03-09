'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

async function buildKeyResult(kr) {
  const { rows: tasks } = await pool.query(
    'SELECT status FROM tasks WHERE "keyResultId" = $1', [kr.id]
  );
  return {
    ...kr,
    linkedTaskCount: tasks.length,
    completedTaskCount: tasks.filter(t => t.status === 'done').length,
    progress: kr.targetValue > 0 ? Math.min(100, Math.round((kr.currentValue / kr.targetValue) * 100)) : 0,
  };
}

async function buildObjective(row) {
  const { rows: krRows } = await pool.query(
    'SELECT * FROM key_results WHERE "objectiveId" = $1 ORDER BY id', [row.id]
  );
  const krs = await Promise.all(krRows.map(buildKeyResult));
  const overallProgress = krs.length
    ? Math.round(krs.reduce((s, kr) => s + kr.progress, 0) / krs.length)
    : 0;
  return { ...row, keyResults: krs, overallProgress };
}

// GET /api/goals — list all objectives with nested KRs
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM objectives ORDER BY "createdAt" DESC');
    res.json(await Promise.all(rows.map(buildObjective)));
  } catch (err) {
    console.error('[goals GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/dashboard — summary for home widget (must be before /:id)
router.get('/dashboard', async (req, res) => {
  try {
    const { rows: activeRows } = await pool.query("SELECT * FROM objectives WHERE status = 'active'");
    const objectives = await Promise.all(activeRows.map(buildObjective));
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
    const { rows: completedRows } = await pool.query(
      "SELECT COUNT(*) as c FROM objectives WHERE status = 'completed' AND \"updatedAt\" >= $1",
      [startOfMonth.toISOString()]
    );
    const completedThisMonth = Number(completedRows[0].c);
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
    const stream = anthropic.messages.stream({
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
router.put('/key-results/:krId', async (req, res) => {
  try {
    const { rows: krs } = await pool.query('SELECT * FROM key_results WHERE id = $1', [req.params.krId]);
    if (!krs[0]) return res.status(404).json({ error: 'Key result not found' });
    const kr = krs[0];
    const { title, targetValue, currentValue, unit, dueDate, status } = req.body;
    await pool.query(
      `UPDATE key_results SET title=$1, "targetValue"=$2, "currentValue"=$3, unit=$4, "dueDate"=$5, status=$6, "updatedAt"=NOW() WHERE id=$7`,
      [
        title ?? kr.title,
        targetValue ?? kr.targetValue,
        currentValue ?? kr.currentValue,
        unit ?? kr.unit,
        dueDate !== undefined ? dueDate : kr.dueDate,
        status ?? kr.status,
        kr.id,
      ]
    );
    const { rows: updated } = await pool.query('SELECT * FROM key_results WHERE id = $1', [kr.id]);
    res.json(await buildKeyResult(updated[0]));
  } catch (err) {
    console.error('[goals KR PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/goals/key-results/:krId — delete a KR (must be before /:id)
router.delete('/key-results/:krId', async (req, res) => {
  try {
    const { rows: krs } = await pool.query('SELECT * FROM key_results WHERE id = $1', [req.params.krId]);
    if (!krs[0]) return res.status(404).json({ error: 'Key result not found' });
    await pool.query('UPDATE tasks SET "keyResultId" = NULL WHERE "keyResultId" = $1', [krs[0].id]);
    await pool.query('DELETE FROM key_results WHERE id = $1', [krs[0].id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[goals KR DELETE]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/mission — retrieve mission statement (must be before /:id)
router.get('/mission', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'mission_statement'");
    res.json({ statement: rows[0] ? rows[0].value : null });
  } catch (err) {
    console.error('[goals mission GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/goals/mission — upsert mission statement (must be before /:id)
router.put('/mission', async (req, res) => {
  try {
    const { statement } = req.body;
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('mission_statement', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
      [statement || '']
    );
    res.json({ statement: statement || '' });
  } catch (err) {
    console.error('[goals mission PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/mission/generate — SSE stream a generated mission statement (must be before /:id)
router.post('/mission/generate', async (req, res) => {
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers) || answers.length < 4) {
      return res.status(400).json({ error: 'answers array of length 4 required' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const prompt = `Based on these answers about a person's roles, character traits, lifetime contributions, and guiding principles, write a personal mission statement that is 2–4 sentences, inspiring, personal, and written in the first person. Focus on being and contributing, not just achieving. Return only the mission statement text with no preamble or explanation.\n\nAnswers:\n1. Roles: ${answers[0]}\n2. Character traits: ${answers[1]}\n3. Lifetime contributions: ${answers[2]}\n4. Guiding principles: ${answers[3]}`;
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    stream.on('text', (text) => { res.write(`data: ${JSON.stringify(text)}\n\n`); });
    stream.on('finalMessage', () => { res.write('data: [DONE]\n\n'); res.end(); });
    stream.on('error', (err) => {
      console.error('[goals mission generate]', err);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    console.error('[goals mission generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/renewal-assessment — SSE: stream renewal balance assessment (must be before /:id)
router.post('/renewal-assessment', async (req, res) => {
  try {
    const { dimensions } = req.body;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const summary = Object.entries(dimensions || {})
      .map(([k, v]) => `${k}: ${v.taskCount || 0} task(s), ${v.objectiveCount || 0} objective(s)`)
      .join('; ');
    const prompt = `A person's current renewal dimension balance (Habit 7 — Sharpen the Saw):\n${summary}\n\nThe 4 renewal dimensions: Physical (body, health, exercise), Mental (learning, reading, creativity), Social/Emotional (relationships, empathy, giving), Spiritual (mission, values, reflection).\n\nIn 2-3 sentences, give a warm and practical assessment of their balance. If one dimension is significantly lower than others, suggest one specific action they could take this week to strengthen it. Be encouraging and brief.`;
    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });
    stream.on('text', (text) => { res.write(`data: ${JSON.stringify(text)}\n\n`); });
    stream.on('finalMessage', () => { res.write('data: [DONE]\n\n'); res.end(); });
    stream.on('error', (err) => { console.error('[goals renewal-assessment]', err); res.write('data: [DONE]\n\n'); res.end(); });
  } catch (err) {
    console.error('[goals renewal-assessment]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals — create objective
router.post('/', async (req, res) => {
  try {
    const { title, description, timeframe, color, renewalDimension } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      'INSERT INTO objectives (title, description, timeframe, color, "renewalDimension") VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title.trim(), description || null, timeframe || null, color || '#6366f1', renewalDimension || null]
    );
    const { rows: obj } = await pool.query('SELECT * FROM objectives WHERE id = $1', [rows[0].id]);
    res.status(201).json(await buildObjective(obj[0]));
  } catch (err) {
    console.error('[goals POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/:id — single objective with KRs
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM objectives WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Objective not found' });
    res.json(await buildObjective(rows[0]));
  } catch (err) {
    console.error('[goals GET /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/goals/:id — update objective
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM objectives WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Objective not found' });
    const obj = existing[0];
    const { title, description, timeframe, color, status, renewalDimension } = req.body;
    await pool.query(
      `UPDATE objectives SET title=$1, description=$2, timeframe=$3, color=$4, status=$5, "renewalDimension"=$6, "updatedAt"=NOW() WHERE id=$7`,
      [
        title ?? obj.title,
        description !== undefined ? description : obj.description,
        timeframe !== undefined ? timeframe : obj.timeframe,
        color ?? obj.color,
        status ?? obj.status,
        renewalDimension !== undefined ? (renewalDimension || null) : obj.renewalDimension,
        obj.id,
      ]
    );
    const { rows: updated } = await pool.query('SELECT * FROM objectives WHERE id = $1', [obj.id]);
    res.json(await buildObjective(updated[0]));
  } catch (err) {
    console.error('[goals PUT /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/goals/:id — delete objective
router.delete('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM objectives WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Objective not found' });
    const obj = existing[0];
    // Unlink tasks from KRs belonging to this objective
    const { rows: krs } = await pool.query('SELECT id FROM key_results WHERE "objectiveId" = $1', [obj.id]);
    for (const kr of krs) {
      await pool.query('UPDATE tasks SET "keyResultId" = NULL WHERE "keyResultId" = $1', [kr.id]);
    }
    await pool.query('DELETE FROM objectives WHERE id = $1', [obj.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[goals DELETE /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/:id/key-results — add KR to objective
router.post('/:id/key-results', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM objectives WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Objective not found' });
    const { title, targetValue, currentValue, unit, dueDate } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      'INSERT INTO key_results ("objectiveId", title, "targetValue", "currentValue", unit, "dueDate") VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [existing[0].id, title.trim(), targetValue ?? 100, currentValue ?? 0, unit || '%', dueDate || null]
    );
    const { rows: kr } = await pool.query('SELECT * FROM key_results WHERE id = $1', [rows[0].id]);
    res.status(201).json(await buildKeyResult(kr[0]));
  } catch (err) {
    console.error('[goals KR POST]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
