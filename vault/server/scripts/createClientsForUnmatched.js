'use strict';

/**
 * One-time migration follow-up: for every fin_clients row still unmatched
 * (fin_clients."clientId" IS NULL) after migrateFinClientsToClients.js, this
 * creates a brand-new `clients` row + a `client_contacts` row (from
 * contactName/email/phone if present) and links it back via the bridge
 * column. Safe to do as a straight create — these are unmatched precisely
 * because no candidate existed in `clients`, not because of an ambiguous
 * match, so there's nothing to conflict with.
 *
 * Also backfills client_billing_details (abn/address) for the new client,
 * same as migrateFinClientsToClients.js does for matched rows.
 *
 * Safe to re-run — only processes rows where "clientId" IS NULL.
 *
 * Usage:
 *   node server/scripts/createClientsForUnmatched.js --dry-run
 *   node server/scripts/createClientsForUnmatched.js
 */

require('dotenv').config();

const { pool } = require('../db');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await pool.query('SELECT 1'); // wait for schema init

  const { rows: unmatched } = await pool.query(`
    SELECT * FROM fin_clients WHERE "clientId" IS NULL
  `);

  if (!unmatched.length) {
    console.log('[create] No unmatched fin_clients rows. Nothing to do.');
    return;
  }
  console.log(`[create] ${unmatched.length} unmatched fin_clients row(s) to create as new clients.`);

  for (const fc of unmatched) {
    console.log(`\n[create] fin_clients#${fc.id} "${fc.name}" (userId=${fc.userId}) -> new clients row`);

    if (DRY_RUN) {
      console.log(`  would INSERT INTO clients (userId=${fc.userId}, name="${fc.name}")`);
      if (fc.contactName || fc.email || fc.phone) {
        console.log(`  would INSERT INTO client_contacts (name="${fc.contactName || fc.name}", email=${fc.email || 'NULL'}, phone=${fc.phone || 'NULL'})`);
      }
      if (fc.abn || fc.address) {
        console.log(`  would INSERT INTO client_billing_details (abn=${fc.abn || 'NULL'}, address=${fc.address || 'NULL'})`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [newClient] } = await client.query(
        `INSERT INTO clients ("userId", name, status)
         VALUES ($1, $2, $3) RETURNING id`,
        [fc.userId, fc.name, fc.isActive === false ? 'archived' : 'active']
      );
      const clientId = newClient.id;

      if (fc.contactName || fc.email || fc.phone) {
        await client.query(
          `INSERT INTO client_contacts ("clientId", name, email, phone, "isPrimary")
           VALUES ($1, $2, $3, $4, TRUE)`,
          [clientId, fc.contactName || fc.name, fc.email || null, fc.phone || null]
        );
      }

      if (fc.abn || fc.address) {
        await client.query(
          `INSERT INTO client_billing_details ("clientId", abn, address)
           VALUES ($1, $2, $3)
           ON CONFLICT ("clientId") DO UPDATE SET
             abn = COALESCE(client_billing_details.abn, EXCLUDED.abn),
             address = COALESCE(client_billing_details.address, EXCLUDED.address),
             "updatedAt" = NOW()`,
          [clientId, fc.abn || null, fc.address || null]
        );
      }

      await client.query(`UPDATE fin_clients SET "clientId" = $1 WHERE id = $2`, [clientId, fc.id]);

      await client.query('COMMIT');
      console.log(`  created clients#${clientId}, linked fin_clients#${fc.id} -> clients#${clientId}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  FAILED for fin_clients#${fc.id}:`, err.message);
    } finally {
      client.release();
    }
  }

  if (DRY_RUN) {
    console.log('\n[create] --dry-run: no rows were written.');
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[create] Failed:', err);
    process.exit(1);
  });
