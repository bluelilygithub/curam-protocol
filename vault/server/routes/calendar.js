'use strict';

const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');
const Anthropic   = require('@anthropic-ai/sdk');
const rateLimit   = require('express-rate-limit');
const { pool }    = require('../db');
const { requireAuth } = require('../middleware/auth');
const { translateToCalendarQuery } = require('../services/calendarNLP');
const { getModelsForUser } = require('../services/modelResolver');
const { encrypt, decrypt } = require('../utils/encryption');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const calendarSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, please try again later.' },
});

const calendarAskLimiter = rateLimit({
  windowMs: 60 * 1000,
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

// All calendar routes require auth
router.use(requireAuth);

// Build an authenticated Google Calendar client for a user
async function getCalendarClient(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_tokens WHERE "userId"=$1', [userId]);
  if (!rows[0]) throw new Error('Google account not connected. Connect Google in Settings → Integrations.');

  const row = rows[0];
  if (!row.scope || !row.scope.includes('calendar')) {
    throw new Error('Calendar access not granted. Reconnect Google in Settings → Integrations to enable Calendar access.');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token:  decrypt(row.accessToken),
    refresh_token: decrypt(row.refreshToken),
    token_type:    row.tokenType || 'Bearer',
    expiry_date:   row.expiryDate ? Number(row.expiryDate) : undefined,
    scope:         row.scope || undefined,
  });

  // Persist refreshed tokens (fire-and-forget)
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      pool.query(
        `UPDATE gmail_tokens SET "accessToken"=$1, "expiryDate"=$2, "updatedAt"=NOW() WHERE "userId"=$3`,
        [encrypt(tokens.access_token), tokens.expiry_date || null, userId]
      ).catch(err => console.error('[calendar] token refresh persist error:', err));
    }
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Format a calendar event as plain text for AI context
function formatEventForContext(event) {
  const isAllDay = !event.start?.dateTime;
  const startRaw = event.start?.dateTime || event.start?.date || '';
  const endRaw   = event.end?.dateTime   || event.end?.date   || '';

  const fmtDate = (raw) => {
    if (!raw) return '';
    const d = new Date(raw);
    return isAllDay
      ? d.toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
      : d.toLocaleString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const attendeeList = (event.attendees || []).map(a => a.displayName ? `${a.displayName} <${a.email}>` : a.email).join(', ');

  return [
    '[Calendar Event]',
    `Title: ${event.summary || '(untitled)'}`,
    `Date: ${fmtDate(startRaw)}`,
    endRaw && endRaw !== startRaw ? `End: ${fmtDate(endRaw)}` : '',
    event.location ? `Location: ${event.location}` : '',
    event.organizer?.email ? `Organiser: ${event.organizer.displayName || event.organizer.email}` : '',
    attendeeList ? `Attendees: ${attendeeList}` : '',
    event.description ? `Description: ${event.description.substring(0, 500)}` : '',
    event.htmlLink ? `Calendar link: ${event.htmlLink}` : '',
  ].filter(Boolean).join('\n');
}

// GET /api/calendar/status
router.get('/status', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ connected: false, configured: false, hasCalendarScope: false, email: null });
  }
  try {
    const { rows } = await pool.query(
      'SELECT scope, email FROM gmail_tokens WHERE "userId"=$1', [req.user.id]
    );
    if (!rows[0]) {
      return res.json({ connected: false, configured: true, hasCalendarScope: false, googleConnected: false, email: null });
    }
    const hasCalendarScope = !!(rows[0].scope && rows[0].scope.includes('calendar'));
    res.json({
      connected: hasCalendarScope,
      configured: true,
      hasCalendarScope,
      googleConnected: true,
      email: rows[0].email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/disconnect
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

// GET /api/calendar/search?q=
router.get('/search', calendarSearchLimiter, async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'q param required' });
  if (q.length > 500) return res.status(400).json({ error: 'Query too long (max 500 characters)' });

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { light: lightModel } = await getModelsForUser(req.user?.id);
    const { timeMin, timeMax, searchQuery, maxResults, calendarId, intent } =
      await translateToCalendarQuery(q.trim(), today, lightModel);

    const calendar = await getCalendarClient(req.user.id);

    const params = {
      calendarId:   calendarId || 'primary',
      timeMin,
      singleEvents: true,
      orderBy:      'startTime',
      maxResults:   Math.min(maxResults || 20, 50),
    };
    if (timeMax) params.timeMax = timeMax;
    if (searchQuery) params.q = searchQuery;

    const response = await calendar.events.list(params);
    const calName  = response.data.summary || 'primary';

    const results = (response.data.items || []).map(event => ({
      id:          event.id,
      title:       event.summary || '(untitled)',
      start:       event.start,
      end:         event.end,
      location:    event.location || null,
      description: event.description ? event.description.substring(0, 200) : null,
      attendees:   (event.attendees || []).map(a => ({ email: a.email, name: a.displayName || null })),
      organizer:   event.organizer || null,
      calendarName: calName,
      htmlLink:    event.htmlLink || null,
    }));

    res.json({ results, intent, searchQuery });
  } catch (err) {
    console.error('[calendar] Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/event/:eventId
router.get('/event/:eventId', async (req, res) => {
  try {
    const calendar = await getCalendarClient(req.user.id);
    const response = await calendar.events.get({
      calendarId: 'primary',
      eventId: req.params.eventId,
    });
    const event = response.data;
    res.json({
      id:          event.id,
      title:       event.summary || '(untitled)',
      start:       event.start,
      end:         event.end,
      location:    event.location || null,
      description: event.description || null,
      attendees:   (event.attendees || []).map(a => ({ email: a.email, name: a.displayName || null })),
      organizer:   event.organizer || null,
      htmlLink:    event.htmlLink || null,
      formatted:   formatEventForContext(event),
    });
  } catch (err) {
    console.error('[calendar] Event error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/ask — SSE: answer a question about a calendar event
router.post('/ask', calendarAskLimiter, async (req, res) => {
  const { eventId, question } = req.body;
  if (!eventId || !question) return res.status(400).json({ error: 'eventId and question required' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const calendar  = await getCalendarClient(req.user.id);
    const response  = await calendar.events.get({ calendarId: 'primary', eventId });
    const eventText = formatEventForContext(response.data);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = anthropic.messages.stream({
      model:      (await getModelsForUser(req.user?.id)).light,
      max_tokens: 1024,
      system: `You are a personal calendar assistant integrated into the user's own productivity workspace. The user has connected their personal Google Calendar via OAuth — every event you see belongs to their own calendar. Help them with any questions about their events. Be concise and direct.`,
      messages: [{
        role:    'user',
        content: `Here is my calendar event:\n\n${eventText}\n\nMy question: ${question}`,
      }],
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ delta: chunk.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[calendar] Ask error:', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
    }
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
