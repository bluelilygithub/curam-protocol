'use strict';

const cron  = require('node-cron');
const { pool } = require('../db');
const { withCronLock } = require('../utils/cronLock');

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// Next occurrence after dateStr. Months are stepped from the original day-of-month (anchorDay), clamped
// to the month's length, so a monthly entry on the 31st goes Jan 31 -> Feb 28 -> Mar 31 instead of
// overflowing into March and staying on the 3rd for ever.
function nextOccurrence(dateStr, frequency, anchorDay) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const anchor = anchorDay || d.getUTCDate();
  const addMonths = (n) => {
    const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
    const y = Math.floor(total / 12), m = total % 12;
    return new Date(Date.UTC(y, m, Math.min(anchor, daysInMonth(y, m))));
  };
  let out;
  switch (frequency) {
    case 'weekly':      d.setUTCDate(d.getUTCDate() + 7);  out = d; break;
    case 'fortnightly': d.setUTCDate(d.getUTCDate() + 14); out = d; break;
    case 'quarterly':   out = addMonths(3);  break;
    case 'annually':    out = addMonths(12); break;
    case 'monthly':
    default:            out = addMonths(1);
  }
  return out.toISOString().slice(0, 10);
}

async function runRecurring() {
  // Workspace-timezone date (UTC would date a morning run as the day before in Brisbane).
  const today = await require('../routes/finance').todayStr();

  const { rows: due } = await pool.query(`
    SELECT * FROM fin_recurring
    WHERE active = TRUE AND "nextDate" <= $1
  `, [today]);

  if (!due.length) return;

  for (const rec of due) {
    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');
      await dbClient.query('SELECT pg_advisory_xact_lock(7001, $1)', [rec.userId]); // same lock as the invoice routes
      const t = rec.template;

      if (rec.type === 'invoice') {
        // Derive payment terms from settings for due date
        const { rows: termRows } = await dbClient.query(
          `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_payment_terms' LIMIT 1`, [rec.userId]
        );
        const termDays = parseInt(termRows[0]?.value) || 7;

        // Get next invoice number
        const year   = new Date().getFullYear();
        const prefix = `INV-${year}`;
        const { rows: numRows } = await dbClient.query(
          `SELECT number FROM fin_invoices WHERE "userId"=$1 AND number LIKE $2 ORDER BY id DESC LIMIT 1`,
          [rec.userId, `${prefix}%`]
        );
        const seq  = numRows.length ? (parseInt(numRows[0].number.slice(prefix.length), 10) || 0) : 0;
        const number = `${prefix}${String(seq + 1).padStart(3, '0')}`;

        const items   = Array.isArray(t.items) ? t.items : [];
        const finRoutes = require('../routes/finance');
        const gstOn   = finRoutes.gstAppliesOn(await finRoutes.getGstRegistration(dbClient, rec.userId), today);
        let subtotal = 0, gst = 0;
        for (const item of items) {
          const qty = parseFloat(item.qty) || 0;
          const up  = parseFloat(item.unitPrice) || 0;
          const amt = parseFloat((qty * up).toFixed(2));
          const taxable = gstOn && (item.gstCode || 'GST') === 'GST';
          const itemGst = taxable ? parseFloat((amt * 0.1).toFixed(2)) : 0;
          item._qty = qty; item._up = up; item._amount = amt; item._gst = itemGst;
          item._gstCode = taxable ? 'GST' : (item.gstCode && item.gstCode !== 'GST' ? item.gstCode : 'NT');
          subtotal += amt; gst += itemGst;
        }
        subtotal = parseFloat(subtotal.toFixed(2));
        gst      = parseFloat(gst.toFixed(2));
        const total   = parseFloat((subtotal + gst).toFixed(2));
        const dueDate = addDays(today, termDays);

        // Templates saved before the fin_clients merge may only carry t.clientId (a retired id). That
        // table was dropped, so the old bridge lookup threw on every run and blocked the whole entry;
        // scripts/backfillInvoiceClientRef.js repoints those templates to clientRef.
        const resolvedClientRef = t.clientRef || null;

        const { rows: invRows } = await dbClient.query(
          `INSERT INTO fin_invoices ("userId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes,"docType")
           VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,'invoice') RETURNING *`,
          [rec.userId, resolvedClientRef, number, today, dueDate, subtotal, gst, total, t.notes||null]
        );
        const invoice = invRows[0];
        for (const item of items) {
          await dbClient.query(
            `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount, "gstCode")
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [invoice.id, item.description||'', item._qty, item._up, item._gst, item._amount, item._gstCode]
          );
        }
        console.log(`[recurring] Created invoice ${number} for user ${rec.userId} (recurring: ${rec.label})`);

      } else if (rec.type === 'expense') {
        const amt    = Math.round((parseFloat(t.amount) || 0) * 100) / 100; // ex-GST
        const finR   = require('../routes/finance');
        const claim  = finR.gstAppliesOn(await finR.getGstRegistration(dbClient, rec.userId), today);
        // not registered: GST in the price is just part of the cost, with no credit to claim
        const gstAmt = claim ? Math.round((parseFloat(t.gst) || 0) * 100) / 100 : 0;
        const amtFull = claim ? amt : Math.round(((parseFloat(t.amount) || 0) + (parseFloat(t.gst) || 0)) * 100) / 100;
        const { rows: expRows } = await dbClient.query(
          `INSERT INTO fin_expenses ("userId", date, description, supplier, amount, gst, category, "txCodeId")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, date`,
          [rec.userId, today, t.description||'', t.supplier||null,
           amtFull, gstAmt, t.category||null, t.txCodeId||null]
        );

        // Same journal as a manually entered expense (DR Expenses, DR GST Paid, CR Bank). Without
        // this the expense showed on lists/BAS but never reached P&L, Balance Sheet or Trial Balance.
        const fin = require('../routes/finance');
        await fin.ensureAccounts(rec.userId);
        const expId   = await fin.accountByCode(rec.userId, '5000');
        const gstId   = await fin.accountByCode(rec.userId, '1200');
        const bankId  = await fin.accountByCode(rec.userId, '1000');
        if (!expId || !bankId) throw new Error('Expenses/Bank account missing — cannot post recurring expense');
        const lines = [
          { accountId: expId,  debit: amtFull, credit: 0 },
          { accountId: bankId, debit: 0,       credit: Math.round((amtFull + gstAmt) * 100) / 100 },
        ];
        if (gstAmt > 0 && gstId) lines.splice(1, 0, { accountId: gstId, debit: gstAmt, credit: 0 });
        else lines[1].credit = amtFull; // no GST to claim / no GST account: keep the entry balanced
        await fin.createJournalEntry(dbClient, rec.userId, {
          date:        today,
          description: `Expense: ${t.description || rec.label || 'Recurring expense'}`,
          type:        'expense',
          sourceId:    expRows[0].id,
          lines,
        });
        console.log(`[recurring] Created expense "${t.description}" for user ${rec.userId} (recurring: ${rec.label})`);
      }

      // Advance from the scheduled date, not from today, so a late run doesn't shift the schedule.
      // Skips periods missed while the server was down (one document is still created, as before).
      const scheduled = String(rec.nextDate instanceof Date
        ? `${rec.nextDate.getFullYear()}-${String(rec.nextDate.getMonth() + 1).padStart(2, '0')}-${String(rec.nextDate.getDate()).padStart(2, '0')}`
        : rec.nextDate).slice(0, 10);
      const anchorDay = parseInt(t._anchorDay, 10) || parseInt(scheduled.slice(8, 10), 10);
      let nextDate = nextOccurrence(scheduled, rec.frequency, anchorDay);
      for (let guard = 0; nextDate <= today && guard < 1000; guard++) nextDate = nextOccurrence(nextDate, rec.frequency, anchorDay);
      if (!t._anchorDay) {
        await dbClient.query(`UPDATE fin_recurring SET template = template || $1::jsonb WHERE id=$2`, [JSON.stringify({ _anchorDay: anchorDay }), rec.id]);
      }
      await dbClient.query(
        `UPDATE fin_recurring SET "nextDate"=$1, "updatedAt"=NOW() WHERE id=$2`,
        [nextDate, rec.id]
      );
      await dbClient.query('COMMIT');
    } catch (err) {
      await dbClient.query('ROLLBACK');
      console.error(`[recurring] Failed for rec ${rec.id}:`, err.message);
    } finally {
      dbClient.release();
    }
  }
}

let task = null;

function startRecurringCron() {
  if (task) return;
  // Run once per day at 00:05 to create any due recurring entries
  task = cron.schedule('5 0 * * *', () => {
    withCronLock('recurring', runRecurring).catch(err => console.error('[recurring] Cron error:', err.message));
  });
  console.log('[recurring] Cron scheduled — daily at 00:05');
}

module.exports = { startRecurringCron, runRecurring, nextOccurrence };
