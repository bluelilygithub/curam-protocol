#!/usr/bin/env node
/**
 * One-off repair for books affected by the 2026-10 Finance fixes. Dry run by default.
 *
 *   node server/scripts/backfillFinanceJournals.js            # report only
 *   node server/scripts/backfillFinanceJournals.js --apply    # make the changes
 *
 * 1. Expenses with no journal at all (recurring expenses created by the cron before it posted one):
 *    posts DR Expenses / DR GST Paid / CR Bank (or the card account), same as a manual expense.
 * 2. Draft or void invoices that still carry an AR/income journal (old quote conversion, voiding):
 *    removes it, since neither is an accounting transaction.
 * 3. Sent or paid invoices with no invoice journal (e.g. a draft that was marked paid, leaving AR
 *    negative): posts DR AR / CR Income / CR GST Collected.
 *
 * Each repair runs in its own transaction. Nothing outside these three cases is touched.
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const { pool } = require('../db');
const fin = require('../routes/finance');

const apply = process.argv.includes('--apply');
const ds = (v) => {
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};

async function inTxn(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await fn(c);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // let db.js finish its own schema init
  console.log(apply ? 'APPLYING changes' : 'DRY RUN (add --apply to make changes)');

  const { rows: exps } = await pool.query(
    `SELECT x.* FROM fin_expenses x
     WHERE NOT EXISTS (SELECT 1 FROM fin_journal_entries e
                       WHERE e."userId"=x."userId" AND e."sourceId"=x.id AND e.type IN ('expense','depreciation'))
     ORDER BY x."userId", x.date, x.id`
  );
  console.log(`\n1. Expenses with no journal: ${exps.length}`);
  for (const x of exps) {
    console.log(`   user ${x.userId}  #${x.id}  ${ds(x.date)}  ${x.description}  ${x.amount} + GST ${x.gst}`);
    if (!apply) continue;
    await inTxn(async (c) => {
      await fin.ensureAccounts(x.userId);
      const expId = await fin.accountByCode(x.userId, '5000');
      const gstId = await fin.accountByCode(x.userId, '1200');
      const creditId = x.paidViaId || (await fin.accountByCode(x.userId, '1000'));
      const amt = parseFloat(x.amount), gst = parseFloat(x.gst) || 0;
      const lines = [{ accountId: expId, debit: amt, credit: 0 }];
      if (gst > 0 && gstId) lines.push({ accountId: gstId, debit: gst, credit: 0 });
      lines.push({ accountId: creditId, debit: 0, credit: Math.round((amt + (gst > 0 && gstId ? gst : 0)) * 100) / 100 });
      await fin.createJournalEntry(c, x.userId, {
        date: ds(x.date), description: `Expense: ${x.description}`, type: 'expense', sourceId: x.id, lines,
      });
    });
  }

  const { rows: stale } = await pool.query(
    `SELECT i.id, i."userId", i.number, i.status FROM fin_invoices i
     WHERE i."docType"='invoice' AND i.status IN ('draft','void')
       AND EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e."userId"=i."userId" AND e."sourceId"=i.id AND e.type='invoice')
     ORDER BY i."userId", i.id`
  );
  console.log(`\n2. Draft/void invoices still carrying an invoice journal: ${stale.length}`);
  for (const i of stale) {
    console.log(`   user ${i.userId}  ${i.number} (${i.status})`);
    if (apply) await inTxn((c) => fin.deleteJournalForSource(c, i.userId, i.id, 'invoice'));
  }

  const { rows: missing } = await pool.query(
    `SELECT i.* FROM fin_invoices i
     WHERE i."docType"='invoice' AND i.status IN ('sent','paid')
       AND NOT EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e."userId"=i."userId" AND e."sourceId"=i.id AND e.type='invoice')
     ORDER BY i."userId", i.id`
  );
  console.log(`\n3. Sent/paid invoices with no invoice journal: ${missing.length}`);
  for (const i of missing) {
    console.log(`   user ${i.userId}  ${i.number} (${i.status})  total ${i.total}`);
    if (apply) await inTxn((c) => fin.postInvoiceJournal(c, i.userId, i));
  }

  console.log(apply ? '\nDone.' : '\nNothing changed. Re-run with --apply to repair.');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
