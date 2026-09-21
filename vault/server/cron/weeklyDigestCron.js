'use strict';

// Weekly Digest — ties CRM, Finance, Tasks, and the Suggestions inbox into one
// Monday-morning email per admin. Reuses the same fin_admin_email/fin_biz_name
// settings and sendEmail/buildEmailHtml pattern as financeRemindersCron.js
// rather than inventing a second config surface. See CLAUDE.md §"Agent
// suggestions inbox" — this is the consumer-facing counterpart: crons write
// suggestions all week, this reads them back out in one place.

const cron = require('node-cron');
const { pool } = require('../db');

function fmtAud(n) {
  const v = parseFloat(n || 0).toFixed(2);
  const [int, dec] = v.split('.');
  return '$' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function section(label, rowsHtml, cols) {
  if (!rowsHtml) return '';
  return `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 10px;">${label}</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead><tr style="background:#f9fafb;">${cols.map(c => `<th style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:${c.right ? 'right' : 'left'};text-transform:uppercase;letter-spacing:0.05em;">${c.label}</th>`).join('')}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

function row(cells) {
  return `<tr style="border-bottom:1px solid #e5e7eb;">${cells.map(c => `<td style="padding:10px 12px;font-size:13px;color:#374151;${c.strong ? 'font-weight:600;color:#1f2937;' : ''}${c.right ? 'text-align:right;' : ''}${c.warn ? 'color:#dc2626;font-weight:600;' : ''}">${c.text}</td>`).join('')}</tr>`;
}

function buildDigestHtml({ bizName, suggestions, overdueTasks, unpaidTotal, unpaidCount, staleClients, sharesLine }) {
  const header = `
    <div style="background:#1f2937;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Weekly Digest</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${bizName || 'Your business'} &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>`;

  const statsRow = `
    <div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap;">
      ${[
        [`${suggestions.length}`, 'Open suggestions'],
        [`${overdueTasks.length}`, 'Overdue tasks'],
        [fmtAud(unpaidTotal), `Unpaid (${unpaidCount})`],
        [`${staleClients.length}`, 'Stale clients (14d+)'],
      ].map(([num, label]) => `
        <div style="flex:1;min-width:130px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#1f2937;">${num}</p>
          <p style="margin:2px 0 0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">${label}</p>
        </div>`).join('')}
    </div>`;

  const suggestionsHtml = section('Suggestions Inbox — Needs Triage', suggestions.map(s =>
    row([{ text: s.category, strong: true }, { text: s.title }, { text: s.source || '—' }])).join(''),
    [{ label: 'Category' }, { label: 'Title' }, { label: 'Source' }]);

  const tasksHtml = section('Overdue Tasks', overdueTasks.map(t =>
    row([{ text: t.title, strong: true }, { text: t.dueDate }, { text: t.priority, warn: t.priority === 'high' }])).join(''),
    [{ label: 'Task' }, { label: 'Due' }, { label: 'Priority' }]);

  const clientsHtml = section('Clients With No Activity in 14+ Days', staleClients.map(c =>
    row([{ text: c.name, strong: true }, { text: c.lastActivity || 'Never' }])).join(''),
    [{ label: 'Client' }, { label: 'Last Activity' }]);

  const financeLine = unpaidCount
    ? `<p style="margin:0 0 20px;font-size:13px;color:#6b7280;">${unpaidCount} unpaid invoice${unpaidCount !== 1 ? 's' : ''} totalling <strong style="color:#1f2937;">${fmtAud(unpaidTotal)}</strong> — see Finance for detail.</p>`
    : '';

  const empty = !suggestions.length && !overdueTasks.length && !unpaidCount && !staleClients.length;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    ${header}
    <div style="padding:28px 32px;">
      ${statsRow}
      ${empty ? '<p style="margin:0 0 20px;font-size:14px;color:#374151;">Nothing needs attention this week. Clean slate.</p>' : ''}
      ${financeLine}
      ${suggestionsHtml}
      ${tasksHtml}
      ${clientsHtml}
      ${sharesLine ? `<p style="margin:0 0 20px;font-size:13px;color:#374151;">${sharesLine}</p>` : ''}
      <p style="margin:0;font-size:12px;color:#9ca3af;">Automated weekly digest, sent every Monday morning. Pulls from Suggestions, Tasks, Finance, CRM${sharesLine ? ', Shares' : ''}.</p>
    </div>
  </div>
</body>
</html>`;
}

async function runWeeklyDigest(onlyUserId = null) {
  const { rows: adminRows } = await pool.query(`
    SELECT "userId", value AS admin_email
    FROM settings
    WHERE key = 'fin_admin_email' AND value IS NOT NULL AND value <> ''
    ${onlyUserId ? 'AND "userId" = $1' : ''}
  `, onlyUserId ? [onlyUserId] : []);

  if (!adminRows.length) return { sent: false };

  const sendEmail = require('../utils/sendEmail');
  let anySent = false;

  for (const { userId, admin_email } of adminRows) {
    try {
      const { rows: bizRows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_biz_name'`, [userId]);
      const bizName = bizRows[0]?.value || '';

      const { rows: suggestions } = await pool.query(`
        SELECT category, title, source FROM agent_suggestions
        WHERE "userId" = $1 AND status = 'new'
        ORDER BY "createdAt" DESC LIMIT 15
      `, [userId]);

      const { rows: overdueTasks } = await pool.query(`
        SELECT title, "dueDate", priority FROM tasks
        WHERE "userId" = $1 AND status != 'done' AND "dueDate" IS NOT NULL AND "dueDate"::date < CURRENT_DATE
        ORDER BY "dueDate" ASC LIMIT 15
      `, [userId]).catch(() => ({ rows: [] })); // tasks may not have userId filter available on old rows

      const { rows: unpaidRows } = await pool.query(`
        SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count FROM fin_invoices
        WHERE "userId" = $1 AND "docType" = 'invoice' AND status = 'sent'
      `, [userId]).catch(() => ({ rows: [{ total: 0, count: 0 }] }));
      const unpaidTotal = Number(unpaidRows[0]?.total || 0);
      const unpaidCount = Number(unpaidRows[0]?.count || 0);

      const { rows: staleClients } = await pool.query(`
        SELECT c.name, MAX(ci.date)::date AS "lastActivity"
        FROM clients c
        LEFT JOIN client_interactions ci ON ci."clientId" = c.id
        WHERE c."userId" = $1 AND c.status = 'active'
        GROUP BY c.id, c.name
        HAVING MAX(ci.date) IS NULL OR MAX(ci.date) < NOW() - INTERVAL '14 days'
        ORDER BY "lastActivity" ASC NULLS FIRST LIMIT 15
      `, [userId]).catch(() => ({ rows: [] }));

      const empty = !suggestions.length && !overdueTasks.length && !unpaidCount && !staleClients.length;
      if (empty) continue; // no email when there's nothing to report

      const html = buildDigestHtml({ bizName, suggestions, overdueTasks, unpaidTotal, unpaidCount, staleClients, sharesLine: null });
      const subject = `Weekly digest${bizName ? ` — ${bizName}` : ''}: ${suggestions.length + overdueTasks.length + staleClients.length} items to review`;

      await sendEmail({ to: admin_email, subject, html });
      anySent = true;
      console.log(`[weekly-digest] Sent to ${admin_email} for user ${userId}`);
    } catch (err) {
      console.error(`[weekly-digest] Failed for user ${userId}:`, err.message);
    }
  }
  return { sent: anySent };
}

let task = null;

function startWeeklyDigestCron() {
  if (task) return;
  // Monday 07:30 server time — after the finance-reminders hourly Monday sweep
  // has had a chance to run at :00, before the workday starts.
  task = cron.schedule('30 7 * * 1', () => {
    runWeeklyDigest().catch(err => console.error('[weekly-digest] Cron error:', err.message));
  });
  console.log('[weekly-digest] Cron scheduled — Mondays 07:30');
}

module.exports = { startWeeklyDigestCron, runWeeklyDigest };
