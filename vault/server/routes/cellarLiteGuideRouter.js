'use strict';

// The help chat on the PUBLIC website planner. No login, so it is deliberately boxed in:
//   - OFF until the owner ticks it (Settings -> Cellar Planner -> Website help chat). Off answers 404 and nothing else happens.
//   - Every answer is a paid AI call, so: a per-visitor hourly limit, a per-visitor daily limit, and a ceiling on all visitors together per
//     24 hours (counted from usage_logs). Past any of them the visitor gets a kind message and an invitation to contact the team.
//   - The cheap `light` model of the first admin's workspace. Small body, short conversation, no files, no design, no personal data needed.
//   - "Send this chat to the team": goes ONLY to the admin address(es), never to an address the visitor types. A typed contact is shown in the
//     email as text (escaped); it becomes Reply-To only if it is a strictly valid email address. Honeypot field, own tight limits.
// Two routes, mounted before requireAuth in server/index.js:  POST /api/cellar-lite/guide   POST /api/cellar-lite/guide/email
// Built with its dependencies passed in so the test runs without a database or a model. See docs/cellar-planner.md ("Website help chat").

const crypto = require('crypto');
const express = require('express');
const { KEY, validateConfig } = require('../config/cellarLiteConfig');
const { getLogger } = require('../middleware/requestContext');

const HOUR = 60 * 60 * 1000;
const LIMITS = { askPerHour: 15, askPerDay: 40, emailPerHour: 3, emailPerDay: 6, globalPerDay: 400, question: 600, contact: 120 };
const STRICT_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}$/;
const FEATURE = 'cellar_lite_guide';

const ipOf = (req) => (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown');
const hashIp = (ip) => crypto.createHash('sha256').update(`cellar-guide:${ip}`).digest('hex').slice(0, 24);

/** A small in-memory window counter: a restart only resets a limit. */
function makeLimiter(now) {
  const seen = new Map();
  return function hit(key, windowMs, max) {
    const t = now();
    const recent = (seen.get(key) || []).filter((x) => t - x < windowMs);
    if (recent.length >= max) { seen.set(key, recent); return false; }
    recent.push(t); seen.set(key, recent);
    if (seen.size > 10000) for (const [k, v] of seen) if (!v.some((x) => t - x < 24 * HOUR)) seen.delete(k);
    return true;
  };
}

/**
 * @param {{ pool: any, ask: Function, tutorEmail: { cleanTurns: Function, renderEmail: Function }, sendEmail?: any, now?: () => number, capture?: Function, deps?: object }} o
 */
function createCellarLiteGuideRouter({ pool, ask, tutorEmail, sendEmail, now = () => Date.now(), capture = null, deps = {} }) {
  const hit = makeLimiter(now);
  let cache = null; // { at, enabled }
  const router = express.Router();

  router.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST, OPTIONS').end();
    next();
  });
  router.use(express.text({ type: () => true, limit: '24kb' }));
  router.use((req, res, next) => {
    if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'That could not be read.' }); } }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'That could not be read.' });
    next();
  });

  async function enabled() {
    if (cache && now() - cache.at < 15000) return cache.enabled;
    const { rows } = await pool.query('SELECT value FROM workspace_settings WHERE key=$1 LIMIT 1', [KEY]);
    let raw = null;
    try { raw = rows.length ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : null; } catch { raw = null; }
    cache = { at: now(), enabled: validateConfig(raw).config.guide.enabled === true };
    return cache.enabled;
  }
  const ownerId = async () => (await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC LIMIT 1')).rows[0]?.id || null;
  const usedToday = async () => Number((await pool.query(`SELECT COUNT(*) AS n FROM usage_logs WHERE feature=$1 AND created_at > NOW() - INTERVAL '24 hours'`, [FEATURE])).rows[0]?.n || 0);

  // ------------------------------------------------------------ POST /
  router.post('/', async (req, res) => {
    try {
      if (String(req.body.website ?? '').trim()) return res.json({ verdict: 'question', answer: 'Thanks!', steps: [], missing: '', tip: '' }); // a robot: say nothing useful
      if (!(await enabled())) return res.status(404).json({ error: 'The help chat is not available.' });
      const h = hashIp(ipOf(req));
      if (!hit(`a:${h}`, HOUR, LIMITS.askPerHour) || !hit(`ad:${h}`, 24 * HOUR, LIMITS.askPerDay)) {
        return res.status(429).set('Retry-After', '3600').json({ error: 'You have asked a lot of questions. Please try again later, or use the Request a quote button and the team will help.' });
      }
      const messages = (Array.isArray(req.body.messages) ? req.body.messages : []).map((m) => (m && typeof m === 'object' ? { role: m.role, content: String(m.content ?? '').slice(0, LIMITS.question) } : null));
      const userId = await ownerId();
      if (!userId) return res.status(503).json({ error: 'The help chat is not available right now.' });
      if ((await usedToday()) >= LIMITS.globalPerDay) return res.status(503).json({ error: 'The help chat is resting for today. Please use the Request a quote button and the team will help.' });
      const reply = await ask(userId, { messages, currentTool: typeof req.body.currentTool === 'string' ? req.body.currentTool.slice(0, 20) : '' }, deps);
      if (capture && (reply.verdict === 'missing' || reply.verdict === 'partly') && reply.missing) {
        const key = reply.missing.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(' ').filter(Boolean).slice(0, 12).join(' ');
        capture({
          userId, source: 'cellarLiteGuide', category: 'other', fingerprint: `cellarLiteGuide:gap:${key}`,
          title: `Planner visitors want: ${reply.missing.slice(0, 70)}`,
          body: `The website planner's help chat could not fully help a visitor.\n\nMissing: ${reply.missing}\n\nWorth considering as a planner feature or a clearer explanation.`,
          context: 'server/routes/cellarLiteGuideRouter.js',
        }).catch(() => {});
      }
      res.json(reply);
    } catch (err) {
      getLogger().error({ err: err.message }, '[cellar-lite/guide]');
      res.status(err.status && err.status < 500 ? err.status : 503).json({ error: err.status && err.status < 500 ? err.message : 'The help chat could not answer just now. Please try again in a moment.' });
    }
  });

  // ------------------------------------------------------------ POST /email
  router.post('/email', async (req, res) => {
    try {
      if (String(req.body.website ?? '').trim()) return res.json({ ok: true });
      if (!(await enabled())) return res.status(404).json({ error: 'The help chat is not available.' });
      const h = hashIp(ipOf(req));
      if (!hit(`e:${h}`, HOUR, LIMITS.emailPerHour) || !hit(`ed:${h}`, 24 * HOUR, LIMITS.emailPerDay)) {
        return res.status(429).set('Retry-After', '3600').json({ error: 'You have already sent a few chats. Please try again later, or use the Request a quote button.' });
      }
      const turns = tutorEmail.cleanTurns(req.body.turns);
      const mail = sendEmail || require('../utils/sendEmail');
      if (!(await mail.isConfigured())) return res.status(503).json({ error: 'The chat could not be sent right now. Please use the Request a quote button instead.' });
      const { rows } = await pool.query(`SELECT email FROM users WHERE "isAdmin" = TRUE AND email IS NOT NULL AND email <> '' ORDER BY id ASC LIMIT 5`);
      const admins = [...new Set(rows.map((r) => String(r.email).trim()).filter(Boolean))];
      if (!admins.length) return res.status(503).json({ error: 'The chat could not be sent right now. Please use the Request a quote button instead.' });
      const contact = String(req.body.contact ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.contact);
      const who = contact ? `a website visitor (${contact})` : 'a website visitor (no contact details given)';
      const when = new Date(now()).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });
      const guideName = 'Cellar Planner website help';
      const html = tutorEmail.renderEmail({ guideName, who, when, turns, forAdmin: true });
      const replyTo = STRICT_EMAIL.test(contact) ? contact : undefined;
      for (const to of admins) {
        // eslint-disable-next-line no-await-in-loop
        await mail({ to, subject: `[${guideName}] chat from a website visitor`, html, replyTo });
      }
      res.json({ ok: true });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      getLogger().error({ err: err.message }, '[cellar-lite/guide/email]');
      res.status(503).json({ error: 'The chat could not be sent right now. Please use the Request a quote button instead.' });
    }
  });

  return router;
}

module.exports = { createCellarLiteGuideRouter, LIMITS };
