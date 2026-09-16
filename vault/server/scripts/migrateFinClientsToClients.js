'use strict';

/**
 * One-time migration (bridge phase): match each fin_clients row to a CRM
 * clients row and record it on the new fin_clients."clientId" bridge column.
 * Does NOT touch fin_invoices, does NOT drop fin_clients — this is the
 * matching/reconciliation pass only. See docs/crm-migration.md for the full
 * plan and the phases that follow this one.
 *
 * Match strategy, in order, per userId (never across users):
 *   1. Exact email match (case-insensitive) — fin_clients.email vs
 *      clients-derived email: either an existing client_contacts row's
 *      email, or (fallback) no client-level email field exists on `clients`
 *      today, so this is really "fin_clients.email == some client_contacts
 *      row's email for a client owned by the same user".
 *   2. Exact case-insensitive name match, only when exactly one candidate —
 *      an ambiguous name match (2+ clients with the same name) is left
 *      unmatched rather than guessed.
 * Everything else is left with clientId = NULL and printed at the end for
 * manual reconciliation — never auto-merged on a fuzzy match, since a wrong
 * merge here corrupts financial records.
 *
 * Safe to re-run — only updates rows where "clientId" IS NULL.
 *
 * Usage:
 *   node server/scripts/migrateFinClientsToClients.js
 *   node server/scripts/migrateFinClientsToClients.js --dry-run
 */

require('dotenv').config();

const { pool } = require('../db');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  await pool.query('SELECT 1'); // wait for schema init

  const { rows: finClients } = await pool.query(`
    SELECT * FROM fin_clients WHERE "clientId" IS NULL
  `);

  if (!finClients.length) {
    console.log('[migrate] No unmatched fin_clients rows. Nothing to do.');
    return;
  }
  console.log(`[migrate] ${finClients.length} unmatched fin_clients row(s) to attempt.`);

  let matchedByEmail = 0;
  let matchedByName = 0;
  const unmatched = [];

  for (const fc of finClients) {
    let matchId = null;
    let matchedVia = null;

    // 1. Email match via client_contacts, scoped to same user
    if (fc.email) {
      const { rows } = await pool.query(
        `SELECT DISTINCT c.id
         FROM clients c
         JOIN client_contacts cc ON cc."clientId" = c.id
         WHERE c."userId" = $1 AND LOWER(cc.email) = LOWER($2)`,
        [fc.userId, fc.email]
      );
      if (rows.length === 1) {
        matchId = rows[0].id;
        matchedVia = 'email';
      }
      // rows.length > 1 (same email under two clients) — leave unmatched,
      // ambiguous, needs a human.
    }

    // 2. Exact name match, only if unambiguous
    if (!matchId) {
      const { rows } = await pool.query(
        `SELECT id FROM clients WHERE "userId" = $1 AND LOWER(name) = LOWER($2)`,
        [fc.userId, fc.name]
      );
      if (rows.length === 1) {
        matchId = rows[0].id;
        matchedVia = 'name';
      }
    }

    if (matchId) {
      if (matchedVia === 'email') matchedByEmail++;
      else matchedByName++;
      console.log(`[migrate] fin_clients#${fc.id} "${fc.name}" -> clients#${matchId} (via ${matchedVia})`);
      if (!DRY_RUN) {
        await pool.query(`UPDATE fin_clients SET "clientId" = $1 WHERE id = $2`, [matchId, fc.id]);
        // Carry finance-only fields into the extension table so they're
        // available regardless of which table Finance ends up reading.
        await pool.query(
          `INSERT INTO client_billing_details ("clientId", abn, address)
           VALUES ($1, $2, $3)
           ON CONFLICT ("clientId") DO UPDATE SET
             abn = COALESCE(client_billing_details.abn, EXCLUDED.abn),
             address = COALESCE(client_billing_details.address, EXCLUDED.address),
             "updatedAt" = NOW()`,
          [matchId, fc.abn || null, fc.address || null]
        );
      }
    } else {
      unmatched.push(fc);
    }
  }

  console.log(`\n[migrate] Matched by email: ${matchedByEmail}`);
  console.log(`[migrate] Matched by name:  ${matchedByName}`);
  console.log(`[migrate] Unmatched:        ${unmatched.length}`);

  if (unmatched.length) {
    console.log('\n[migrate] Unmatched fin_clients rows — needs manual reconciliation:');
    for (const fc of unmatched) {
      console.log(`  fin_clients#${fc.id}  userId=${fc.userId}  name="${fc.name}"  email=${fc.email || '(none)'}`);
    }
    console.log('\n[migrate] Options for each: create a new clients row manually, or link an');
    console.log('[migrate] existing one by hand: UPDATE fin_clients SET "clientId"=<id> WHERE id=<fc.id>;');
  }

  if (DRY_RUN) {
    console.log('\n[migrate] --dry-run: no rows were written.');
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
