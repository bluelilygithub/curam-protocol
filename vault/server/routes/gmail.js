'use strict';

const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { translateToGmailQuery, GMAIL_LIMITS } = require('../services/gmailNLP');
const { getModelsForUser } = require('../services/modelResolver');
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
router.get('/status', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ connected: false, configured: false, email: null, hasDriveScope: false });
  }
  try {
    const { rows } = await pool.query(
      'SELECT email, scope FROM gmail_tokens WHERE "userId"=$1', [req.user.id]
    );
    const row = rows[0];
    res.json({
      connected: !!row,
      configured: true,
      email: row?.email || null,
      hasDriveScope: !!(row?.scope && row.scope.includes('drive')),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gmail/diagnose — full auth diagnostic (safe, no token values exposed)
router.get('/diagnose', async (req, res) => {
  const result = {
    env: {
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || null,
      ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
    },
    token: null,
    apiTest: null,
  };

  try {
    const { rows } = await pool.query('SELECT * FROM gmail_tokens WHERE "userId"=$1', [req.user.id]);
    if (!rows[0]) {
      result.token = { exists: false };
    } else {
      const row = rows[0];
      const rawAccess  = row.accessToken  || '';
      const rawRefresh = row.refreshToken || '';
      result.token = {
        exists: true,
        email: row.email,
        expiryDate: row.expiryDate,
        scope: row.scope,
        accessTokenFormat:  rawAccess.split(':').length  === 3 ? 'encrypted' : 'plaintext',
        refreshTokenFormat: rawRefresh.split(':').length === 3 ? 'encrypted' : 'plaintext',
        encryptionKeyPresent: !!process.env.ENCRYPTION_KEY,
      };

      // Try a live API call
      try {
        const gmail = await getGmailClient(req.user.id);
        const profile = await gmail.users.getProfile({ userId: 'me' });
        result.apiTest = { ok: true, email: profile.data.emailAddress, messagesTotal: profile.data.messagesTotal };
      } catch (apiErr) {
        result.apiTest = { ok: false, error: apiErr.message, code: apiErr.code };
      }
    }
  } catch (dbErr) {
    result.token = { exists: false, dbError: dbErr.message };
  }

  res.json(result);
});

// GET /api/gmail/auth — generate OAuth URL
router.get('/auth', gmailAuthLimiter, async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(400).json({ error: 'Gmail OAuth not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI to environment variables.' });
  }

  const state = require('crypto').randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  // Sanitise returnTo: only allow internal paths (no protocol, no host)
  const rawReturn = req.query.returnTo;
  const returnTo = (rawReturn && /^\/[a-zA-Z0-9/_-]*$/.test(rawReturn)) ? rawReturn : '/settings';
  try {
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
      [`gmail_oauth_state_${state}`, JSON.stringify({ userId: req.user.id, expiresAt, returnTo })]
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const oauth2Client = getOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/drive.file',
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
  try {
    const { rows: stateRows } = await pool.query(
      'SELECT value FROM settings WHERE key=$1', [stateKey]
    );
    if (!stateRows[0]) {
      return res.redirect(`${appUrl}/settings?gmailError=invalid_state`);
    }

    let userId, expiresAt, returnTo;
    try {
      ({ userId, expiresAt, returnTo } = JSON.parse(stateRows[0].value));
    } catch {
      return res.redirect(`${appUrl}/settings?gmailError=invalid_state`);
    }
    const successRedirect = returnTo ? `${appUrl}${returnTo}` : `${appUrl}/settings?gmailConnected=1`;
    const errorRedirect = (msg) => returnTo
      ? `${appUrl}${returnTo}?gmailError=${encodeURIComponent(msg)}`
      : `${appUrl}/settings?gmailError=${encodeURIComponent(msg)}`;

    if (new Date(expiresAt) < new Date()) {
      await pool.query('DELETE FROM settings WHERE key=$1', [stateKey]);
      return res.redirect(errorRedirect('state_expired'));
    }
    await pool.query('DELETE FROM settings WHERE key=$1', [stateKey]);

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2Api.userinfo.get();
    const email = userInfo.data.email;

    const { rows: existing } = await pool.query(
      'SELECT id, "refreshToken" FROM gmail_tokens WHERE "userId"=$1', [userId]
    );
    if (existing[0]) {
      const existingRefresh = decrypt(existing[0].refreshToken);
      await pool.query(
        `UPDATE gmail_tokens SET "accessToken"=$1, "refreshToken"=$2, "expiryDate"=$3, scope=$4, email=$5, "updatedAt"=NOW() WHERE "userId"=$6`,
        [
          encrypt(tokens.access_token),
          encrypt(tokens.refresh_token || existingRefresh),
          tokens.expiry_date || null,
          tokens.scope || null,
          email,
          userId,
        ]
      );
    } else {
      await pool.query(
        'INSERT INTO gmail_tokens ("userId", "accessToken", "refreshToken", "tokenType", "expiryDate", scope, email) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          userId,
          encrypt(tokens.access_token),
          tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          tokens.token_type || 'Bearer',
          tokens.expiry_date || null,
          tokens.scope || null,
          email,
        ]
      );
    }

    res.redirect(successRedirect);
  } catch (err) {
    console.error('[gmail] OAuth callback error:', err);
    // Use returnTo for error redirect if we parsed it from state, else fall back to settings
    const errDest = typeof errorRedirect === 'function'
      ? errorRedirect(err.message)
      : `${appUrl}/settings?gmailError=${encodeURIComponent(err.message)}`;
    res.redirect(errDest);
  }
});

// POST /api/gmail/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT "accessToken" FROM gmail_tokens WHERE "userId"=$1', [req.user.id]
    );
    if (rows[0]) {
      try {
        const oauth2Client = getOAuth2Client();
        oauth2Client.revokeToken(decrypt(rows[0].accessToken)).catch(() => {});
      } catch (_) {}
      await pool.query('DELETE FROM gmail_tokens WHERE "userId"=$1', [req.user.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Build authenticated Gmail client for a user
async function getGmailClient(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_tokens WHERE "userId"=$1', [userId]);
  if (!rows[0]) throw new Error('Gmail not connected');
  const row = rows[0];

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decrypt(row.accessToken),
    refresh_token: decrypt(row.refreshToken),
    token_type: row.tokenType || 'Bearer',
    // BIGINT comes back as string from pg — convert to number
    expiry_date: row.expiryDate ? Number(row.expiryDate) : undefined,
    scope: row.scope || undefined,
  });

  // Persist refreshed access token (fire-and-forget — event listener can't be async)
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      pool.query(
        `UPDATE gmail_tokens SET "accessToken"=$1, "expiryDate"=$2, "updatedAt"=NOW() WHERE "userId"=$3`,
        [encrypt(tokens.access_token), tokens.expiry_date || null, userId]
      ).catch(err => console.error('[gmail] token refresh persist error:', err));
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
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const { gmailQuery, intent, maxResults: nlpMax, responseMode } = await translateToGmailQuery(q.trim(), today, lightModel);

    const resolvedMax = Math.min(parseInt(max) || nlpMax, GMAIL_LIMITS.count);

    const gmail = await getGmailClient(req.user.id);
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
    const gmail = await getGmailClient(req.user.id);
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

// --- Inbox Intel ---

const gmailInboxClassifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many classify requests, please try again later.' },
});

function formatEmailAge(ms) {
  if (ms <= 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function fetchInboxEmails(userId) {
  const gmail = await getGmailClient(userId);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 50,
    labelIds: ['INBOX'],
  });
  const messages = listRes.data.messages || [];
  return Promise.all(
    messages.map(async (msg) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = detail.data.payload?.headers || [];
      const internalDate = parseInt(detail.data.internalDate || '0');
      return {
        id: msg.id,
        sender: getHeader(headers, 'From'),
        subject: getHeader(headers, 'Subject'),
        snippet: (detail.data.snippet || '').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
        isUnread: (detail.data.labelIds || []).includes('UNREAD'),
        internalDate,
        age: formatEmailAge(Date.now() - internalDate),
      };
    })
  );
}

// GET /api/gmail/inbox/classify — fetch + Claude-classify last 50 inbox emails
router.get('/inbox/classify', gmailInboxClassifyLimiter, async (req, res) => {
  let emails;
  try {
    emails = await fetchInboxEmails(req.user.id);
  } catch (err) {
    console.error('[gmail/inbox/classify] fetch error:', err.message);
    if (err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
      return res.status(400).json({ error: 'gmail_token_expired' });
    }
    return res.status(500).json({ error: err.message });
  }

  let classifications = [];
  let classificationFailed = false;

  try {
    const { standard } = await getModelsForUser(req.user?.id);
    const lines = emails.map((e, i) =>
      `[${i + 1}] ID: ${e.id}\nFrom: ${e.sender}\nSubject: ${e.subject}\nPreview: ${e.snippet}\nAge: ${e.age}`
    ).join('\n\n');

    const message = await anthropic.messages.create({
      model: standard,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Classify these ${emails.length} inbox emails for a professional. Return ONLY a JSON array.

Categories (pick one per email):
- urgent: requires action soon, time-sensitive
- waiting: sender is blocked on or waiting for a reply from me
- fyi: informational, no action required
- noise: newsletters, automated notifications, promotions

${lines}

Return format — JSON array only, no markdown, no explanation:
[{"id":"<id>","category":"urgent|waiting|fyi|noise","one_line_summary":"<max 12 words>"},...]`,
      }],
    });

    const text = message.content[0].text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (match) classifications = JSON.parse(match[0]);
  } catch (err) {
    console.error('[gmail/inbox/classify] Claude error:', err.message);
    classificationFailed = true;
  }

  const map = new Map(classifications.map(c => [c.id, c]));
  const enriched = emails.map(e => ({
    ...e,
    category: map.get(e.id)?.category || 'fyi',
    one_line_summary: map.get(e.id)?.one_line_summary || e.snippet.slice(0, 80),
  }));

  res.json({ emails: enriched, classificationFailed });
});

// GET /api/gmail/inbox — raw fetch of last 50 inbox emails (no AI)
router.get('/inbox', async (req, res) => {
  try {
    const emails = await fetchInboxEmails(req.user.id);
    res.json(emails);
  } catch (err) {
    console.error('[gmail/inbox] error:', err.message);
    if (err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
      return res.status(400).json({ error: 'gmail_token_expired' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/ask — SSE: attach thread content and ask AI
router.post('/ask', gmailAskLimiter, async (req, res) => {
  const { threadId, question } = req.body;
  if (!threadId || !question) return res.status(400).json({ error: 'threadId and question required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const gmail = await getGmailClient(req.user.id);
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
      model: (await getModelsForUser(req.user?.id)).light,
      max_tokens: 1024,
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
module.exports.getGmailClient = getGmailClient;
module.exports.getHeader      = getHeader;
