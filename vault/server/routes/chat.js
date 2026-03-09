'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { buildTypeConfigPrompt } = require('../typePrompts');

const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isGemini(modelId) { return typeof modelId === 'string' && modelId.startsWith('gemini-'); }

async function buildSystemPrompt(project, personaId) {
  const parts = project
    ? [`You are an AI assistant for the project "${project.name}".`]
    : ['You are a helpful AI assistant.'];

  if (project) {
    if (project.goal) parts.push(`Goal: ${project.goal}`);
    if (project.problem) parts.push(`Problem being solved: ${project.problem}`);
    if (project.audience) parts.push(`Target audience: ${project.audience}`);
    if (project.techStack) parts.push(`Tech stack: ${project.techStack}`);
    if (project.constraints) parts.push(`Constraints: ${project.constraints}`);
    if (project.successCriteria) parts.push(`Success criteria: ${project.successCriteria}`);
    if (project.tone) parts.push(`Communication tone: ${project.tone}`);
    if (project.notes) parts.push(`Additional notes: ${project.notes}`);
    parts.push('Provide focused, actionable assistance based on this project context.');
    const typeExtra = buildTypeConfigPrompt(project.projectType, project.typeConfig);
    if (typeExtra) parts.push(typeExtra);

    // Inject pinned files
    const { rows: pinnedFiles } = await pool.query(
      'SELECT * FROM files WHERE "projectId"=$1 AND pinned=1', [project.id]
    );
    if (pinnedFiles.length > 0) {
      const blocks = pinnedFiles.map(f =>
        f.extractedText
          ? `[Pinned file: ${f.name}]\n${f.extractedText.substring(0, 4000)}`
          : `[Pinned file: ${f.name} (${f.mimetype})]`
      );
      parts.push(`\nPinned context files:\n${blocks.join('\n\n')}`);
    }

    // Inject pinned URLs
    const { rows: pinnedUrls } = await pool.query(
      'SELECT * FROM pinned_urls WHERE "projectId"=$1', [project.id]
    );
    if (pinnedUrls.length > 0) {
      const blocks = pinnedUrls.map(u =>
        `[Pinned web page: ${u.url}]\nTitle: ${u.title || '(no title)'}\n${(u.content || '').substring(0, 4000)}`
      );
      parts.push(`\nPinned web pages:\n${blocks.join('\n\n')}`);
    }
  }

  // Inject persona
  const resolvedPersonaId = personaId || project?.personaId;
  if (resolvedPersonaId) {
    const { rows: personaRows } = await pool.query('SELECT * FROM personas WHERE id=$1', [resolvedPersonaId]);
    const persona = personaRows[0];
    if (persona?.systemPrompt) {
      parts.push(`\nPersona — ${persona.name}:\n${persona.systemPrompt}`);
    }
  }

  // Inject persistent memory
  const { rows: memories } = await pool.query('SELECT content FROM memory ORDER BY "createdAt" DESC LIMIT 30');
  if (memories.length > 0) {
    parts.push(`\nPersistent user memory:\n${memories.map(m => `• ${m.content}`).join('\n')}`);
  }

  return parts.join('\n');
}

async function buildMessageContent(text, attachmentIds, urlAttachments, inlineImages) {
  const hasFiles = attachmentIds && attachmentIds.length > 0;
  const hasUrls = urlAttachments && urlAttachments.length > 0;
  const hasInline = inlineImages && inlineImages.length > 0;
  if (!hasFiles && !hasUrls && !hasInline) return text;

  const blocks = [];

  for (const img of (inlineImages || [])) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
  }

  for (const fileId of (attachmentIds || [])) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [fileId]);
    const file = rows[0];
    if (!file) continue;
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      try {
        const data = fs.readFileSync(file.path).toString('base64');
        blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mimetype, data } });
      } catch (err) {
        console.error('Could not read image file:', err.message);
      }
    } else if (file.extractedText) {
      blocks.push({ type: 'text', text: `[Attached file: ${file.name}]\n\n${file.extractedText.substring(0, 8000)}` });
    } else {
      blocks.push({ type: 'text', text: `[Attached file: ${file.name} (${file.mimetype}) — content not extractable]` });
    }
  }

  for (const ua of (urlAttachments || [])) {
    if (ua.content) {
      const label = ua.url?.startsWith('gmail://') ? 'Email thread' : 'Web page';
      blocks.push({
        type: 'text',
        text: `[${label}: ${ua.title || ua.url}]\n\n${ua.content}`,
      });
    }
  }

  blocks.push({ type: 'text', text });
  return blocks;
}

function classifyStreamError(err) {
  const msg = err.message || '';
  const status = err.status || err.statusCode || 0;
  if (/anthropic_api_key is not configured/i.test(msg)) {
    return { code: 'auth', message: 'Anthropic API key is not configured.', hint: 'Add ANTHROPIC_API_KEY to your Railway environment variables.' };
  }
  if (/gemini_api_key is not configured/i.test(msg)) {
    return { code: 'auth', message: 'Gemini API key is not configured.', hint: 'Add GEMINI_API_KEY to your Railway environment variables.' };
  }
  if (status === 402 || /credit.balance.is.too.low|insufficient.credit/i.test(msg)) {
    return { code: 'billing', message: 'Anthropic credit balance is too low.', hint: 'Top up your account at console.anthropic.com/settings/billing.' };
  }
  if (status === 403 && /credit|billing|payment/i.test(msg)) {
    return { code: 'billing', message: 'Anthropic billing issue — credit balance may be exhausted.', hint: 'Check your account at console.anthropic.com/settings/billing.' };
  }
  if (status === 401 || /invalid.api.key|authentication.error|api.key.not.valid|API_KEY_INVALID/i.test(msg)) {
    return { code: 'auth', message: 'API key is invalid or rejected.', hint: 'Check your ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Railway environment variables.' };
  }
  if (status === 429 || /rate.limit|too.many.request|quota.exceeded|RESOURCE_EXHAUSTED/i.test(msg)) {
    return { code: 'rate_limit', message: 'Rate limit or quota exceeded.', hint: 'Wait a moment and try again, or check your API usage limits.' };
  }
  if (/model.not.found|invalid.model|does not exist|unknown model|models\/.*is not found|not supported.*model/i.test(msg)) {
    return { code: 'model', message: 'Model not found or unavailable.', hint: 'Switch to a different model using the model selector in the chat header.' };
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(msg) || err.code === 'ETIMEDOUT') {
    return { code: 'timeout', message: 'Request timed out.', hint: 'The AI provider may be slow or unreachable. Try again in a moment.' };
  }
  return { code: 'unknown', message: 'An error occurred while generating the response.', hint: msg || 'Try again. If the problem persists, check the server logs.' };
}

// GET /api/chat/model-status — returns which provider API keys are configured
router.get('/model-status', (req, res) => {
  res.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  });
});

// POST /api/chat/test-model — quick non-streaming test of a single model
router.post('/test-model', async (req, res) => {
  const { modelId } = req.body;
  if (!modelId) return res.status(400).json({ ok: false, error: 'modelId required' });
  try {
    if (isGemini(modelId)) {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) return res.json({ ok: false, code: 'auth', error: 'GEMINI_API_KEY is not configured.' });
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genai = new GoogleGenerativeAI(geminiApiKey);
      const gModel = genai.getGenerativeModel({ model: modelId });
      const result = await gModel.generateContent('Reply with only the word "ok".');
      const text = result.response.text().trim();
      res.json({ ok: true, response: text });
    } else {
      if (!process.env.ANTHROPIC_API_KEY) return res.json({ ok: false, code: 'auth', error: 'ANTHROPIC_API_KEY is not configured.' });
      const response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with only the word "ok".' }],
      });
      const text = response.content[0]?.text?.trim() || '';
      res.json({ ok: true, response: text });
    }
  } catch (err) {
    const classified = classifyStreamError(err);
    res.json({ ok: false, code: classified.code, error: classified.message, hint: classified.hint });
  }
});

// POST /api/chat
router.post('/', chatLimiter, async (req, res) => {
  const { messages, projectId, sessionId, attachmentIds, urlAttachments, inlineImages, model: reqModel, temperature: reqTemp, personaId, reasoning } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Async setup — runs before SSE headers are set so errors return JSON 500
  const { rows: projRows } = projectId
    ? await pool.query('SELECT * FROM projects WHERE id=$1', [projectId])
    : { rows: [] };
  const project = projRows[0] || null;
  const systemPrompt = await buildSystemPrompt(project, personaId);
  const sid = sessionId || `session-${Date.now()}`;

  // Check if this session is summarized
  const { rows: sessionRows } = await pool.query('SELECT * FROM sessions WHERE "sessionId"=$1', [sid]);
  const sessionMeta = sessionRows[0] || null;

  let apiMessages;
  if (sessionMeta?.isSummarized && sessionMeta?.summaryContent) {
    let postSummaryMsgs = [];
    if (sessionMeta.summarizedAt) {
      const { rows } = await pool.query(
        'SELECT role, content FROM messages WHERE "sessionId"=$1 AND "createdAt" > $2 ORDER BY "createdAt" ASC',
        [sid, sessionMeta.summarizedAt]
      );
      postSummaryMsgs = rows;
    }

    const lastUserMsg = messages[messages.length - 1];
    apiMessages = [
      { role: 'user', content: `[Summary of previous conversation]\n\n${sessionMeta.summaryContent}` },
      { role: 'assistant', content: 'Understood. I have the full context from the previous conversation. Please continue.' },
      ...postSummaryMsgs,
    ];
    if (lastUserMsg?.role === 'user' && (attachmentIds?.length || urlAttachments?.length || inlineImages?.length)) {
      apiMessages.push({ role: 'user', content: await buildMessageContent(lastUserMsg.content, attachmentIds, urlAttachments, inlineImages) });
    } else if (lastUserMsg) {
      apiMessages.push({ role: lastUserMsg.role, content: lastUserMsg.content });
    }
  } else {
    apiMessages = await Promise.all(messages.map(async (m, i) => {
      const isLast = i === messages.length - 1;
      if (isLast && m.role === 'user' && (attachmentIds?.length || urlAttachments?.length || inlineImages?.length)) {
        return { role: 'user', content: await buildMessageContent(m.content, attachmentIds, urlAttachments, inlineImages) };
      }
      return { role: m.role, content: m.content };
    }));
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let fullContent = '';

  try {
    const model = reqModel || project?.model || 'claude-sonnet-4-6';
    const temperature = typeof reqTemp === 'number' ? Math.max(0, Math.min(1, reqTemp)) : 0.7;

    let inputTokens = 0, outputTokens = 0;

    if (isGemini(model)) {
      // ── Gemini path ──────────────────────────────────────────────────────────
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');

      const genai = new GoogleGenerativeAI(geminiApiKey);
      const gModel = genai.getGenerativeModel({
        model,
        systemInstruction: systemPrompt,
        generationConfig: { temperature, maxOutputTokens: 8192 },
      });

      const history = apiMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }));

      const lastMsg = apiMessages[apiMessages.length - 1];
      let lastParts;
      if (Array.isArray(lastMsg?.content)) {
        lastParts = lastMsg.content.map(block => {
          if (block.type === 'image') {
            return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
          }
          return { text: block.text || '' };
        });
      } else {
        lastParts = [{ text: lastMsg?.content || '' }];
      }

      const chat = gModel.startChat({ history });
      const streamResult = await chat.sendMessageStream(lastParts);

      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) {
          fullContent += text;
          res.write(`data: ${JSON.stringify({ delta: text, sessionId: sid })}\n\n`);
        }
      }

      const finalResponse = await streamResult.response;
      inputTokens = finalResponse.usageMetadata?.promptTokenCount || 0;
      outputTokens = finalResponse.usageMetadata?.candidatesTokenCount || 0;

    } else {
      // ── Anthropic path ───────────────────────────────────────────────────────
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
      const useReasoning = reasoning && (model.includes('sonnet') || model.includes('opus'));
      const streamParams = {
        model,
        max_tokens: useReasoning ? 16000 : 8096,
        system: systemPrompt,
        messages: apiMessages,
      };
      if (useReasoning) {
        streamParams.thinking = { type: 'enabled', budget_tokens: 8000 };
      } else {
        streamParams.temperature = temperature;
      }
      const stream = anthropic.messages.stream(streamParams);

      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          inputTokens = chunk.message?.usage?.input_tokens || 0;
        }
        if (chunk.type === 'message_delta' && chunk.usage) {
          outputTokens = chunk.usage.output_tokens || 0;
        }
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta?.type === 'thinking_delta') {
            res.write(`data: ${JSON.stringify({ thinkingDelta: chunk.delta.thinking, sessionId: sid })}\n\n`);
          } else if (chunk.delta?.type === 'text_delta') {
            const text = chunk.delta.text;
            fullContent += text;
            res.write(`data: ${JSON.stringify({ delta: text, sessionId: sid })}\n\n`);
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ usage: { inputTokens, outputTokens, model } })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();

    // Persist messages — wrapped separately so errors don't write to ended response
    try {
      if (messages.length > 0) {
        const lastUser = messages[messages.length - 1];
        if (lastUser.role === 'user') {
          let storedContent = lastUser.content;
          if (attachmentIds?.length) {
            const names = await Promise.all(attachmentIds.map(async id => {
              const { rows } = await pool.query('SELECT name FROM files WHERE id=$1', [id]);
              return rows[0] ? rows[0].name : `file#${id}`;
            }));
            storedContent = `[Files: ${names.join(', ')}]\n${storedContent}`;
          }
          if (inlineImages?.length) {
            storedContent = `[Pasted image${inlineImages.length > 1 ? 's' : ''}: ${inlineImages.length}]\n${storedContent}`;
          }
          await pool.query(
            'INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,$3,$4)',
            [sid, projectId, 'user', storedContent]
          );
          await pool.query(
            'INSERT INTO messages ("sessionId","projectId",role,content) VALUES ($1,$2,$3,$4)',
            [sid, projectId, 'assistant', fullContent]
          );
          if (projectId) {
            await pool.query(
              'INSERT INTO search_index(type,"projectId",title,body) VALUES ($1,$2,$3,$4)',
              ['message', String(projectId), `Chat: ${sid}`, fullContent.substring(0, 500)]
            );
          }

          // Update token counts for session
          if (inputTokens || outputTokens) {
            const { rows: existRows } = await pool.query('SELECT "sessionId" FROM sessions WHERE "sessionId"=$1', [sid]);
            if (existRows[0]) {
              await pool.query(
                'UPDATE sessions SET "inputTokens"="inputTokens"+$1,"outputTokens"="outputTokens"+$2 WHERE "sessionId"=$3',
                [inputTokens, outputTokens, sid]
              );
            } else {
              await pool.query(
                'INSERT INTO sessions ("sessionId","projectId","inputTokens","outputTokens") VALUES ($1,$2,$3,$4)',
                [sid, projectId, inputTokens, outputTokens]
              );
            }
          }

          // Auto-title new sessions (first message pair)
          const { rows: countRows } = await pool.query('SELECT COUNT(*) as cnt FROM messages WHERE "sessionId"=$1', [sid]);
          const msgCount = Number(countRows[0]?.cnt || 0);
          if (msgCount <= 2 && !sessionMeta?.title) {
            anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 12,
              messages: [{
                role: 'user',
                content: `Give a 2–4 word title for a chat starting with: "${lastUser.content.substring(0, 250)}". Reply with only the title, no punctuation.`,
              }],
            }).then(r => {
              const title = r.content[0]?.text?.trim() || '';
              if (title) {
                pool.query(
                  'INSERT INTO sessions ("sessionId","projectId",title) VALUES ($1,$2,$3) ON CONFLICT ("sessionId") DO UPDATE SET title=EXCLUDED.title',
                  [sid, projectId, title]
                ).catch(() => {});
              }
            }).catch(() => {});
          }
        }
      }
    } catch (persistErr) {
      console.error('[chat] Persistence error:', persistErr);
    }
  } catch (err) {
    const classified = classifyStreamError(err);
    console.error(`[chat] Stream error — model: ${reqModel || 'default'}, code: ${classified.code} —`, err.message);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ streamError: classified })}\n\n`);
      res.end();
    }
  }
});

// GET /api/chat/sessions/general — sessions with no project (must be before :projectId)
router.get('/sessions/general', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m."sessionId", MIN(m."createdAt") as "startedAt",
        s.title, COALESCE(s."isSummarized", 0) as "isSummarized",
        COALESCE(s.starred, 0) as starred,
        COALESCE(s."inputTokens", 0) as "inputTokens",
        COALESCE(s."outputTokens", 0) as "outputTokens"
      FROM messages m
      LEFT JOIN sessions s ON s."sessionId" = m."sessionId"
      WHERE m."projectId" IS NULL
      GROUP BY m."sessionId", s."sessionId"
      ORDER BY COALESCE(s.starred,0) DESC, MIN(m."createdAt") DESC
      LIMIT 30
    `);
    res.json(rows);
  } catch (err) {
    console.error('[sessions/general]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/all-history?from=ISO&to=ISO — all sessions across all projects
router.get('/all-history', async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || '2000-01-01';
    const toDate = to || '2099-12-31';
    const { rows } = await pool.query(`
      SELECT
        m."sessionId",
        MIN(s.title) as title,
        MIN(m."projectId") as "projectId",
        MIN(p.name) as "projectName",
        MAX(m."createdAt") as "lastAt",
        (SELECT content FROM messages m2 WHERE m2."sessionId" = m."sessionId" AND m2.role = 'assistant' ORDER BY m2."createdAt" DESC LIMIT 1) as "lastMsg"
      FROM messages m
      LEFT JOIN sessions s ON s."sessionId" = m."sessionId"
      LEFT JOIN projects p ON p.id = m."projectId"
      WHERE m."createdAt" >= $1 AND m."createdAt" <= $2
      GROUP BY m."sessionId"
      ORDER BY MAX(m."createdAt") DESC
      LIMIT 300
    `, [fromDate, toDate]);
    res.json(rows);
  } catch (err) {
    console.error('[all-history]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/sessions/:projectId — list sessions for a project
router.get('/sessions/:projectId', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m."sessionId", MIN(m."createdAt") as "startedAt",
        s.title, COALESCE(s."isSummarized", 0) as "isSummarized",
        COALESCE(s.starred, 0) as starred,
        COALESCE(s."inputTokens", 0) as "inputTokens",
        COALESCE(s."outputTokens", 0) as "outputTokens"
      FROM messages m
      LEFT JOIN sessions s ON s."sessionId" = m."sessionId"
      WHERE m."projectId"=$1
      GROUP BY m."sessionId", s."sessionId"
      ORDER BY COALESCE(s.starred,0) DESC, MIN(m."createdAt") DESC
    `, [req.params.projectId]);
    res.json(rows);
  } catch (err) {
    console.error('[sessions/:projectId]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/history/:sessionId
router.get('/history/:sessionId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" ASC',
      [req.params.sessionId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/sessions/:sessionId/summary
router.get('/sessions/:sessionId/summary', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT "isSummarized","summaryContent" FROM sessions WHERE "sessionId"=$1',
      [req.params.sessionId]
    );
    const session = rows[0];
    res.json({
      isSummarized: session?.isSummarized ? true : false,
      summaryContent: session?.summaryContent || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/chat/sessions/:sessionId/title
router.patch('/sessions/:sessionId/title', async (req, res) => {
  try {
    const { title } = req.body;
    const { rows } = await pool.query('SELECT "sessionId" FROM sessions WHERE "sessionId"=$1', [req.params.sessionId]);
    if (rows[0]) {
      await pool.query('UPDATE sessions SET title=$1,"updatedAt"=NOW() WHERE "sessionId"=$2', [title || '', req.params.sessionId]);
    } else {
      await pool.query('INSERT INTO sessions ("sessionId",title) VALUES ($1,$2)', [req.params.sessionId, title || '']);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/sessions/:sessionId/summary — revert to full thread
router.delete('/sessions/:sessionId/summary', async (req, res) => {
  try {
    await pool.query(
      'UPDATE sessions SET "isSummarized"=0,"summaryContent"=NULL,"summarizedAt"=NULL WHERE "sessionId"=$1',
      [req.params.sessionId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:sessionId/summarize
router.post('/sessions/:sessionId/summarize', async (req, res) => {
  const { sessionId } = req.params;
  const { rows: msgs } = await pool.query(
    'SELECT * FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" ASC',
    [sessionId]
  );
  if (msgs.length === 0) return res.status(400).json({ error: 'No messages to summarize' });

  const conversationText = msgs
    .map(m => `${m.role === 'user' ? 'User' : 'Claude'}: ${m.content}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Create a comprehensive summary of this conversation that captures all key decisions, context, facts, and next steps. The summary will replace the full thread as Claude's context for continuing — so make it complete enough that nothing important is lost:\n\n${conversationText}`,
      }],
    });
    const summary = response.content[0]?.text || '';
    const { rows: existing } = await pool.query('SELECT "sessionId" FROM sessions WHERE "sessionId"=$1', [sessionId]);
    if (existing[0]) {
      await pool.query(
        'UPDATE sessions SET "isSummarized"=1,"summaryContent"=$1,"summarizedAt"=NOW() WHERE "sessionId"=$2',
        [summary, sessionId]
      );
    } else {
      const pid = msgs[0]?.projectId;
      await pool.query(
        'INSERT INTO sessions ("sessionId","projectId","isSummarized","summaryContent","summarizedAt") VALUES ($1,$2,1,$3,NOW())',
        [sessionId, pid, summary]
      );
    }
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/messages/pair — delete a user+assistant pair by position
router.delete('/messages/pair', async (req, res) => {
  try {
    const { sessionId, startIndex } = req.body;
    if (!sessionId || startIndex == null) return res.status(400).json({ error: 'sessionId and startIndex required' });
    const { rows: msgs } = await pool.query('SELECT id FROM messages WHERE "sessionId"=$1 ORDER BY id ASC', [sessionId]);
    const toDelete = [msgs[startIndex], msgs[startIndex + 1]].filter(Boolean);
    for (const msg of toDelete) await pool.query('DELETE FROM messages WHERE id=$1', [msg.id]);
    res.json({ deleted: toDelete.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/sessions/:sessionId — delete session + all its messages
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE "sessionId"=$1', [req.params.sessionId]);
    await pool.query('DELETE FROM sessions WHERE "sessionId"=$1', [req.params.sessionId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/chat/sessions/:sessionId/star — toggle starred
router.patch('/sessions/:sessionId/star', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sessions WHERE "sessionId"=$1', [req.params.sessionId]);
    if (rows[0]) {
      const newVal = rows[0].starred ? 0 : 1;
      await pool.query('UPDATE sessions SET starred=$1 WHERE "sessionId"=$2', [newVal, req.params.sessionId]);
      res.json({ starred: !!newVal });
    } else {
      await pool.query('INSERT INTO sessions ("sessionId",starred) VALUES ($1,1)', [req.params.sessionId]);
      res.json({ starred: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/sessions/:sessionId/branch — copy messages up to an index into a new session
router.post('/sessions/:sessionId/branch', async (req, res) => {
  try {
    const { messageIndex } = req.body;
    if (messageIndex == null) return res.status(400).json({ error: 'messageIndex required' });

    const { rows: msgs } = await pool.query(
      'SELECT * FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" ASC',
      [req.params.sessionId]
    );
    const toKeep = msgs.slice(0, messageIndex + 1);
    if (toKeep.length === 0) return res.status(400).json({ error: 'No messages to branch' });

    const { rows: sessionRows } = await pool.query('SELECT * FROM sessions WHERE "sessionId"=$1', [req.params.sessionId]);
    const session = sessionRows[0];
    const newSessionId = `branch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO sessions ("sessionId","projectId",title,"branchedFrom") VALUES ($1,$2,$3,$4)',
        [
          newSessionId,
          session?.projectId || toKeep[0]?.projectId || null,
          session?.title ? `Branch of: ${session.title}` : 'Branched chat',
          req.params.sessionId,
        ]
      );
      for (const msg of toKeep) {
        await client.query(
          'INSERT INTO messages ("sessionId","projectId",role,content,"createdAt") VALUES ($1,$2,$3,$4,$5)',
          [newSessionId, msg.projectId, msg.role, msg.content, msg.createdAt]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ newSessionId });
  } catch (err) {
    console.error('[branch]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/suggestions — generate follow-up suggestions via Haiku
router.post('/suggestions', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ suggestions: [] });

  const { rows: msgRows } = await pool.query(
    'SELECT role, content FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" DESC LIMIT 6',
    [sessionId]
  );
  const msgs = msgRows.reverse();
  if (msgs.length === 0) return res.json({ suggestions: [] });

  const conversationSnippet = msgs
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 400)}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      messages: [{
        role: 'user',
        content: `Based on this conversation, suggest exactly 3 short follow-up questions or requests (max 8 words each). Return a JSON array of strings only, no other text.\n\n${conversationSnippet}`,
      }],
    });
    const text = response.content[0]?.text?.trim() || '[]';
    const match = text.match(/\[[\s\S]*\]/);
    const suggestions = match ? JSON.parse(match[0]) : [];
    res.json({ suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 3) : [] });
  } catch {
    res.json({ suggestions: [] });
  }
});

module.exports = router;
