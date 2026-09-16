'use strict';

/**
 * One-off: list accepted quotes (docType='quote', status='accepted'), or
 * delete one by id. The Finance UI intentionally hides Delete for accepted
 * quotes (kept as an audit record of "quote -> became invoice X"), but the
 * server has no such restriction — this bypasses the UI on purpose for a
 * specific, user-confirmed id. Also removes any journal entries linked to
 * it (mirrors the server's own DELETE /invoices/:id route), though an
 * accepted quote normally has none (journals only post on invoice
 * send/paid, not on quote acceptance).
 *
 * Usage:
 *   node server/scripts/deleteAcceptedQuote.js                # list only
 *   node server/scripts/deleteAcceptedQuote.js --id=13         # delete id 13
 */

require('dotenv').config();

const { pool } = require('../db');

const idArg = process.argv.find(a => a.startsWith('--id='));
const targetId = idArg ? parseInt(idArg.split('=')[1], 10) : null;

async function run() {
  await pool.query('SELECT 1');

  if (!targetId) {
    const { rows } = await pool.query(`
      SELECT id, number, "userId", "clientRef", total, "createdAt"
      FROM fin_invoices
      WHERE "docType"='quote' AND status='accepted'
      ORDER BY id
    `);
    if (!rows.length) {
      console.log('[delete-quote] No accepted quotes found.');
      return;
    }
    console.log('[delete-quote] Accepted quotes:');
    for (const r of rows) {
      console.log(`  id=${r.id}  ${r.number}  userId=${r.userId}  clientRef=${r.clientRef}  total=${r.total}  created=${r.createdAt}`);
    }
    console.log('\n[delete-quote] Re-run with --id=<id> to delete one.');
    return;
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows: check } = await dbClient.query(
      `SELECT id, number, status, "docType" FROM fin_invoices WHERE id=$1`, [targetId]
    );
    if (!check[0]) {
      console.log(`[delete-quote] No row with id=${targetId}.`);
      await dbClient.query('ROLLBACK');
      return;
    }
    if (check[0].docType !== 'quote') {
      console.log(`[delete-quote] id=${targetId} is a "${check[0].docType}", not a quote. Refusing to delete — pass the correct id.`);
      await dbClient.query('ROLLBACK');
      return;
    }
    console.log(`[delete-quote] Deleting quote ${check[0].number} (id=${targetId}, status=${check[0].status})`);

    await dbClient.query(`DELETE FROM fin_journal_lines WHERE "entryId" IN (SELECT id FROM fin_journal_entries WHERE "sourceId"=$1 AND type IN ('invoice','payment'))`, [targetId]);
    await dbClient.query(`DELETE FROM fin_journal_entries WHERE "sourceId"=$1 AND type IN ('invoice','payment')`, [targetId]);
    await dbClient.query(`DELETE FROM fin_invoice_items WHERE "invoiceId"=$1`, [targetId]);
    await dbClient.query(`DELETE FROM fin_invoices WHERE id=$1`, [targetId]);

    await dbClient.query('COMMIT');
    console.log('[delete-quote] Deleted.');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('[delete-quote] Failed:', err.message);
  } finally {
    dbClient.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[delete-quote] Failed:', err);
    process.exit(1);
  });
