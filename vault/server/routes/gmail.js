const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { translateToGmailQuery, GMAIL_LIMITS } = require('../services/gmailNLP');
const { encrypt, decrypt } = require('../utils/encryption');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const gmailAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many auth requests, please try again later.' },
});

const gmailSearchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many search requests, please try again later.' },
});

const gmailThreadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests, please try again later.' },
});

const gmailAskLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many ask requests, please try again later.' },
});

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Apply requireAuth to all routes except /callback
router.use((req, res, next) => {
  if (req.path === '/callback') return next();
  return requireAuth(req, res, next);
});

// GET /api/gmail/status
router.get('/status', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ connected: false, configured: false, email: null });
  }
  const row = db.prepare('SELECT email FROM gmail_tokens WHERE userId=?').get(req.user.id);
  res.json({ connected: !!row, configured: true, email: row?.email || null });
});

// GET /api/gmail/auth — generate OAuth URL
router.get('/auth', gmailAuthLimiter, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(400).json({ error: 'Gmail OAuth not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to environment variables.' });
  }

  const state = require('crypto').randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(`gmail_oauth_state_${state}`, JSON.stringify({ userId: req.user.id, expiresAt }));

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
    prompt: 'consent',
  });

  res.json({ authUrl });
});

// GET /api/gmail/callback — OAuth callback (no auth — called by Google)
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  if (error) {
    return res.redirect(`${appUrl}/settings?gmailError=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${appUrl}/settings?gmailError=missing_params`);
  }

  const stateKey = `gmail_oauth_state_${state}`;
  const stateRow = db.prepare('SELECT value FROM settings WHERE key=?').get(stateKey);
  if (!stateRow) {
    return res.redirect(`${appUrl}/settings?gmailError=invalid_state`);
  }

  let userId, expiresAt;
  try {
    ({ userId, expiresAt } = JSON.parse(stateRow.value));
  } catch {
    return res.redirect(`${appUrl}/settings?gmailError=invalid_state`);
  }

  if (new Date(expiresAt) < new Date()) {
    db.prepare('DELETE FROM settings WHERE key=?').run(stateKey);
    return res.redirect(`${appUrl}/settings?gmailError=state_expired`);
  }
  db.prepare('DELETE FROM settings WHERE key=?').run(stateKey);

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2Api.userinfo.get();
    const email = userInfo.data.email;

    const existing = db.prepare('SELECT id, refreshToken FROM gmail_tokens WHERE userId=?').get(userId);
    if (existing) {
      // Decrypt the stored refresh token before using it as a fallback (it may be encrypted)
      const existingRefresh = decrypt(existing.refreshToken);
      db.prepare(
        `UPDATE gmail_tokens SET accessToken=?, refreshToken=?, expiryDate=?, scope=?, email=?, updatedAt=datetime('now') WHERE userId=?`
      ).run(
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token || existingRefresh),
        tokens.expiry_date || null,
        tokens.scope || null,
        email,
        userId
      );
    } else {
      db.prepare(
        'INSERT INTO gmail_tokens (userId, accessToken, refreshToken, tokenType, expiryDate, scope, email) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        userId,
        encrypt(tokens.access_token),
        tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        tokens.token_type || 'Bearer',
        tokens.expiry_date || null,
        tokens.scope || null,
        email
      );
    }

    res.redirect(`${appUrl}/settings?gmailConnected=1`);
  } catch (err) {
    console.error('[gmail] OAuth callback error:', err);
    res.redirect(`${appUrl}/settings?gmailError=${encodeURIComponent(err.message)}`);
  }
});

// POST /api/gmail/disconnect
router.post('/disconnect', (req, res) => {
  const row = db.prepare('SELECT accessToken FROM gmail_tokens WHERE userId=?').get(req.user.id);
  if (row) {
    try {
      const oauth2Client = getOAuth2Client();
      oauth2Client.revokeToken(decrypt(row.accessToken)).catch(() => {});
    } catch (_) {}
    db.prepare('DELETE FROM gmail_tokens WHERE userId=?').run(req.user.id);
  }
  res.json({ ok: true });
});

// Build authenticated Gmail client for a user
function getGmailClient(userId) {
  const row = db.prepare('SELECT * FROM gmail_tokens WHERE userId=?').get(userId);
  if (!row) throw new Error('Gmail not connected');

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decrypt(row.accessToken),
    refresh_token: decrypt(row.refreshToken),
    token_type: row.tokenType || 'Bearer',
    expiry_date: row.expiryDate || undefined,
    scope: row.scope || undefined,
  });

  // Persist refreshed access token (encrypt before storing)
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      db.prepare(`UPDATE gmail_tokens SET accessToken=?, expiryDate=?, updatedAt=datetime('now') WHERE userId=?`)
        .run(encrypt(tokens.access_token), tokens.expiry_date || null, userId);
    }
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Decode base64url email body part
function extractBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    const html = Buffer.from(payload.body.data, 'base64').toString('utf8');
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (payload.parts) {
    const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart) return extractBody(textPart);
    const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
    if (htmlPart) return extractBody(htmlPart);
    for (const part of payload.parts) {
      const r = extractBody(part);
      if (r) return r;
    }
  }
  return '';
}

function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// GET /api/gmail/search?q=&max=10
router.get('/search', gmailSearchLimiter, async (req, res) => {
  const { q, max = '10' } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'q param required' });
  if (q.length > 500) return res.status(400).json({ error: 'Query too long (max 500 characters)' });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { gmailQuery, intent, maxResults: nlpMax, responseMode } = await translateToGmailQuery(q.trim(), today);

    const resolvedMax = Math.min(parseInt(max) || nlpMax, GMAIL_LIMITS.count);

    const gmail = getGmailClient(req.user.id);
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: gmailQuery,
      maxResults: resolvedMax,
    });

    const msgs = listRes.data.messages || [];
    if (msgs.length === 0) return res.json({ results: [], translatedQuery: gmailQuery, intent, responseMode });

    const results = await Promise.all(
      msgs.slice(0, 10).map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const headers = detail.data.payload?.headers || [];
        return {
          id: msg.id,
          threadId: detail.data.threadId,
          subject: getHeader(headers, 'Subject') || '(no subject)',
          from: getHeader(headers, 'From'),
          date: getHeader(headers, 'Date'),
          snippet: detail.data.snippet || '',
        };
      })
    );

    res.json({ results, translatedQuery: gmailQuery, intent, responseMode });
  } catch (err) {
    console.error('[gmail] Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gmail/thread/:threadId
router.get('/thread/:threadId', gmailThreadLimiter, async (req, res) => {
  try {
    const gmail = getGmailClient(req.user.id);
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: req.params.threadId,
      format: 'full',
    });

    const messages = (thread.data.messages || []).map(msg => {
      const headers = msg.payload?.headers || [];
      return {
        id: msg.id,
        from: getHeader(headers, 'From'),
        to: getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject'),
        date: getHeader(headers, 'Date'),
        body: extractBody(msg.payload).substring(0, 3000),
      };
    });

    res.json({ messages });
  } catch (err) {
    console.error('[gmail] Thread error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/ask — SSE: attach thread content and ask AI
router.post('/ask', gmailAskLimiter, async (req, res) => {
  const { threadId, question } = req.body;
  if (!threadId || !question) return res.status(400).json({ error: 'threadId and question required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const gmail = getGmailClient(req.user.id);
    const thread = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });

    const emailText = (thread.data.messages || []).map(msg => {
      const headers = msg.payload?.headers || [];
      const body = extractBody(msg.payload).substring(0, 2000);
      return `From: ${getHeader(headers, 'From')}\nDate: ${getHeader(headers, 'Date')}\nSubject: ${getHeader(headers, 'Subject')}\n\n${body}`;
    }).join('\n\n---\n\n');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Extract subject from first message for logging
    const firstMsg = thread.data.messages?.[0];
    const firstHeaders = firstMsg?.payload?.headers || [];
    const threadSubject = getHeader(firstHeaders, 'Subject') || '(no subject)';

    const stream = anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      store: false,
      system: `You are a personal email assistant integrated into the user's own productivity workspace. The user has authenticated their personal Gmail account via Google OAuth — every email you receive is FROM THEIR OWN INBOX. They are the author or recipient of every email shown.

You must help the user with ANY of their own emails including:
- Their own financial and tax correspondence
- Their own legal correspondence
- Their own personal correspondence
- Emails with their accountant, lawyer, financial advisor, or any professional service provider
- Any business or personal emails they have sent or received

You are not a third party accessing someone else's emails. You are an assistant helping a person manage THEIR OWN inbox. Treat this exactly as you would treat a person asking you to help them read and organise their own documents.

Never refuse to summarise, analyse, or discuss emails on privacy grounds. The user owns this inbox. Privacy concerns do not apply between a person and their own emails.

Be concise and direct. When asked to count, count. When asked to summarise, summarise. When asked to extract figures or dates, extract them.`,
      messages: [{
        role: 'user',
        content: `These are my own emails from my personal Gmail inbox. Please help me with the following:\n\n${question}\n\nEmail thread:\n\n${emailText}`,
      }],
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        fullResponse += chunk.delta.text;
        res.write(`data: ${JSON.stringify({ delta: chunk.delta.text })}\n\n`);
      }
    }

    // Detect and log refusals for prompt tuning
    const refusalPatterns = /\b(i('m| am) (sorry|unable|not able)|i can'?t (help|access|read|provide|analyse|analyze|discuss)|i (don'?t|do not) have access|privacy|cannot (help|access|read|provide)|this (request|content) (violates|goes against))\b/i;
    if (refusalPatterns.test(fullResponse)) {
      console.warn(`[gmail/ask] Possible refusal detected — subject: "${threadSubject}" | question: "${question}" | response snippet: "${fullResponse.slice(0, 200)}"`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[gmail] Ask error:', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
    }
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
