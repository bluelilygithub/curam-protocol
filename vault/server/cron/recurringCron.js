'use strict';

const cron  = require('node-cron');
const { pool } = require('../db');

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function nextOccurrence(dateStr, frequency) {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':      d.setDate(d.getDate() + 7);  break;
    case 'fortnightly': d.setDate(d.getDate() + 14); break;
    case 'monthly':     d.setMonth(d.getMonth() + 1); break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
    case 'annually':    d.setFullYear(d.getFullYear() + 1); break;
    default:            d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

async function runRecurring() {
  const today = new Date().toISOString().slice(0, 10);

  const { rows: due } = await pool.query(`
    SELECT * FROM fin_recurring
    WHERE active = TRUE AND "nextDate" <= $1
  `, [today]);

  if (!due.length) return;

  for (const rec of due) {
    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');
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
        let subtotal = 0, gst = 0;
        for (const item of items) {
          const qty = parseFloat(item.qty) || 0;
          const up  = parseFloat(item.unitPrice) || 0;
          const amt = parseFloat((qty * up).toFixed(2));
          const itemGst = item.gstCode !== 'NT' ? parseFloat((amt * 0.1).toFixed(2)) : 0;
          item._qty = qty; item._up = up; item._amount = amt; item._gst = itemGst;
          subtotal += amt; gst += itemGst;
        }
        subtotal = parseFloat(subtotal.toFixed(2));
        gst      = parseFloat(gst.toFixed(2));
        const total   = parseFloat((subtotal + gst).toFixed(2));
        const dueDate = addDays(today, termDays);

        const { rows: invRows } = await dbClient.query(
          `INSERT INTO fin_invoices ("userId","clientId","clientRef",number,status,"issueDate","dueDate",subtotal,gst,total,notes,"docType")
           VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,'invoice') RETURNING *`,
          [rec.userId, t.clientId||null, t.clientRef||null, number, today, dueDate, subtotal, gst, total, t.notes||null]
        );
        const invoice = invRows[0];
        for (const item of items) {
          await dbClient.query(
            `INSERT INTO fin_invoice_items ("invoiceId", description, qty, "unitPrice", gst, amount, "gstCode")
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [invoice.id, item.description||'', item._qty, item._up, item._gst, item._amount, item.gstCode||'GST']
          );
        }
        console.log(`[recurring] Created invoice ${number} for user ${rec.userId} (recurring: ${rec.label})`);

      } else if (rec.type === 'expense') {
        await dbClient.query(
          `INSERT INTO fin_expenses ("userId", date, description, supplier, amount, gst, category, "txCodeId")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rec.userId, today, t.description||'', t.supplier||null,
           parseFloat(t.amount)||0, parseFloat(t.gst)||0, t.category||null, t.txCodeId||null]
        );
        console.log(`[recurring] Created expense "${t.description}" for user ${rec.userId} (recurring: ${rec.label})`);
      }

      // Advance nextDate to next occurrence
      const nextDate = nextOccurrence(today, rec.frequency);
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
    runRecurring().catch(err => console.error('[recurring] Cron error:', err.message));
  });
  console.log('[recurring] Cron scheduled — daily at 00:05');
}

module.exports = { startRecurringCron, runRecurring };
