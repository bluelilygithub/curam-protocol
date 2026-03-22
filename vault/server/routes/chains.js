'use strict';

const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool } = require('../db');
const { getModelsForUser } = require('../services/modelResolver');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isGemini(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('gemini-');
}

// Substitute {{input}}, {{output}}, {{step_N}} in a prompt template
function resolveTemplate(template, initialInput, outputs) {
  let result = template;
  result = result.replace(/\{\{input\}\}/gi, initialInput || '');
  const prevOutput = outputs.length > 0 ? outputs[outputs.length - 1] : '';
  result = result.replace(/\{\{output\}\}/gi, prevOutput);
  outputs.forEach((out, i) => {
    result = result.replace(new RegExp(`\\{\\{step_${i + 1}\\}\\}`, 'gi'), out);
  });
  return result;
}

// GET /api/chains
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM prompt_chains WHERE "userId"=$1 ORDER BY "createdAt" DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chains/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM prompt_chains WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chains
router.post('/', async (req, res) => {
  const { name, description = '', steps = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO prompt_chains (name, description, steps, "userId")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), description, JSON.stringify(steps), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chains/:id
router.put('/:id', async (req, res) => {
  const { name, description, steps } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT id FROM prompt_chains WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      `UPDATE prompt_chains SET name=$1, description=$2, steps=$3, "updatedAt"=NOW()
       WHERE id=$4 RETURNING *`,
      [name, description, JSON.stringify(steps), req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chains/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM prompt_chains WHERE id=$1 AND "userId"=$2 RETURNING id', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chains/:id/run  (SSE)
router.post('/:id/run', async (req, res) => {
  let chain;
  try {
    const { rows } = await pool.query('SELECT * FROM prompt_chains WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    chain = rows[0];
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const steps = JSON.parse(chain.steps || '[]');
  if (steps.length === 0) return res.status(400).json({ error: 'Chain has no steps' });

  const { input = '' } = req.body;
  const { standard: standardModel } = await getModelsForUser(req.user?.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const outputs = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const model = step.model || standardModel;
    const resolvedPrompt = resolveTemplate(step.prompt || '', input, outputs);

    send('step_start', { stepIndex: i, label: step.label || `Step ${i + 1}`, total: steps.length });

    let fullOutput = '';

    try {
      if (isGemini(model)) {
        const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
        const geminiModel = genai.getGenerativeModel({ model });
        const result = await geminiModel.generateContentStream(resolvedPrompt);
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            fullOutput += text;
            send('step_chunk', { stepIndex: i, chunk: text });
          }
        }
      } else {
        const stream = anthropic.messages.stream({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: resolvedPrompt }],
        });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            fullOutput += event.delta.text;
            send('step_chunk', { stepIndex: i, chunk: event.delta.text });
          }
        }
      }

      outputs.push(fullOutput);
      send('step_done', { stepIndex: i, output: fullOutput });
    } catch (err) {
      send('error', { stepIndex: i, message: err.message });
      res.end();
      return;
    }
  }

  send('chain_done', { outputs });
  res.end();
});

module.exports = router;
