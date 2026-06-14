'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const { callModel } = require('../services/callModel');
const { getModelsForUser } = require('../services/modelResolver');
const { logUsage } = require('../utils/logUsage');

const anthropic = new Anthropic();

async function callModelWithUsage(req, modelId, prompt, options = {}) {
  const result = await callModel(modelId, prompt, { ...options, returnUsage: true });
  logUsage({ userId: req.user?.id, model: modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'goals' });
  return result.text;
}

async function streamModelSSE(res, { userId, modelId, system, userContent, maxTokens, onError }) {
  if (!modelId.startsWith('claude-')) {
    try {
      const result = await callModel(modelId, userContent, { maxTokens, ...(system ? { system } : {}), returnUsage: true });
      logUsage({ userId, model: modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'goals' });
      res.write(`data: ${JSON.stringify(result.text || '')}\n\n`);
    } catch (err) {
      if (onError) onError(err);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  const params = { model: modelId, max_tokens: maxTokens, messages: [{ role: 'user', content: userContent }] };
  if (system) params.system = system;
  const stream = anthropic.messages.stream(params);
  stream.on('text', (text) => { res.write(`data: ${JSON.stringify(text)}\n\n`); });
  stream.on('finalMessage', (message) => {
    logUsage({ userId, model: modelId, inputTokens: message?.usage?.input_tokens, outputTokens: message?.usage?.output_tokens, feature: 'goals' });
    res.write('data: [DONE]\n\n');
    res.end();
  });
  stream.on('error', (err) => { if (onError) onError(err); res.write('data: [DONE]\n\n'); res.end(); });
}

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

  // Milestones: tasks marked isMilestone=1 linked to any of this objective's KRs
  const krIds = krRows.map(kr => kr.id);
  let milestones = [];
  if (krIds.length > 0) {
    const placeholders = krIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: msRows } = await pool.query(
      `SELECT id, title, status, "dueDate", "isMilestone"
       FROM tasks
       WHERE "keyResultId" IN (${placeholders}) AND "isMilestone" = 1
       ORDER BY "dueDate" ASC NULLS LAST`,
      krIds
    );
    milestones = msRows;
  }

  return { ...row, keyResults: krs, overallProgress, milestones };
}

// GET /api/goals — list all objectives with nested KRs
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM objectives WHERE "userId"=$1 ORDER BY "createdAt" DESC', [req.user.id]);
    res.json(await Promise.all(rows.map(buildObjective)));
  } catch (err) {
    console.error('[goals GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/goals/dashboard — summary for home widget (must be before /:id)
router.get('/dashboard', async (req, res) => {
  try {
    const { rows: activeRows } = await pool.query("SELECT * FROM objectives WHERE status = 'active' AND \"userId\"=$1", [req.user.id]);
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
      "SELECT COUNT(*) as c FROM objectives WHERE status = 'completed' AND \"userId\"=$1 AND \"updatedAt\" >= $2",
      [req.user.id, startOfMonth.toISOString()]
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
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    await streamModelSSE(res, {
      userId: req.user?.id,
      modelId: lightModel,
      system: 'You are a goal-setting coach specialising in OKR frameworks. Output only JSON objects, one per line.',
      userContent: prompt,
      maxTokens: 500,
      onError: (err) => console.error('[goals ai-suggest]', err),
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
    const { rows } = await pool.query("SELECT value FROM settings WHERE \"userId\"=$1 AND key = 'mission_statement'", [req.user.id]);
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
      "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'mission_statement', $2) ON CONFLICT (\"userId\", key) DO UPDATE SET value=EXCLUDED.value",
      [req.user.id, statement || '']
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
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    await streamModelSSE(res, {
      userId: req.user?.id,
      modelId: lightModel,
      userContent: prompt,
      maxTokens: 300,
      onError: (err) => console.error('[goals mission generate]', err),
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
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    await streamModelSSE(res, {
      userId: req.user?.id,
      modelId: lightModel,
      userContent: prompt,
      maxTokens: 250,
      onError: (err) => console.error('[goals renewal-assessment]', err),
    });
  } catch (err) {
    console.error('[goals renewal-assessment]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Getting Started Wizard endpoints (must be before /:id) ────────────────────

// GET /api/goals/wizard/status
router.get('/wizard/status', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE \"userId\"=$1 AND key = 'getting_started_completed'", [req.user.id]);
    res.json({ completed: rows[0] ? rows[0].value === 'true' : false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/wizard/complete
router.post('/wizard/complete', async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'getting_started_completed', 'true') ON CONFLICT (\"userId\", key) DO UPDATE SET value='true'",
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/wizard/reset (for Settings page "Redo setup")
router.post('/wizard/reset', async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'getting_started_completed', 'false') ON CONFLICT (\"userId\", key) DO UPDATE SET value='false'",
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/reset-setup — reset wizard flag, optionally delete all objectives/KRs
router.post('/reset-setup', async (req, res) => {
  const { deleteObjectives = false } = req.body;
  try {
    // Always reset the completion flag
    await pool.query(
      "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'getting_started_completed', 'false') ON CONFLICT (\"userId\", key) DO UPDATE SET value='false'",
      [req.user.id]
    );

    if (deleteObjectives) {
      // Unlink tasks from KRs belonging to this user's objectives before deleting
      await pool.query(
        `UPDATE tasks SET "keyResultId" = NULL
         WHERE "keyResultId" IN (
           SELECT kr.id FROM key_results kr
           JOIN objectives o ON kr."objectiveId" = o.id
           WHERE o."userId" = $1
         )`,
        [req.user.id]
      );
      // Delete all key results for this user's objectives
      await pool.query(
        `DELETE FROM key_results WHERE "objectiveId" IN (
           SELECT id FROM objectives WHERE "userId" = $1
         )`,
        [req.user.id]
      );
      // Delete all objectives
      await pool.query('DELETE FROM objectives WHERE "userId" = $1', [req.user.id]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[goals reset-setup]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/wizard/generate-mission — SSE stream using personal context
router.post('/wizard/generate-mission', async (req, res) => {
  try {
    const { mattersMost, betterAt, lifeStage } = req.body;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const prompt = `Based on what this person has shared, write a personal mission statement (2–4 sentences, inspiring, first person, focused on being and contributing, not just achieving). Return only the mission statement text.

What matters most to them: ${mattersMost || '(not provided)'}
What they are getting better at: ${betterAt || '(not provided)'}
Their current life stage / context: ${lifeStage || '(not provided)'}`;
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    await streamModelSSE(res, {
      userId: req.user?.id,
      modelId: lightModel,
      userContent: prompt,
      maxTokens: 300,
      onError: (err) => console.error('[wizard generate-mission]', err),
    });
  } catch (err) {
    console.error('[wizard generate-mission]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/wizard/suggest-objective — returns a single objective suggestion
router.post('/wizard/suggest-objective', async (req, res) => {
  try {
    const { mission, mattersMost } = req.body;
    const prompt = `Mission statement: "${mission || '(none yet)'}"
What matters most: "${mattersMost || '(not provided)'}"

Suggest ONE concrete, achievable objective for the next 90 days that aligns with this mission. Return a JSON object with fields: title (string, max 60 chars), description (string, 1 sentence), timeframe (string, e.g. "Q2 2026"), color (one of: #6366f1, #3b82f6, #22c55e, #f59e0b, #ef4444, #8b5cf6). Output only the JSON object, no explanation.`;
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const text = await callModelWithUsage(req, lightModel, prompt, { maxTokens: 200 }) || '{}';
    const match = text.match(/\{[\s\S]*\}/);
    const suggestion = match ? JSON.parse(match[0]) : {};
    res.json(suggestion);
  } catch (err) {
    console.error('[wizard suggest-objective]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/wizard/suggest-krs — returns 3 KR suggestions
router.post('/wizard/suggest-krs', async (req, res) => {
  try {
    const { objectiveTitle, objectiveDescription } = req.body;
    const prompt = `Objective: "${objectiveTitle}"${objectiveDescription ? `\n${objectiveDescription}` : ''}

Suggest exactly 3 SMART Key Results. Output only 3 JSON objects, one per line, with fields: title (string), targetValue (number), unit (string like "%", "tasks", "sessions", "hours", "items"). No markdown, no explanation.`;
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const text = await callModelWithUsage(req, lightModel, prompt, { maxTokens: 300 }) || '';
    const lines = text.split('\n').filter(l => l.trim().startsWith('{'));
    const krs = [];
    for (const line of lines) {
      try { krs.push(JSON.parse(line)); } catch {}
    }
    res.json(krs.slice(0, 3));
  } catch (err) {
    console.error('[wizard suggest-krs]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals/wizard/renewal-observation — SSE, takes slider scores
router.post('/wizard/renewal-observation', async (req, res) => {
  try {
    const { physical, mental, social, spiritual } = req.body;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const prompt = `A person has rated their renewal dimensions (0–10):
Physical: ${physical ?? 5}/10, Mental: ${mental ?? 5}/10, Social: ${social ?? 5}/10, Spiritual: ${spiritual ?? 5}/10

In 2–3 sentences, give a warm personalised observation about their balance. Name the dimension that scored lowest and suggest one small, specific thing they could add to their life this week to strengthen it. Be warm, brief, and encouraging.`;
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    await streamModelSSE(res, {
      userId: req.user?.id,
      modelId: lightModel,
      userContent: prompt,
      maxTokens: 200,
      onError: (err) => console.error('[wizard renewal-observation]', err),
    });
  } catch (err) {
    console.error('[wizard renewal-observation]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/goals — create objective
router.post('/', async (req, res) => {
  try {
    const { title, description, timeframe, color, renewalDimension } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      'INSERT INTO objectives (title, description, timeframe, color, "renewalDimension", "userId") VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [title.trim(), description || null, timeframe || null, color || '#6366f1', renewalDimension || null, req.user.id]
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
    const { rows } = await pool.query('SELECT * FROM objectives WHERE id = $1 AND "userId"=$2', [req.params.id, req.user.id]);
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
    const { rows: existing } = await pool.query('SELECT * FROM objectives WHERE id = $1 AND "userId"=$2', [req.params.id, req.user.id]);
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
    const { rows: existing } = await pool.query('SELECT * FROM objectives WHERE id = $1 AND "userId"=$2', [req.params.id, req.user.id]);
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
    const { rows: existing } = await pool.query('SELECT * FROM objectives WHERE id = $1 AND "userId"=$2', [req.params.id, req.user.id]);
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
