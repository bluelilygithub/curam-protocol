'use strict';

/**
 * One-time fix: existing fin_invoices rows created before the Phase 2
 * repoint have "clientId" set (-> fin_clients) but "clientRef" (-> clients)
 * NULL, so Finance's post-merge queries (which only read clientRef) show
 * them as unlinked. Backfills clientRef from clientId via the
 * fin_clients."clientId" bridge column set up in Phase 1.
 *
 * Also does the same for fin_recurring templates that still carry a
 * clientId-only value in their JSONB template.
 *
 * Safe to re-run — only touches rows where clientRef IS NULL and a mapping
 * is actually found.
 *
 * Usage:
 *   node server/scripts/backfillInvoiceClientRef.js --dry-run
 *   node server/scripts/backfillInvoiceClientRef.js
 */

require('dotenv').config();

const { pool } = require('../db');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await pool.query('SELECT 1'); // wait for schema init

  const { rows: invoices } = await pool.query(`
    SELECT i.id, i.number, i."clientId", fc."clientId" AS "mappedClientRef"
    FROM fin_invoices i
    JOIN fin_clients fc ON fc.id = i."clientId"
    WHERE i."clientRef" IS NULL AND i."clientId" IS NOT NULL
  `);

  console.log(`[backfill] ${invoices.length} fin_invoices row(s) with clientId set but clientRef NULL.`);

  const unmappable = invoices.filter(i => !i.mappedClientRef);
  const mappable = invoices.filter(i => i.mappedClientRef);

  for (const inv of mappable) {
    console.log(`  invoice #${inv.id} "${inv.number}" -> clientRef=${inv.mappedClientRef}`);
    if (!DRY_RUN) {
      await pool.query(`UPDATE fin_invoices SET "clientRef"=$1 WHERE id=$2`, [inv.mappedClientRef, inv.id]);
    }
  }

  if (unmappable.length) {
    console.log(`\n[backfill] ${unmappable.length} invoice(s) reference a fin_clients row with no clientId bridge set — needs manual reconciliation:`);
    for (const inv of unmappable) {
      console.log(`  invoice #${inv.id} "${inv.number}" fin_clients#${inv.clientId}`);
    }
  }

  // Recurring templates: same shape, but the mapping is stored inside a JSONB blob.
  const { rows: recs } = await pool.query(`
    SELECT id, template FROM fin_recurring
    WHERE template->>'clientId' IS NOT NULL AND template->>'clientRef' IS NULL
  `);
  console.log(`\n[backfill] ${recs.length} fin_recurring template(s) with clientId set but clientRef missing.`);
  for (const rec of recs) {
    const oldClientId = parseInt(rec.template.clientId, 10);
    const { rows: bridge } = await pool.query(`SELECT "clientId" FROM fin_clients WHERE id=$1`, [oldClientId]);
    const mapped = bridge[0]?.clientId;
    if (mapped) {
      console.log(`  fin_recurring#${rec.id} -> template.clientRef=${mapped}`);
      if (!DRY_RUN) {
        const newTemplate = { ...rec.template, clientRef: mapped };
        await pool.query(`UPDATE fin_recurring SET template=$1 WHERE id=$2`, [JSON.stringify(newTemplate), rec.id]);
      }
    } else {
      console.log(`  fin_recurring#${rec.id} -> no mapping found for fin_clients#${oldClientId}, skipped`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[backfill] --dry-run: no rows were written.');
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] Failed:', err);
    process.exit(1);
  });
