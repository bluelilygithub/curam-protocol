'use strict';

const cron = require('node-cron');
const { pool } = require('../db');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');

// Must stay in sync with `finYearForDate()` in server/routes/finance.js and FinancePage.jsx.
function finYearForDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 6 ? y : y - 1; // month 6 = July (0-indexed)
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

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
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${bizName || 'Weekly summary'}  &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
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
      <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated weekly reminder sent every Monday. No action is required if items have already been handled.</p>
    </div>
  </div>
</body>
</html>`;
}

function buildClientReminderHtml({ bizName, inv, days, docType }) {
  const isQuote   = docType === 'quote';
  const docLabel  = isQuote ? 'Quote' : 'Invoice';
  const dueLabel  = isQuote ? 'valid until' : 'due';
  const actionMsg = isQuote
    ? `This quote expired ${days} day${days !== 1 ? 's' : ''} ago. Please let us know if you'd like to proceed or if you have any questions.`
    : `This invoice is ${days} day${days !== 1 ? 's' : ''} overdue. Please arrange payment at your earliest convenience.`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1f2937;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">${docLabel} ${inv.number}</h1>
      ${bizName ? `<p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${bizName}</p>` : ''}
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#1f2937;">Hi ${inv.clientName || 'there'},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">${actionMsg}</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:12px 16px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#dc2626;">${docLabel} ${dueLabel} ${fmtDate(inv.dueDate)}</p>
            <p style="margin:0;font-size:18px;font-weight:700;color:#dc2626;">${fmtAud(inv.total)}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">If you have already attended to this, please disregard this message.</p>
    </div>
    <div style="padding:16px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;">
      ${bizName || ''}
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
  // Fix overdue-quotes query: only include sent quotes (not drafts that were never sent)
  const { rows: overdueQuotes } = await pool.query(`
      SELECT i.number, i.total, i."dueDate", i.id,
             COALESCE(fc.name, cr.name) AS "clientName",
             COALESCE(fc.email,
               (SELECT cc.email FROM client_contacts cc
                WHERE cc."clientId" = cr.id AND cc.email IS NOT NULL
                ORDER BY cc."isPrimary" DESC, cc.id ASC LIMIT 1)
             ) AS "clientEmail"
      FROM fin_invoices i
      LEFT JOIN fin_clients fc ON fc.id = i."clientId"
      LEFT JOIN clients cr     ON cr.id = i."clientRef"
      WHERE i."userId" = $1
        AND i."docType" = 'quote'
        AND i.status = 'sent'
        AND i."dueDate" IS NOT NULL
        AND i."dueDate"::date < $2::date
      ORDER BY i."dueDate" ASC
    `, [userId, today]);

    // Overdue invoices: sent but not paid, past due date
    const { rows: overdueInvoices } = await pool.query(`
      SELECT i.number, i.total, i."dueDate", i.id,
             COALESCE(fc.name, cr.name) AS "clientName",
             COALESCE(fc.email,
               (SELECT cc.email FROM client_contacts cc
                WHERE cc."clientId" = cr.id AND cc.email IS NOT NULL
                ORDER BY cc."isPrimary" DESC, cc.id ASC LIMIT 1)
             ) AS "clientEmail"
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

    // 1. Admin summary email
    const totalItems  = overdueQuotes.length + overdueInvoices.length;
    const subject     = `Finance reminder: ${totalItems} item${totalItems !== 1 ? 's' : ''} need attention${bizName ? ` — ${bizName}` : ''}`;
    const html        = buildEmailHtml({ bizName, overdueQuotes, overdueInvoices });

    try {
      await sendEmail({ to: admin_email, subject, html });
      anySent = true;
      console.log(`[finance-reminders] Admin summary sent to ${admin_email}: ${overdueQuotes.length} quotes, ${overdueInvoices.length} invoices`);
    } catch (err) {
      console.error(`[finance-reminders] Admin summary failed for user ${userId}:`, err.message);
    }

    // 2. Individual client reminder emails for overdue invoices
    for (const inv of overdueInvoices) {
      if (!inv.clientEmail) continue;
      const days = daysOverdue(inv.dueDate);
      const clientSubject = `Payment reminder: ${inv.number}${bizName ? ` from ${bizName}` : ''}`;
      const clientHtml = buildClientReminderHtml({ bizName, inv, days, docType: 'invoice' });
      try {
        await sendEmail({ to: inv.clientEmail, subject: clientSubject, html: clientHtml });
        console.log(`[finance-reminders] Client reminder sent to ${inv.clientEmail} for invoice ${inv.number}`);
      } catch (err) {
        console.error(`[finance-reminders] Client reminder failed for ${inv.number}:`, err.message);
      }
    }

    // 3. Individual client reminder emails for expired quotes
    for (const q of overdueQuotes) {
      if (!q.clientEmail) continue;
      const days = daysOverdue(q.dueDate);
      const clientSubject = `Quote follow-up: ${q.number}${bizName ? ` from ${bizName}` : ''}`;
      const clientHtml = buildClientReminderHtml({ bizName, inv: q, days, docType: 'quote' });
      try {
        await sendEmail({ to: q.clientEmail, subject: clientSubject, html: clientHtml });
        console.log(`[finance-reminders] Client reminder sent to ${q.clientEmail} for quote ${q.number}`);
      } catch (err) {
        console.error(`[finance-reminders] Client reminder failed for ${q.number}:`, err.message);
      }
    }
  }
  return { sent: anySent };
}

function buildAnnualVhoReminderHtml({ bizName, fyLabel, vLocked, hLocked }) {
  const items = [];
  if (!vLocked) items.push('Vehicle claim method (cents-per-km or logbook)');
  if (!hLocked) items.push('Home office claim method (fixed-rate or actual-cost)');
  const itemsHtml = items.map(i => `<li style="margin-bottom:6px;">${i}</li>`).join('');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#1f2937;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">FY${fyLabel} vehicle/home office method</h1>
      ${bizName ? `<p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:13px;">${bizName}</p>` : ''}
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#1f2937;">FY${fyLabel} starts 1 July. The ATO requires one method per financial year for vehicle and home office claims, locked before you log entries against it.</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;">Not yet locked for FY${fyLabel}:</p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#374151;">${itemsHtml}</ul>
      <p style="margin:0;font-size:13px;color:#6b7280;">Go to Finance → Settings → Vehicle &amp; Home Office to review and lock the method(s) for the new financial year.</p>
    </div>
  </div>
</body>
</html>`;
}

// Once-a-year nudge, fired in a window around 1 July (AU financial year start) rather than a
// fixed date, so a brief downtime doesn't skip it entirely. Dedupes per user per calendar year
// via the `fin_annual_vho_reminder_year` settings key. Reuses the Suggestions inbox (low-urgency,
// once-a-year prompt — a better fit than a dedicated channel) plus the same admin-email pattern
// already used for the weekly overdue reminders above.
async function checkAnnualVehicleHoReminder() {
  const today = new Date();
  const month = today.getMonth(); // 0-indexed; June = 5, July = 6
  const day   = today.getDate();
  const inWindow = (month === 5 && day >= 25) || (month === 6 && day <= 14);
  if (!inWindow) return;

  const nowYear = today.getFullYear();
  const fyLabel = finYearForDate(today.toISOString().slice(0, 10));

  const { rows: adminRows } = await pool.query(`
    SELECT "userId", value AS admin_email FROM settings
    WHERE key = 'fin_admin_email' AND value IS NOT NULL AND value <> ''
  `);
  if (!adminRows.length) return;

  const sendEmail = require('../utils/sendEmail');

  for (const { userId, admin_email } of adminRows) {
    try {
      const { rows: sentRows } = await pool.query(
        `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_annual_vho_reminder_year'`, [userId]
      );
      if (sentRows[0]?.value === String(nowYear)) continue;

      const { rows: vRows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_vehicle_method_by_year'`, [userId]);
      const { rows: hRows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_home_office_method_by_year'`, [userId]);
      let vMap = {}, hMap = {};
      try { vMap = JSON.parse(vRows[0]?.value || '{}') || {}; } catch {}
      try { hMap = JSON.parse(hRows[0]?.value || '{}') || {}; } catch {}
      const vLocked = !!vMap[fyLabel];
      const hLocked = !!hMap[fyLabel];

      const markSent = () => pool.query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1,'fin_annual_vho_reminder_year',$2)
         ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [userId, String(nowYear)]
      );

      if (vLocked && hLocked) { await markSent(); continue; }

      await captureIf(true, {
        userId,
        source: 'financeRemindersCron',
        category: 'alert',
        fingerprint: makeFingerprint('financeRemindersCron', `vho-method-lock:${fyLabel}`),
        title: `Lock vehicle/home office method for FY${fyLabel}`,
        body: `FY${fyLabel} starts 1 July. ${!vLocked ? 'Vehicle claim method is not yet locked. ' : ''}${!hLocked ? 'Home office claim method is not yet locked. ' : ''}Go to Finance → Settings → Vehicle & Home Office to lock the method(s) before logging any entries dated in this financial year.`,
        context: 'Finance → Settings → Vehicle & Home Office',
      });

      const { rows: bizRows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='fin_biz_name'`, [userId]);
      const bizName = bizRows[0]?.value || '';
      try {
        await sendEmail({
          to: admin_email,
          subject: `Lock your FY${fyLabel} vehicle/home office method${bizName ? ` — ${bizName}` : ''}`,
          html: buildAnnualVhoReminderHtml({ bizName, fyLabel, vLocked, hLocked }),
        });
        console.log(`[finance-reminders] Annual vehicle/home office nudge sent to ${admin_email} for FY${fyLabel}`);
      } catch (err) {
        console.error(`[finance-reminders] Annual vehicle/home office email failed for user ${userId}:`, err.message);
      }

      await markSent();
    } catch (err) {
      console.error(`[finance-reminders] Annual vehicle/home office check failed for user ${userId}:`, err.message);
    }
  }
}

let task = null;
let annualVhoTask = null;

function startFinanceRemindersCron() {
  if (task) return;
  // Run at the top of every hour on Mondays; inside, check each user's configured reminder hour
  // (fin_reminder_hour setting, default 8) and only fire when it matches
  task = cron.schedule('0 * * * 1', async () => {
    const currentHour = new Date().getHours(); // server local hour
    try {
      // Find users whose configured reminder hour matches now (or who haven't set one and it's 8am)
      const { rows: adminRows } = await pool.query(`
        SELECT s."userId", s.value AS admin_email,
               COALESCE(
                 (SELECT CAST(value AS INTEGER) FROM settings
                  WHERE "userId" = s."userId" AND key = 'fin_reminder_hour' LIMIT 1),
                 8
               ) AS reminder_hour
        FROM settings s
        WHERE s.key = 'fin_admin_email' AND s.value IS NOT NULL AND s.value <> ''
      `);
      const matchingUserIds = adminRows
        .filter(r => parseInt(r.reminder_hour) === currentHour)
        .map(r => r.userId);
      for (const userId of matchingUserIds) {
        runFinanceReminders(userId).catch(err =>
          console.error(`[finance-reminders] Error for user ${userId}:`, err.message)
        );
      }
    } catch (err) {
      console.error('[finance-reminders] Cron scheduling error:', err.message);
    }
  });
  console.log('[finance-reminders] Cron scheduled — runs hourly on Mondays, fires per-user at configured hour (default 08:00)');

  if (annualVhoTask) return;
  // Daily at 08:00 server time; checkAnnualVehicleHoReminder() no-ops outside the ~25 Jun – 14 Jul window.
  annualVhoTask = cron.schedule('0 8 * * *', () => {
    checkAnnualVehicleHoReminder().catch(err =>
      console.error('[finance-reminders] Annual vehicle/home office cron error:', err.message)
    );
  });
  console.log('[finance-reminders] Annual vehicle/home office cron scheduled — checks daily, fires once per year around 1 July');
}

module.exports = { startFinanceRemindersCron, runFinanceReminders, checkAnnualVehicleHoReminder };
