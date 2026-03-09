const express = require('express');
const router = express.Router();
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { buildTypeConfigPrompt } = require('../typePrompts');

const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isGemini(modelId) { return typeof modelId === 'string' && modelId.startsWith('gemini-'); }

function buildSystemPrompt(project, personaId) {
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
    const pinnedFiles = db.prepare('SELECT * FROM files WHERE projectId=? AND pinned=1').all(project.id);
    if (pinnedFiles.length > 0) {
      const blocks = pinnedFiles.map(f =>
        f.extractedText
          ? `[Pinned file: ${f.name}]\n${f.extractedText.substring(0, 4000)}`
          : `[Pinned file: ${f.name} (${f.mimetype})]`
      );
      parts.push(`\nPinned context files:\n${blocks.join('\n\n')}`);
    }

    // Inject pinned URLs
    const pinnedUrls = db.prepare('SELECT * FROM pinned_urls WHERE projectId=?').all(project.id);
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
    const persona = db.prepare('SELECT * FROM personas WHERE id=?').get(resolvedPersonaId);
    if (persona?.systemPrompt) {
      parts.push(`\nPersona — ${persona.name}:\n${persona.systemPrompt}`);
    }
  }

  // Inject persistent memory
  const memories = db.prepare('SELECT content FROM memory ORDER BY createdAt DESC LIMIT 30').all();
  if (memories.length > 0) {
    parts.push(`\nPersistent user memory:\n${memories.map(m => `• ${m.content}`).join('\n')}`);
  }

  return parts.join('\n');
}

function buildMessageContent(text, attachmentIds, urlAttachments, inlineImages) {
  const hasFiles = attachmentIds && attachmentIds.length > 0;
  const hasUrls = urlAttachments && urlAttachments.length > 0;
  const hasInline = inlineImages && inlineImages.length > 0;
  if (!hasFiles && !hasUrls && !hasInline) return text;

  const blocks = [];

  for (const img of (inlineImages || [])) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
  }

  for (const fileId of (attachmentIds || [])) {
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
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
  // Anthropic credit exhaustion — status 402 or 403 with billing message
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

  const project = projectId ? db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) : null;
  const systemPrompt = buildSystemPrompt(project, personaId);
  const sid = sessionId || `session-${Date.now()}`;

  // Check if this session is summarized
  const sessionMeta = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(sid);

  let apiMessages;
  if (sessionMeta?.isSummarized && sessionMeta?.summaryContent) {
    // Use summary + messages sent AFTER summarization
    const postSummaryMsgs = sessionMeta.summarizedAt
      ? db.prepare('SELECT role, content FROM messages WHERE sessionId=? AND createdAt > ? ORDER BY createdAt ASC')
          .all(sid, sessionMeta.summarizedAt)
      : [];

    const lastUserMsg = messages[messages.length - 1];
    apiMessages = [
      { role: 'user', content: `[Summary of previous conversation]\n\n${sessionMeta.summaryContent}` },
      { role: 'assistant', content: 'Understood. I have the full context from the previous conversation. Please continue.' },
      ...postSummaryMsgs,
    ];
    if (lastUserMsg?.role === 'user' && (attachmentIds?.length || urlAttachments?.length || inlineImages?.length)) {
      apiMessages.push({ role: 'user', content: buildMessageContent(lastUserMsg.content, attachmentIds, urlAttachments, inlineImages) });
    } else if (lastUserMsg) {
      apiMessages.push({ role: lastUserMsg.role, content: lastUserMsg.content });
    }
  } else {
    apiMessages = messages.map((m, i) => {
      const isLast = i === messages.length - 1;
      if (isLast && m.role === 'user' && (attachmentIds?.length || urlAttachments?.length || inlineImages?.length)) {
        return { role: 'user', content: buildMessageContent(m.content, attachmentIds, urlAttachments, inlineImages) };
      }
      return { role: m.role, content: m.content };
    });
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

      // Convert messages to Gemini format (role: 'user' | 'model')
      // Last message is sent via sendMessageStream; history is everything before it
      const history = apiMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      }));

      const lastMsg = apiMessages[apiMessages.length - 1];
      // Build parts for last message (may include image attachments)
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

    // Persist messages (also for general chats where projectId is null)
    if (messages.length > 0) {
      const lastUser = messages[messages.length - 1];
      if (lastUser.role === 'user') {
        let storedContent = lastUser.content;
        if (attachmentIds?.length) {
          const names = attachmentIds.map(id => {
            const f = db.prepare('SELECT name FROM files WHERE id=?').get(id);
            return f ? f.name : `file#${id}`;
          });
          storedContent = `[Files: ${names.join(', ')}]\n${storedContent}`;
        }
        if (inlineImages?.length) {
          storedContent = `[Pasted image${inlineImages.length > 1 ? 's' : ''}: ${inlineImages.length}]\n${storedContent}`;
        }
        db.prepare('INSERT INTO messages (sessionId, projectId, role, content) VALUES (?, ?, ?, ?)')
          .run(sid, projectId, 'user', storedContent);
        db.prepare('INSERT INTO messages (sessionId, projectId, role, content) VALUES (?, ?, ?, ?)')
          .run(sid, projectId, 'assistant', fullContent);
        if (projectId) {
          db.prepare('INSERT INTO search_index(type, projectId, title, body) VALUES (?, ?, ?, ?)')
            .run('message', String(projectId), `Chat: ${sid}`, fullContent.substring(0, 500));
        }

        // Update token counts for session
        if (inputTokens || outputTokens) {
          const existingSession = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(sid);
          if (existingSession) {
            db.prepare('UPDATE sessions SET inputTokens=inputTokens+?, outputTokens=outputTokens+? WHERE sessionId=?')
              .run(inputTokens, outputTokens, sid);
          } else {
            db.prepare('INSERT INTO sessions (sessionId, projectId, inputTokens, outputTokens) VALUES (?, ?, ?, ?)')
              .run(sid, projectId, inputTokens, outputTokens);
          }
        }

        // Auto-title new sessions (first message pair)
        const msgCount = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE sessionId=?').get(sid)?.cnt || 0;
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
              db.prepare('INSERT OR REPLACE INTO sessions (sessionId, projectId, title) VALUES (?, ?, ?)')
                .run(sid, projectId, title);
            }
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    const classified = classifyStreamError(err);
    console.error(`[chat] Stream error — model: ${reqModel || 'default'}, code: ${classified.code} —`, err.message);
    res.write(`data: ${JSON.stringify({ streamError: classified })}\n\n`);
    res.end();
  }
});

// GET /api/chat/sessions/general — sessions with no project (must be before :projectId)
router.get('/sessions/general', (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT m.sessionId, MIN(m.createdAt) as startedAt,
      s.title, COALESCE(s.isSummarized, 0) as isSummarized,
      COALESCE(s.starred, 0) as starred,
      COALESCE(s.inputTokens, 0) as inputTokens,
      COALESCE(s.outputTokens, 0) as outputTokens
    FROM messages m
    LEFT JOIN sessions s ON s.sessionId = m.sessionId
    WHERE m.projectId IS NULL
    GROUP BY m.sessionId ORDER BY COALESCE(s.starred,0) DESC, startedAt DESC
    LIMIT 30
  `).all();
  res.json(rows);
});

// GET /api/chat/all-history?from=ISO&to=ISO — all sessions across all projects
router.get('/all-history', (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || '2000-01-01';
    const toDate = to || '2099-12-31';
    const rows = db.prepare(`
      SELECT
        m.sessionId,
        s.title,
        m.projectId,
        p.name as projectName,
        MAX(m.createdAt) as lastAt,
        (SELECT content FROM messages WHERE sessionId = m.sessionId AND role = 'assistant' ORDER BY createdAt DESC LIMIT 1) as lastMsg
      FROM messages m
      LEFT JOIN sessions s ON s.sessionId = m.sessionId
      LEFT JOIN projects p ON p.id = m.projectId
      WHERE m.createdAt >= ? AND m.createdAt <= ?
      GROUP BY m.sessionId
      ORDER BY lastAt DESC
      LIMIT 300
    `).all(fromDate, toDate);
    res.json(rows);
  } catch (err) {
    console.error('[all-history]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/sessions/:projectId — list sessions for a project
router.get('/sessions/:projectId', (req, res) => {
  const rows = db.prepare(`
    SELECT DISTINCT m.sessionId, MIN(m.createdAt) as startedAt,
      s.title, COALESCE(s.isSummarized, 0) as isSummarized,
      COALESCE(s.starred, 0) as starred,
      COALESCE(s.inputTokens, 0) as inputTokens,
      COALESCE(s.outputTokens, 0) as outputTokens
    FROM messages m
    LEFT JOIN sessions s ON s.sessionId = m.sessionId
    WHERE m.projectId=?
    GROUP BY m.sessionId ORDER BY COALESCE(s.starred,0) DESC, startedAt DESC
  `).all(req.params.projectId);
  res.json(rows);
});

// GET /api/chat/history/:sessionId
router.get('/history/:sessionId', (req, res) => {
  const msgs = db.prepare('SELECT * FROM messages WHERE sessionId=? ORDER BY createdAt ASC').all(req.params.sessionId);
  res.json(msgs);
});

// GET /api/chat/sessions/:sessionId/summary
router.get('/sessions/:sessionId/summary', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(req.params.sessionId);
  res.json({
    isSummarized: session?.isSummarized ? true : false,
    summaryContent: session?.summaryContent || null,
  });
});

// PATCH /api/chat/sessions/:sessionId/title
router.patch('/sessions/:sessionId/title', (req, res) => {
  const { title } = req.body;
  const existing = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(req.params.sessionId);
  if (existing) {
    db.prepare('UPDATE sessions SET title=?, updatedAt=datetime(\'now\') WHERE sessionId=?')
      .run(title || '', req.params.sessionId);
  } else {
    db.prepare('INSERT INTO sessions (sessionId, title) VALUES (?, ?)').run(req.params.sessionId, title || '');
  }
  res.json({ ok: true });
});

// DELETE /api/chat/sessions/:sessionId/summary — revert to full thread
router.delete('/sessions/:sessionId/summary', (req, res) => {
  db.prepare('UPDATE sessions SET isSummarized=0, summaryContent=NULL, summarizedAt=NULL WHERE sessionId=?')
    .run(req.params.sessionId);
  res.json({ ok: true });
});

// POST /api/chat/sessions/:sessionId/summarize
router.post('/sessions/:sessionId/summarize', async (req, res) => {
  const { sessionId } = req.params;
  const msgs = db.prepare('SELECT * FROM messages WHERE sessionId=? ORDER BY createdAt ASC').all(sessionId);
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
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const existing = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(sessionId);
    if (existing) {
      db.prepare('UPDATE sessions SET isSummarized=1, summaryContent=?, summarizedAt=? WHERE sessionId=?')
        .run(summary, now, sessionId);
    } else {
      const pid = msgs[0]?.projectId;
      db.prepare('INSERT INTO sessions (sessionId, projectId, isSummarized, summaryContent, summarizedAt) VALUES (?, ?, 1, ?, ?)')
        .run(sessionId, pid, summary, now);
    }
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/messages/pair — delete a user+assistant pair by position
router.delete('/messages/pair', (req, res) => {
  const { sessionId, startIndex } = req.body;
  if (!sessionId || startIndex == null) return res.status(400).json({ error: 'sessionId and startIndex required' });
  const msgs = db.prepare('SELECT id FROM messages WHERE sessionId=? ORDER BY id ASC').all(sessionId);
  const toDelete = [msgs[startIndex], msgs[startIndex + 1]].filter(Boolean);
  for (const msg of toDelete) db.prepare('DELETE FROM messages WHERE id=?').run(msg.id);
  res.json({ deleted: toDelete.length });
});

// DELETE /api/chat/sessions/:sessionId — delete session + all its messages
router.delete('/sessions/:sessionId', (req, res) => {
  db.prepare('DELETE FROM messages WHERE sessionId=?').run(req.params.sessionId);
  db.prepare('DELETE FROM sessions WHERE sessionId=?').run(req.params.sessionId);
  res.json({ ok: true });
});

// PATCH /api/chat/sessions/:sessionId/star — toggle starred
router.patch('/sessions/:sessionId/star', (req, res) => {
  const existing = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(req.params.sessionId);
  if (existing) {
    const newVal = existing.starred ? 0 : 1;
    db.prepare('UPDATE sessions SET starred=? WHERE sessionId=?').run(newVal, req.params.sessionId);
    res.json({ starred: !!newVal });
  } else {
    db.prepare('INSERT INTO sessions (sessionId, starred) VALUES (?, 1)').run(req.params.sessionId);
    res.json({ starred: true });
  }
});

// POST /api/chat/sessions/:sessionId/branch — copy messages up to an index into a new session
router.post('/sessions/:sessionId/branch', (req, res) => {
  const { messageIndex } = req.body; // branch includes messages[0..messageIndex] inclusive
  if (messageIndex == null) return res.status(400).json({ error: 'messageIndex required' });

  const msgs = db.prepare('SELECT * FROM messages WHERE sessionId=? ORDER BY createdAt ASC').all(req.params.sessionId);
  const toKeep = msgs.slice(0, messageIndex + 1);
  if (toKeep.length === 0) return res.status(400).json({ error: 'No messages to branch' });

  const session = db.prepare('SELECT * FROM sessions WHERE sessionId=?').get(req.params.sessionId);
  const newSessionId = `branch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const insertMsg = db.prepare('INSERT INTO messages (sessionId, projectId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)');
  const insertSession = db.prepare(
    'INSERT INTO sessions (sessionId, projectId, title, branchedFrom) VALUES (?, ?, ?, ?)'
  );

  db.transaction(() => {
    insertSession.run(
      newSessionId,
      session?.projectId || toKeep[0]?.projectId || null,
      session?.title ? `Branch of: ${session.title}` : 'Branched chat',
      req.params.sessionId
    );
    for (const msg of toKeep) {
      insertMsg.run(newSessionId, msg.projectId, msg.role, msg.content, msg.createdAt);
    }
  })();

  res.json({ newSessionId });
});

// POST /api/chat/suggestions — generate follow-up suggestions via Haiku
router.post('/suggestions', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ suggestions: [] });

  const msgs = db.prepare('SELECT role, content FROM messages WHERE sessionId=? ORDER BY createdAt DESC LIMIT 6')
    .all(sessionId).reverse();
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
    // Extract JSON array even if wrapped in markdown
    const match = text.match(/\[[\s\S]*\]/);
    const suggestions = match ? JSON.parse(match[0]) : [];
    res.json({ suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 3) : [] });
  } catch {
    res.json({ suggestions: [] });
  }
});

module.exports = router;
