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
const { callModel } = require('../services/callModel');
const { calculateCost } = require('../services/costCalculator');
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
  const oauthConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
  let authUrl = null;
  if (oauthConfigured) {
    try {
      const testClient = getOAuth2Client();
      authUrl = testClient.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.readonly'],
        state: 'diag-test',
        prompt: 'consent',
      });
    } catch (_) {}
  }

  const result = {
    env: {
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || null,
      ENCRYPTION_KEY: !!process.env.ENCRYPTION_KEY,
    },
    authUrlPreview: authUrl ? authUrl.slice(0, 300) + '…' : null,
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
      'INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3)',
      [req.user.id, `gmail_oauth_state_${state}`, JSON.stringify({ userId: req.user.id, expiresAt, returnTo })]
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
      'https://www.googleapis.com/auth/drive.readonly',
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
      await pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [userId, stateKey]);
      return res.redirect(errorRedirect('state_expired'));
    }
    await pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [userId, stateKey]);

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

// Build OAuth2 client for a user, sets credentials and registers token refresh persister
async function getAuthClient(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_tokens WHERE "userId"=$1', [userId]);
  if (!rows[0]) throw new Error('Gmail not connected');
  const row = rows[0];

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decrypt(row.accessToken),
    refresh_token: decrypt(row.refreshToken),
    token_type: row.tokenType || 'Bearer',
    expiry_date: row.expiryDate ? Number(row.expiryDate) : undefined,
    scope: row.scope || undefined,
  });

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      pool.query(
        `UPDATE gmail_tokens SET "accessToken"=$1, "expiryDate"=$2, "updatedAt"=NOW() WHERE "userId"=$3`,
        [encrypt(tokens.access_token), tokens.expiry_date || null, userId]
      ).catch(err => console.error('[gmail] token refresh persist error:', err));
    }
  });

  return oauth2Client;
}

async function getGmailClient(userId) {
  const oauth2Client = await getAuthClient(userId);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Parse multipart Gmail batch response — each part is an HTTP response with a JSON body
function parseBatchResponse(responseText, contentType) {
  const m = contentType.match(/boundary=([^\s;,]+)/i);
  if (!m) return [];
  const boundary = m[1].replace(/^["']|["']$/g, '');
  const results = [];
  for (const part of responseText.split(`--${boundary}`)) {
    if (!part.includes('{')) continue;
    const idx = part.lastIndexOf('\r\n\r\n');
    if (idx === -1) continue;
    const candidate = part.slice(idx + 4).trim();
    if (!candidate.startsWith('{')) continue;
    try { results.push(JSON.parse(candidate)); } catch {}
  }
  return results;
}

// Fetch message metadata in bulk — up to 100 messages per HTTP request via Gmail batch endpoint
async function batchFetchMessages(accessToken, messageIds) {
  const results = [];
  for (let i = 0; i < messageIds.length; i += 100) {
    const chunk = messageIds.slice(i, i + 100);
    const boundary = `vaultbatch${Date.now()}${i}`;
    const body = chunk.map(id =>
      `--${boundary}\r\nContent-Type: application/http\r\n\r\nGET /gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date\r\n\r\n`
    ).join('') + `--${boundary}--`;

    const res = await fetch('https://www.googleapis.com/batch/gmail/v1', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/mixed; boundary="${boundary}"`,
      },
      body,
    });
    results.push(...parseBatchResponse(await res.text(), res.headers.get('content-type') || ''));
  }
  return results;
}

// Fetch full thread details in bulk — reply count + attachment detection
async function batchFetchThreads(accessToken, threadIds) {
  const results = [];
  for (let i = 0; i < threadIds.length; i += 100) {
    const chunk = threadIds.slice(i, i + 100);
    const boundary = `vaultbatch${Date.now()}${i}`;
    const body = chunk.map(id =>
      `--${boundary}\r\nContent-Type: application/http\r\n\r\nGET /gmail/v1/users/me/threads/${id}?format=metadata\r\n\r\n`
    ).join('') + `--${boundary}--`;

    const res = await fetch('https://www.googleapis.com/batch/gmail/v1', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/mixed; boundary="${boundary}"`,
      },
      body,
    });
    results.push(...parseBatchResponse(await res.text(), res.headers.get('content-type') || ''));
  }
  return results;
}

// Heuristic: multipart/mixed top-level mimeType indicates an attachment
function threadHasAttachment(messages) {
  return (messages || []).some(m =>
    m.payload?.mimeType === 'multipart/mixed' ||
    m.payload?.mimeType === 'multipart/related'
  );
}

// Extract attachment metadata from a message payload (does not download)
function extractAttachments(payload) {
  const attachments = [];
  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }
  walk(payload?.parts);
  return attachments;
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
    const { gmailQuery, intent, maxResults: nlpMax, responseMode } = await translateToGmailQuery(q.trim(), today, lightModel, {
      userId: req.user?.id,
      feature: 'gmail',
    });

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
        body: extractBody(msg.payload).substring(0, 5000),
        attachments: extractAttachments(msg.payload),
      };
    });

    res.json({ messages });
  } catch (err) {
    console.error('[gmail] Thread error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gmail/attachment/:messageId/:attachmentId?filename=&mimeType=
router.get('/attachment/:messageId/:attachmentId', gmailThreadLimiter, async (req, res) => {
  try {
    const gmail = await getGmailClient(req.user.id);
    const att = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: req.params.messageId,
      id: req.params.attachmentId,
    });
    const buffer = Buffer.from(att.data.data, 'base64');
    const filename = req.query.filename || 'attachment';
    const mimeType = req.query.mimeType || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[gmail/attachment]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Inbox Intel ---

const gmailInboxClassifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many classify requests, please try again later.' },
});

// Short in-memory dedup — prevents hammering within 2 minutes between renders
const classifyCache = new Map(); // userId -> { ts: number, result: object }
const CLASSIFY_DEDUP_MS = 2 * 60 * 1000;


function formatEmailAge(ms) {
  if (ms <= 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function fetchInboxEmails(userId, maxResults = 100) {
  const oauth2Client = await getAuthClient(userId);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // threads.list deduplicates conversations (one entry per thread, not per message)
  const listRes = await gmail.users.threads.list({
    userId: 'me',
    maxResults,
    labelIds: ['INBOX'],
  });
  const threadList = listRes.data.threads || [];
  if (!threadList.length) return [];

  const { token: accessToken } = await oauth2Client.getAccessToken();
  // Batch fetch full thread metadata — gives reply count + attachment heuristic in 1 HTTP call
  const threads = await batchFetchThreads(accessToken, threadList.map(t => t.id));

  const now = Date.now();
  return threads
    .filter(t => t?.id && t?.messages?.length)
    .map(thread => {
      const messages = thread.messages;
      const lastMsg = messages[messages.length - 1];
      const firstMsg = messages[0];
      const headers = lastMsg?.payload?.headers || [];
      const firstHeaders = firstMsg?.payload?.headers || [];
      const internalDate = parseInt(lastMsg?.internalDate || '0');
      // Gmail omits Subject header from reply messages — fall back to first message's subject
      const subject = getHeader(headers, 'Subject') || getHeader(firstHeaders, 'Subject');
      return {
        id: lastMsg.id,
        threadId: thread.id,
        sender: getHeader(headers, 'From'),
        subject,
        snippet: (lastMsg.snippet || '').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
        isUnread: messages.some(m => (m.labelIds || []).includes('UNREAD')),
        hasAttachment: threadHasAttachment(messages),
        replyCount: messages.length - 1,
        internalDate,
        age: formatEmailAge(now - internalDate),
      };
    });
}

// GET /api/gmail/inbox/classify — incremental: only classifies new/changed threads
router.get('/inbox/classify', gmailInboxClassifyLimiter, async (req, res) => {
  const userId = req.user.id;
  const forceRefresh = req.query.refresh === '1';

  // 2-min dedup to prevent hammering on rapid page switches
  const cached = classifyCache.get(userId);
  if (!forceRefresh && cached && (Date.now() - cached.ts) < CLASSIFY_DEDUP_MS) {
    return res.json({ ...cached.result, cachedAt: cached.ts });
  }

  // Read user's email count preference
  const { rows: countRows } = await pool.query(
    'SELECT value FROM settings WHERE "userId"=$1 AND key=$2', [userId, 'gmail_intel_email_count']
  ).catch(() => ({ rows: [] }));
  const maxResults = Math.min(parseInt(countRows[0]?.value || '100', 10), 200);

  let emails;
  try {
    emails = await fetchInboxEmails(userId, maxResults);
  } catch (err) {
    console.error('[gmail/inbox/classify] fetch error:', err.message);
    if (err.message?.includes('invalid_grant') || err.message?.includes('Token has been expired')) {
      return res.status(400).json({ error: 'gmail_token_expired' });
    }
    return res.status(500).json({ error: err.message });
  }

  if (!emails.length) {
    return res.json({ emails: [], classificationFailed: false });
  }

  // Load stored classifications for current inbox threads
  const threadIds = emails.map(e => e.threadId);
  const { rows: stored } = await pool.query(
    `SELECT "threadId", "lastMessageId", category, "oneLine", actioned, "isExpense", acknowledged
     FROM gmail_classifications WHERE "userId"=$1 AND "threadId"=ANY($2)`,
    [userId, threadIds]
  ).catch(() => ({ rows: [] }));
  const storedMap = new Map(stored.map(r => [r.threadId, r]));

  // Only classify threads with no stored record OR where last message has changed (new reply)
  const needsClassification = emails.filter(e => {
    const s = storedMap.get(e.threadId);
    return !s || s.lastMessageId !== e.id;
  });

  let classificationFailed = false;
  let classificationError = null;

  if (needsClassification.length > 0) {
    try {
      const { standard } = await getModelsForUser(userId);
      console.log(`[gmail/inbox/classify] model: ${standard}, classifying ${needsClassification.length}/${emails.length} new/updated threads`);

      const lines = needsClassification.map((e, i) =>
        `[${i + 1}]\nFrom: ${e.sender}\nSubject: ${e.subject}\nPreview: ${e.snippet}\nAge: ${e.age}`
      ).join('\n\n');

      const prompt = `Classify these ${needsClassification.length} inbox emails for a professional. Return ONLY a JSON array.

Categories (pick one per email):
- urgent: requires action soon, time-sensitive
- waiting: sender is blocked on or waiting for a reply from me
- fyi: informational, no action required
- noise: newsletters, automated notifications, promotions

Set is_expense: true for any email that represents a financial document — invoice, receipt, purchase confirmation, payment confirmation, order confirmation, donation receipt, subscription charge, tax receipt, or any document showing an amount paid, owed, or received. This includes when the subject, preview, or sender strongly suggests a financial transaction.

${lines}

Return format — JSON array only, no markdown, no explanation. Use the number from [N] as the index field:
[{"index":1,"category":"urgent|waiting|fyi|noise","one_line_summary":"<max 12 words>","is_expense":false},...]`;

      const { text, inputTokens, outputTokens } = await callModel(standard, prompt, { maxTokens: 4096, returnUsage: true });
      console.log(`[gmail/inbox/classify] tokens in=${inputTokens} out=${outputTokens}`);

      if (inputTokens || outputTokens) {
        const cost = calculateCost(standard, inputTokens, outputTokens);
        pool.query(
          `INSERT INTO usage_logs (user_id, session_id, model_id, input_tokens, output_tokens, estimated_cost_usd, feature)
           VALUES ($1, NULL, $2, $3, $4, $5, 'gmail_intel')`,
          [userId, standard, inputTokens, outputTokens, cost]
        ).catch(err => console.error('[gmail/inbox/classify] usage log error:', err.message));
      }

      const stripped = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
      const match = stripped.match(/\[[\s\S]*\]/);
      if (match) {
        const classifications = JSON.parse(match[0]);

        // Batch upsert all new classifications in one query
        const toStore = classifications
          .map(c => ({ email: needsClassification[c.index - 1], category: c.category || 'fyi', oneLine: c.one_line_summary || '', isExpense: !!c.is_expense }))
          .filter(r => r.email);

        if (toStore.length > 0) {
          const vals = toStore.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6},NOW())`).join(',');
          const params = toStore.flatMap(r => [userId, r.email.threadId, r.email.id, r.category, r.oneLine, r.isExpense]);
          await pool.query(
            `INSERT INTO gmail_classifications ("userId","threadId","lastMessageId",category,"oneLine","isExpense","classifiedAt")
             VALUES ${vals}
             ON CONFLICT ("userId","threadId") DO UPDATE SET
               "lastMessageId"=EXCLUDED."lastMessageId",
               category=EXCLUDED.category,
               "oneLine"=EXCLUDED."oneLine",
               "isExpense"=EXCLUDED."isExpense",
               "classifiedAt"=EXCLUDED."classifiedAt"`,
            params
          ).catch(err => console.error('[gmail/inbox/classify] upsert error:', err.message));

          // Merge into storedMap for the enrichment step below (preserve acknowledged — not reset by re-classify)
          for (const r of toStore) {
            const prev = storedMap.get(r.email.threadId);
            storedMap.set(r.email.threadId, { lastMessageId: r.email.id, category: r.category, oneLine: r.oneLine, isExpense: r.isExpense, acknowledged: prev?.acknowledged ?? false });
          }
        }
        console.log(`[gmail/inbox/classify] stored ${toStore.length} classifications`);
      } else {
        console.warn('[gmail/inbox/classify] no JSON array found in response');
        classificationFailed = true;
      }
    } catch (err) {
      console.error('[gmail/inbox/classify] model error:', err.message);
      classificationFailed = true;
      classificationError = err.message;
    }
  } else {
    console.log(`[gmail/inbox/classify] all ${emails.length} threads already classified — skipping model call`);
  }

  const enriched = emails.map(e => {
    const s = storedMap.get(e.threadId);
    return {
      ...e,
      category: s?.category || 'fyi',
      one_line_summary: s?.oneLine || e.snippet.slice(0, 80),
      isInvoice: !!storedMap.get(e.threadId)?.isExpense,
      actioned: !!storedMap.get(e.threadId)?.actioned,
      acknowledged: !!storedMap.get(e.threadId)?.acknowledged,
    };
  });

  const result = { emails: enriched, classificationFailed };
  classifyCache.set(userId, { ts: Date.now(), result });
  res.json({ ...result, cachedAt: null, ...(classificationError ? { _debug: classificationError } : {}) });
});

// POST /api/gmail/threads/:threadId/extract-invoice — download PDF attachment + extract fields via LLM
router.post('/threads/:threadId/extract-invoice', async (req, res) => {
  const userId = req.user.id;
  const { threadId } = req.params;
  const logPrefix = `[gmail/extract-invoice] thread=${threadId}`;
  try {
    const oauth2Client = await getAuthClient(userId);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get full thread to find PDF attachments
    console.log(`${logPrefix} fetching thread (format=full)`);
    const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    const messages = threadRes.data.messages || [];
    console.log(`${logPrefix} messages=${messages.length}`);

    // Find first PDF part across all messages
    let pdfBase64 = null;
    let pdfFilename = null;
    outer: for (const msg of messages) {
      const parts = msg.payload?.parts || (msg.payload ? [msg.payload] : []);
      for (const part of parts) {
        console.log(`${logPrefix} part mimeType=${part.mimeType} filename=${part.filename || '(none)'} attachmentId=${part.body?.attachmentId || '(none)'}`);
        if (part.mimeType === 'application/pdf' || part.filename?.toLowerCase().endsWith('.pdf')) {
          if (part.body?.attachmentId) {
            console.log(`${logPrefix} downloading attachment id=${part.body.attachmentId} filename=${part.filename}`);
            const attRes = await gmail.users.messages.attachments.get({
              userId: 'me', messageId: msg.id, id: part.body.attachmentId,
            });
            pdfBase64 = attRes.data.data;
            pdfFilename = part.filename;
            console.log(`${logPrefix} downloaded ${pdfFilename}, base64 length=${pdfBase64?.length}`);
            break outer;
          }
        }
      }
    }

    if (!pdfBase64) {
      console.log(`${logPrefix} no PDF attachment found — parts logged above`);
      return res.json({ extracted: false, reason: 'No PDF attachment found' });
    }

    const { standard } = await getModelsForUser(userId);
    const { rows: settingRows } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key IN ('gmail_pdf_model','branch_eval_model')`, [userId]
    ).catch(() => ({ rows: [] }));
    const settingMap = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
    const pdfModel = settingMap.gmail_pdf_model
      || (standard?.startsWith('claude-') ? standard : null)
      || (settingMap.branch_eval_model?.startsWith('claude-') ? settingMap.branch_eval_model : null);
    console.log(`${logPrefix} standard=${standard}, branch_eval=${settingMap.branch_eval_model}, pdf model resolved=${pdfModel}`);
    if (!pdfModel || !pdfModel.startsWith('claude-')) {
      console.log(`${logPrefix} skipping — pdf model "${pdfModel}" is not Anthropic. Set a PDF model in Settings → Inbox Intel.`);
      return res.json({ extracted: false, reason: `PDF extraction requires an Anthropic model. Configured model: "${pdfModel}". Set one in Settings → Inbox Intel.` });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const standardBase64 = pdfBase64.replace(/-/g, '+').replace(/_/g, '/');

    console.log(`${logPrefix} calling ${pdfModel} with PDF document block`);
    const response = await client.messages.create({
      model: pdfModel,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: standardBase64 } },
          { type: 'text', text: 'Extract from this invoice: 1) a short description of the goods/services (max 80 chars), 2) total amount payable as a number (no currency symbol), 3) supplier/vendor name. Return only JSON: {"description":"...","amount":0.00,"supplier":""}' },
        ],
      }],
    });

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const text = response.content[0]?.text?.trim() || '';
    console.log(`${logPrefix} model response tokens in=${inputTokens} out=${outputTokens} text="${text.slice(0, 200)}"`);

    pool.query(
      `INSERT INTO usage_logs (user_id, session_id, model_id, input_tokens, output_tokens, estimated_cost_usd, feature)
       VALUES ($1, NULL, $2, $3, $4, $5, 'gmail_invoice_extract')`,
      [userId, pdfModel, inputTokens, outputTokens, calculateCost(pdfModel, inputTokens, outputTokens)]
    ).catch(err => console.error(`${logPrefix} usage log error:`, err.message));

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.log(`${logPrefix} no JSON found in model response`);
      return res.json({ extracted: false, reason: 'Model did not return JSON', rawResponse: text.slice(0, 300) });
    }
    const data = JSON.parse(match[0]);
    console.log(`${logPrefix} extracted description="${data.description}" amount=${data.amount} supplier="${data.supplier}"`);
    res.json({ extracted: true, description: data.description || '', amount: data.amount || '', supplier: data.supplier || '' });
  } catch (err) {
    console.error(`${logPrefix} ERROR:`, err.message);
    res.json({ extracted: false, error: err.message });
  }
});

// POST /api/gmail/threads/:threadId/unaction — clear actioned flag
router.post('/threads/:threadId/unaction', async (req, res) => {
  const userId = req.user.id;
  const { threadId } = req.params;
  try {
    await pool.query(
      `UPDATE gmail_classifications SET actioned=false WHERE "userId"=$1 AND "threadId"=$2`,
      [userId, threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/threads/:threadId/action — mark thread as actioned in gmail_classifications
router.post('/threads/:threadId/action', async (req, res) => {
  const userId = req.user.id;
  const { threadId } = req.params;
  try {
    await pool.query(
      `INSERT INTO gmail_classifications ("userId","threadId","lastMessageId",category,actioned)
       VALUES ($1,$2,''::text,'fyi',true)
       ON CONFLICT ("userId","threadId") DO UPDATE SET actioned=true`,
      [userId, threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/threads/:threadId/acknowledge — move email to Acknowledged silo
router.post('/threads/:threadId/acknowledge', async (req, res) => {
  const userId = req.user.id;
  const { threadId } = req.params;
  try {
    await pool.query(
      `INSERT INTO gmail_classifications ("userId","threadId","lastMessageId",category,acknowledged)
       VALUES ($1,$2,''::text,'fyi',true)
       ON CONFLICT ("userId","threadId") DO UPDATE SET acknowledged=true`,
      [userId, threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/threads/:threadId/unacknowledge — restore email to quadrant
router.post('/threads/:threadId/unacknowledge', async (req, res) => {
  const userId = req.user.id;
  const { threadId } = req.params;
  try {
    await pool.query(
      `UPDATE gmail_classifications SET acknowledged=false WHERE "userId"=$1 AND "threadId"=$2`,
      [userId, threadId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
