'use strict';

// "Email this conversation" for the guide chats (PDF guide, Graphics guide, Video Tools tutor, Finance guide).
// At the end of a chat the person can send the conversation log to themselves and/or to the workspace admin(s).
//
//  - Only the conversation the browser sends is emailed (what they typed and what the guide answered). The guides never see files.
//  - Nothing is sent unless the person presses the button and picks the recipients. There is no automatic copy to the admin.
//  - The admin copy is a separate email with the person's address as Reply-To, so the admin can answer them directly.
//  - Everything is validated, length-limited and HTML-escaped; the person's own text never becomes markup.
//  - 10 emails an hour per person.
//
// Mounted in server/index.js at /api/tutor-email behind requireAuth.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();

// id -> display name, from the one registry every guide is listed in (server/config/guides.js)
const GUIDES = Object.fromEntries(Object.entries(require('../config/guides').GUIDES).map(([id, g]) => [id, g.name]));
const MAX_TURNS = 60;

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  message: { error: 'You have sent a lot of conversation emails this hour. Try again later.' },
});

const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const para = (s) => escapeHtml(s).replace(/\n/g, '<br>');

/** Turn whatever the browser sent into a bounded, known shape. Throws a 400 for anything unusable. */
function cleanTurns(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_TURNS) : [];
  const turns = [];
  for (const t of list) {
    if (t?.role === 'user') {
      const text = clip(t.text, 2000);
      if (text) turns.push({ role: 'user', text });
    } else if (t?.role === 'guide') {
      const steps = (Array.isArray(t.steps) ? t.steps : []).slice(0, 8)
        .map((s) => ({ label: clip(s?.label, 120), do: clip(s?.do, 400) })).filter((s) => s.label || s.do);
      const turn = { role: 'guide', verdict: clip(t.verdictLabel, 60), answer: clip(t.answer, 2000), steps, missing: clip(t.missing, 600), tip: clip(t.tip, 300) };
      if (turn.answer || steps.length || turn.missing) turns.push(turn);
    }
  }
  if (!turns.some((t) => t.role === 'user') || !turns.some((t) => t.role === 'guide')) {
    throw Object.assign(new Error('There is no conversation to send yet.'), { status: 400 });
  }
  return turns;
}

function renderEmail({ guideName, who, when, turns, forAdmin }) {
  const blocks = turns.map((t) => {
    if (t.role === 'user') {
      return `<tr><td style="padding:6px 0"><div style="font-size:11px;color:#888;margin-bottom:2px">You asked</div><div style="background:#f3ece8;border-radius:10px;padding:10px 12px;font-size:14px;color:#1a1a1a">${para(t.text)}</div></td></tr>`;
    }
    const steps = t.steps.length
      ? `<ol style="margin:8px 0 0 18px;padding:0;font-size:14px;color:#1a1a1a">${t.steps.map((s) => `<li style="margin-bottom:6px"><strong>${escapeHtml(s.label)}</strong><br><span style="color:#555">${para(s.do)}</span></li>`).join('')}</ol>`
      : '';
    return `<tr><td style="padding:6px 0"><div style="font-size:11px;color:#888;margin-bottom:2px">${escapeHtml(guideName)}${t.verdict ? ` · ${escapeHtml(t.verdict)}` : ''}</div>`
      + `<div style="border:1px solid #ddd;border-radius:10px;padding:10px 12px;font-size:14px;color:#1a1a1a">${t.answer ? para(t.answer) : ''}${steps}`
      + `${t.missing ? `<div style="margin-top:8px;padding:6px 8px;border:1px solid #f59e0b;border-radius:8px;font-size:13px"><strong>What is missing:</strong> ${para(t.missing)}</div>` : ''}`
      + `${t.tip ? `<div style="margin-top:8px;font-size:12px;font-style:italic;color:#666">Tip: ${para(t.tip)}</div>` : ''}</div></td></tr>`;
  }).join('');
  const intro = forAdmin
    ? `${escapeHtml(who)} chose to email you this conversation from the ${escapeHtml(guideName)}. Reply to this email to answer them.`
    : `Here is a copy of your conversation with the ${escapeHtml(guideName)}.`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:16px">`
    + `<h2 style="margin:0 0 4px;font-size:18px;color:#1a1a1a">${escapeHtml(guideName)} conversation</h2>`
    + `<p style="margin:0 0 12px;font-size:12px;color:#888">${escapeHtml(when)} · ${escapeHtml(who)}</p>`
    + `<p style="margin:0 0 12px;font-size:14px;color:#1a1a1a">${intro}</p>`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${blocks}</table>`
    + `<p style="margin:16px 0 0;font-size:11px;color:#888">Sent from Curam Vault. The guide only sees what was typed in the chat, never your files.</p></div>`;
}

/**
 * @param {{ id:number, email:string }} user
 * @param {{ guide:string, turns:any[], toMe:boolean, toAdmin:boolean }} body
 * deps (for tests): { sendEmail, isConfigured, getAdminEmails, getTimezone, now }
 */
async function sendTutorEmails(user, body, deps = {}) {
  const guideName = GUIDES[body?.guide];
  if (!guideName) throw Object.assign(new Error('Unknown guide.'), { status: 400 });
  const toMe = body?.toMe === true; const toAdmin = body?.toAdmin === true;
  if (!toMe && !toAdmin) throw Object.assign(new Error('Pick who to send it to.'), { status: 400 });
  const turns = cleanTurns(body?.turns);

  const sendEmail = deps.sendEmail || require('../utils/sendEmail');
  const configured = await (deps.isConfigured || (() => sendEmail.isConfigured()))();
  if (!configured) throw Object.assign(new Error('Email is not set up on this server yet, so the conversation could not be sent.'), { status: 503 });
  const myEmail = String(user?.email || '').trim();
  if (toMe && !myEmail) throw Object.assign(new Error('Your account has no email address to send to.'), { status: 400 });

  const tz = (await (deps.getTimezone || defaultTimezone)()) || 'Australia/Sydney';
  const when = (deps.now || (() => new Date()))().toLocaleString('en-AU', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
  const who = myEmail || 'a Vault user';

  let admins = [];
  if (toAdmin) {
    admins = [...new Set(((await (deps.getAdminEmails || defaultAdminEmails)()) || []).map((e) => String(e).trim()).filter(Boolean))]
      .filter((e) => !(toMe && e.toLowerCase() === myEmail.toLowerCase())); // no second copy to the same person
    if (!admins.length && !toMe) throw Object.assign(new Error('There is no admin email address set up to send to.'), { status: 400 });
  }

  let me = false;
  if (toMe) {
    await sendEmail({ to: myEmail, subject: `${guideName} conversation, ${when}`, html: renderEmail({ guideName, who, when, turns, forAdmin: false }) });
    me = true;
  }
  for (const to of admins) {
    // eslint-disable-next-line no-await-in-loop
    await sendEmail({ to, subject: `[${guideName}] conversation from ${who}`, html: renderEmail({ guideName, who, when, turns, forAdmin: true }), replyTo: myEmail || undefined });
  }
  return { ok: true, me, admins: admins.length };
}

async function defaultAdminEmails() {
  const { pool } = require('../db');
  const { rows } = await pool.query(`SELECT email FROM users WHERE "isAdmin" = TRUE AND email IS NOT NULL AND email <> '' ORDER BY id ASC LIMIT 5`);
  return rows.map((r) => r.email);
}

async function defaultTimezone() {
  try {
    const { pool } = require('../db');
    const { rows } = await pool.query(`SELECT s.value FROM settings s JOIN users u ON u.id = s."userId" WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE ORDER BY u.id ASC LIMIT 1`);
    return rows[0]?.value?.trim() || null;
  } catch { return null; }
}

router.post('/', limiter, async (req, res) => {
  try {
    const out = await sendTutorEmails(req.user, req.body || {});
    res.json(out);
  } catch (err) {
    const { getLogger } = require('../middleware/requestContext');
    getLogger().error({ err }, '[tutor-email]');
    res.status(err.status || 500).json({ error: err.status ? err.message : 'The conversation could not be emailed just now. Try again in a moment.' });
  }
});

router.sendTutorEmails = sendTutorEmails;
router.renderEmail = renderEmail;
router.cleanTurns = cleanTurns;
router.GUIDES = GUIDES;
module.exports = router;
