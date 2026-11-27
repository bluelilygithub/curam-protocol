'use strict';

// Tickets daily digest (docs/tickets.md "Daily digest"): one morning email per person who can use Tickets, listing their open tickets that are
// overdue, due today, and newly assigned to them since their last digest. Nothing is sent when all three are empty. ticket_digest_log keeps
// the day each person was last sent one, so a restart or a second server cannot send twice in a day.

const tickets = require('./tickets');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Today's date (YYYY-MM-DD) in a time zone. */
function dayIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * One person's digest. `since` is when their last digest went (or 24 hours ago). Newly assigned = assigned to them since then by someone
 * else: a ticket raised already assigned to them, or an "Assigned: … → them" history line.
 */
async function digestFor(db, user, { today, since }) {
  const cols = `t.id, t.title, t.type, t.status, t.priority, t."dueDate"::text AS "dueDate", c.name AS "clientName"`;
  const from = `tickets t LEFT JOIN clients c ON c.id = t."clientId"`;
  const { rows: overdue } = await db.query(
    `SELECT ${cols} FROM ${from} WHERE t."assigneeId" = $1 AND t.status NOT IN ('done', 'waiting') AND t."dueDate" < $2::date ORDER BY t."dueDate", t.id`, [user.id, today]);
  const { rows: dueToday } = await db.query(
    `SELECT ${cols} FROM ${from} WHERE t."assigneeId" = $1 AND t.status NOT IN ('done', 'waiting') AND t."dueDate" = $2::date ORDER BY t.priority, t.id`, [user.id, today]);
  const { rows: assigned } = await db.query(
    `SELECT ${cols} FROM ${from}
      WHERE t."assigneeId" = $1 AND t.status <> 'done'
        AND ((t."createdAt" > $2 AND t."createdBy" IS DISTINCT FROM $1)
          OR EXISTS (SELECT 1 FROM ticket_events e WHERE e."ticketId" = t.id AND e.kind = 'change' AND e."createdAt" > $2
                       AND e."userId" IS DISTINCT FROM $1 AND e.body LIKE '%Assigned: % → ' || $3 || '%'))
      ORDER BY t.id`, [user.id, since, user.email]);
  // a ticket is listed once: overdue or due today wins over "newly assigned"
  const shown = new Set([...overdue, ...dueToday].map((t) => t.id));
  return { overdue, dueToday, assigned: assigned.filter((t) => !shown.has(t.id)) };
}

function buildEmail({ digest, appUrl, today }) {
  const link = (t) => `${appUrl.replace(/\/$/, '')}/tickets/${t.id}`;
  const row = (t) => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px 12px;font-size:13px;color:#6b7280;white-space:nowrap;">T-${t.id}</td>
        <td style="padding:8px 12px;font-size:13px;"><a href="${esc(link(t))}" style="color:#1f2937;font-weight:600;text-decoration:none;">${esc(t.title)}</a></td>
        <td style="padding:8px 12px;font-size:13px;color:#374151;">${esc(t.clientName || tickets.TYPE_LABEL[t.type] || '')}</td>
        <td style="padding:8px 12px;font-size:13px;color:#374151;white-space:nowrap;">${t.dueDate ? esc(t.dueDate) : ''}</td>
        <td style="padding:8px 12px;font-size:13px;color:#374151;">${esc(tickets.PRIORITY_LABEL[t.priority] || '')}</td>
      </tr>`;
  const section = (rows, label, color) => (rows.length ? `
      <div style="margin-bottom:24px;">
        <h2 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${color};margin:0 0 8px;">${label} (${rows.length})</h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;">${rows.map(row).join('')}</table>
      </div>` : '');
  const { overdue, dueToday, assigned } = digest;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#1f2937;padding:20px 28px;">
      <h1 style="color:#fff;margin:0;font-size:18px;">Your tickets</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${esc(today)}</p>
    </div>
    <div style="padding:24px 28px;">
      ${section(overdue, 'Overdue', '#dc2626')}
      ${section(dueToday, 'Due today', '#d97706')}
      ${section(assigned, 'Newly assigned to you', '#2563eb')}
      <p style="margin:0;font-size:12px;color:#9ca3af;">Sent each morning when you have tickets overdue, due today or newly assigned. <a href="${esc(`${appUrl.replace(/\/$/, '')}/tickets`)}" style="color:#6b7280;">Open Tickets</a></p>
    </div>
  </div>
</body></html>`;
  const parts = [overdue.length && `${overdue.length} overdue`, dueToday.length && `${dueToday.length} due today`, assigned.length && `${assigned.length} newly assigned`].filter(Boolean);
  return { subject: `Tickets: ${parts.join(', ')}`, html };
}

/**
 * Send today's digests. deps: { pool, sendEmail, people, timeZone, now, appUrl }. Returns { day, sent, empty, already, failed }.
 * Each person is claimed in ticket_digest_log before sending (INSERT ... ON CONFLICT DO UPDATE ... WHERE lastSentOn < today), so only one
 * run a day sends to them; a failed send gives the day back so the next run can try again.
 */
async function runDigest(deps = {}) {
  const pool = deps.pool || require('../db').pool;
  const send = deps.sendEmail || require('../utils/sendEmail');
  const timeZone = deps.timeZone || await require('./complianceAdvisory/cron').getWorkspaceTimezone(pool);
  const now = deps.now || new Date();
  const appUrl = deps.appUrl || process.env.APP_URL || 'http://localhost:5173';
  const today = dayIn(timeZone, now);
  const people = await (deps.people || ((db) => tickets.people(db)))(pool);
  const out = { day: today, sent: 0, empty: 0, already: 0, failed: 0 };
  for (const p of people) {
    const { rows: prev } = await pool.query('SELECT "lastSentOn"::text AS day, "lastSentAt" FROM ticket_digest_log WHERE "userId" = $1', [p.id]);
    if (prev[0] && prev[0].day >= today) { out.already += 1; continue; }
    const since = prev[0]?.lastSentAt || new Date(now.getTime() - 24 * 3600 * 1000);
    const digest = await digestFor(pool, p, { today, since });
    if (!digest.overdue.length && !digest.dueToday.length && !digest.assigned.length) { out.empty += 1; continue; }
    const { rowCount } = await pool.query(
      `INSERT INTO ticket_digest_log ("userId", "lastSentOn", "lastSentAt") VALUES ($1, $2::date, $3)
       ON CONFLICT ("userId") DO UPDATE SET "lastSentOn" = EXCLUDED."lastSentOn", "lastSentAt" = EXCLUDED."lastSentAt"
       WHERE ticket_digest_log."lastSentOn" < EXCLUDED."lastSentOn"`, [p.id, today, now]);
    if (!rowCount) { out.already += 1; continue; }
    try {
      const { subject, html } = buildEmail({ digest, appUrl, today });
      const r = await send({ to: p.email, subject, html });
      if (r && r.ok === false && !r.skipped) throw new Error(r.reason || 'send failed');
      out.sent += 1;
    } catch (err) {
      out.failed += 1;
      // give the day back so the next run tries again
      if (prev[0]) await pool.query('UPDATE ticket_digest_log SET "lastSentOn" = $2::date, "lastSentAt" = $3 WHERE "userId" = $1', [p.id, prev[0].day, prev[0].lastSentAt]);
      else await pool.query('DELETE FROM ticket_digest_log WHERE "userId" = $1', [p.id]);
      console.warn(`[tickets-digest] email to user ${p.id} failed:`, err.message);
    }
  }
  return out;
}

module.exports = { dayIn, digestFor, buildEmail, runDigest };
