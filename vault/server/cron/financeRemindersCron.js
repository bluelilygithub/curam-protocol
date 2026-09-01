'use strict';

const cron = require('node-cron');
const { pool } = require('../db');

function fmtDate(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtAud(n) {
  const v = parseFloat(n || 0).toFixed(2);
  const [int, dec] = v.split('.');
  return '$' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function daysOverdue(dueDate) {
  const due = new Date(String(dueDate).slice(0, 10) + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - due) / 86400000);
}

function buildEmailHtml({ bizName, overdueQuotes, overdueInvoices }) {
  const header = `
    <div style="background:#1f2937;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Finance Reminders</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${bizName || 'Daily summary'}  &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </div>`;

  function table(rows, label) {
    if (!rows.length) return '';
    const rowsHtml = rows.map(r => `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;color:#1f2937;font-weight:600;">${r.number}</td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">${r.clientName || '—'}</td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">${fmtDate(r.dueDate)}</td>
        <td style="padding:10px 12px;font-size:13px;color:#dc2626;font-weight:600;">${daysOverdue(r.dueDate)} day${daysOverdue(r.dueDate) !== 1 ? 's' : ''} overdue</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:700;color:#1f2937;text-align:right;">${fmtAud(r.total)}</td>
      </tr>`).join('');

    return `
      <div style="margin-bottom:28px;">
        <h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:0 0 10px;">${label}</h2>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Ref</th>
              <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Client</th>
              <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">${label.includes('Quote') ? 'Valid Until' : 'Due Date'}</th>
              <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:left;text-transform:uppercase;letter-spacing:0.05em;">Status</th>
              <th style="padding:8px 12px;font-size:11px;font-weight:600;color:#6b7280;text-align:right;text-transform:uppercase;letter-spacing:0.05em;">Amount</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  const quotesSection   = table(overdueQuotes,   `Unanswered Quotes (${overdueQuotes.length})`);
  const invoicesSection = table(overdueInvoices, `Unpaid Invoices (${overdueInvoices.length})`);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    ${header}
    <div style="padding:28px 32px;">
      ${quotesSection}
      ${invoicesSection}
      <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated daily reminder. No action is required if items have already been handled.</p>
    </div>
  </div>
</body>
</html>`;
}

async function runFinanceReminders(onlyUserId = null) {
  const today = new Date().toISOString().slice(0, 10);

  // Find users with fin_admin_email configured (or a specific user for the test endpoint)
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
    // Overdue quotes: draft or sent, past their valid-until date
    const { rows: overdueQuotes } = await pool.query(`
      SELECT i.number, i.total, i."dueDate",
             COALESCE(fc.name, cr.name) AS "clientName"
      FROM fin_invoices i
      LEFT JOIN fin_clients fc ON fc.id = i."clientId"
      LEFT JOIN clients cr     ON cr.id = i."clientRef"
      WHERE i."userId" = $1
        AND i."docType" = 'quote'
        AND i.status IN ('draft', 'sent')
        AND i."dueDate" IS NOT NULL
        AND i."dueDate"::date < $2::date
      ORDER BY i."dueDate" ASC
    `, [userId, today]);

    // Overdue invoices: sent but not paid, past due date
    const { rows: overdueInvoices } = await pool.query(`
      SELECT i.number, i.total, i."dueDate",
             COALESCE(fc.name, cr.name) AS "clientName"
      FROM fin_invoices i
      LEFT JOIN fin_clients fc ON fc.id = i."clientId"
      LEFT JOIN clients cr     ON cr.id = i."clientRef"
      WHERE i."userId" = $1
        AND i."docType" = 'invoice'
        AND i.status = 'sent'
        AND i."dueDate" IS NOT NULL
        AND i."dueDate"::date < $2::date
      ORDER BY i."dueDate" ASC
    `, [userId, today]);

    if (!overdueQuotes.length && !overdueInvoices.length) continue;

    // Get business name for the email header
    const { rows: settingRows } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId" = $1 AND key = 'fin_biz_name'`,
      [userId]
    );
    const bizName = settingRows[0]?.value || '';

    const totalItems  = overdueQuotes.length + overdueInvoices.length;
    const subject     = `Finance reminder: ${totalItems} item${totalItems !== 1 ? 's' : ''} need attention${bizName ? ` — ${bizName}` : ''}`;
    const html        = buildEmailHtml({ bizName, overdueQuotes, overdueInvoices });

    try {
      await sendEmail({ to: admin_email, subject, html });
      anySent = true;
      console.log(`[finance-reminders] Sent to ${admin_email}: ${overdueQuotes.length} quotes, ${overdueInvoices.length} invoices`);
    } catch (err) {
      console.error(`[finance-reminders] Failed for user ${userId}:`, err.message);
    }
  }
  return { sent: anySent };
}

let task = null;

function startFinanceRemindersCron() {
  if (task) return;
  // Run daily at 08:00 server time
  task = cron.schedule('0 8 * * *', () => {
    runFinanceReminders().catch(err => console.error('[finance-reminders] cron error:', err.message));
  });
  console.log('[finance-reminders] Cron scheduled — daily at 08:00');
}

module.exports = { startFinanceRemindersCron, runFinanceReminders };
