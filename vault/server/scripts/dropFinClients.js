'use strict';

/**
 * Phase 3 of the clients/fin_clients merge (see docs/crm-migration.md).
 * Irreversible — only run after Phase 2 has been verified in production
 * (old invoices/quotes show their client, new create/edit/PDF/send work,
 * a quote->invoice convert works).
 *
 * Drops:
 *   - fin_invoices."clientId" column + its FK to fin_clients (superseded by
 *     "clientRef" -> clients, repointed in Phase 2)
 *   - the fin_clients table itself
 *
 * Finds the actual FK constraint name via information_schema rather than
 * guessing Postgres's auto-generated name.
 *
 * Usage:
 *   node server/scripts/dropFinClients.js --dry-run
 *   node server/scripts/dropFinClients.js
 */

require('dotenv').config();

const { pool } = require('../db');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await pool.query('SELECT 1');

  const { rows: fkRows } = await pool.query(`
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'fin_invoices'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'clientId'
  `);
  const fkName = fkRows[0]?.constraint_name || null;

  const { rows: [invCount] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM fin_invoices WHERE "clientId" IS NOT NULL`
  );
  const { rows: [clientCount] } = await pool.query(`SELECT COUNT(*)::int AS n FROM fin_clients`);
  const { rows: [unlinkedCount] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM fin_clients WHERE "clientId" IS NULL`
  );

  console.log(`[phase3] fin_invoices rows still carrying a (now-unused) clientId: ${invCount.n}`);
  console.log(`[phase3] fin_clients rows: ${clientCount.n} (${unlinkedCount.n} never linked to a clients row)`);
  console.log(`[phase3] fin_invoices."clientId" FK constraint: ${fkName || '(not found — may already be dropped)'}`);

  if (unlinkedCount.n > 0) {
    console.log(`\n[phase3] WARNING: ${unlinkedCount.n} fin_clients row(s) have no clientId bridge set.`);
    console.log('[phase3] Dropping fin_clients now would lose whatever data only exists there.');
    console.log('[phase3] Refusing to proceed. Run migrateFinClientsToClients.js / createClientsForUnmatched.js first.');
    if (!DRY_RUN) return;
  }

  if (DRY_RUN) {
    console.log('\n[phase3] --dry-run: no changes made.');
    return;
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    if (fkName) {
      await dbClient.query(`ALTER TABLE fin_invoices DROP CONSTRAINT "${fkName}"`);
      console.log(`[phase3] Dropped constraint ${fkName}`);
    }
    await dbClient.query(`ALTER TABLE fin_invoices DROP COLUMN IF EXISTS "clientId"`);
    console.log('[phase3] Dropped fin_invoices."clientId"');
    await dbClient.query(`DROP TABLE IF EXISTS fin_clients`);
    console.log('[phase3] Dropped fin_clients');
    await dbClient.query('COMMIT');
    console.log('\n[phase3] Done.');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.error('[phase3] Failed, rolled back:', err.message);
    throw err;
  } finally {
    dbClient.release();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[phase3] Failed:', err);
    process.exit(1);
  });
