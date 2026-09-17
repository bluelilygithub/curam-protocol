'use strict';

/**
 * One-time backfill: scan every Gmail-connected user's inbox for the last 6 months,
 * run Inbox Intel's existing is_expense classifier (server/routes/gmail.js), and queue
 * any invoice/bill emails into expense_review_queue for human review. Never creates a
 * Finance expense directly — extraction only inserts as reviewStatus='pending'.
 *
 * Shares its pipeline with server/cron/expenseReviewCron.js via
 * server/services/expenseReviewService.js's runPoll() — this script is a dry-run-aware
 * driver over the same logic, not a separate implementation.
 *
 * Paginates per-user in maxResults batches of 100 (Gmail API quota) rather than one
 * bulk sweep — fetchInboxEmails caps a single call, so this loops with a shrinking
 * "since" window is unnecessary here since fetchInboxEmails takes maxResults directly;
 * batching is applied by capping GMAIL_BATCH_SIZE per fetch call below.
 *
 * Safe to re-run — dedupes on expense_review_queue's unique (userId, gmailMessageId).
 *
 * Usage:
 *   node server/scripts/backfillInvoiceReview.js
 *   node server/scripts/backfillInvoiceReview.js --dry-run
 */

require('dotenv').config();

const { pool } = require('../db');
const { runPoll } = require('../services/expenseReviewService');
const { getGmailConnectedUserIds } = require('../cron/expenseReviewCron');

const DRY_RUN = process.argv.includes('--dry-run');
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;
const GMAIL_BATCH_SIZE = 100; // Gmail API quota — matches Inbox Intel's own 100-200 cap

async function run() {
  await pool.query('SELECT 1'); // wait for schema init

  const userIds = await getGmailConnectedUserIds();
  if (!userIds.length) {
    console.log('[backfill-invoice-review] No Gmail-connected users found. Nothing to do.');
    return;
  }
  console.log(`[backfill-invoice-review] ${userIds.length} Gmail-connected user(s) to scan (last 6 months, batches of ${GMAIL_BATCH_SIZE}).`);

  const sinceMs = Date.now() - SIX_MONTHS_MS;
  let totalMatched = 0;
  let totalInserted = 0;
  let totalDuplicate = 0;
  let totalOther = 0;
  const wouldInsert = [];

  for (const userId of userIds) {
    console.log(`[backfill-invoice-review] user=${userId} scanning...`);
    let summary;
    try {
      summary = await runPoll(userId, { maxResults: GMAIL_BATCH_SIZE, sinceMs, dryRun: DRY_RUN });
    } catch (err) {
      console.error(`[backfill-invoice-review] user=${userId} FAILED:`, err.message);
      continue;
    }

    totalMatched += summary.matched;
    totalInserted += summary.inserted;
    totalDuplicate += summary.skippedDuplicate;
    totalOther += summary.skippedOther;

    console.log(`[backfill-invoice-review] user=${userId} matched=${summary.matched} ${DRY_RUN ? 'would-insert' : 'inserted'}=${summary.inserted} duplicate=${summary.skippedDuplicate} other-skip=${summary.skippedOther}`);

    if (DRY_RUN) {
      for (const r of summary.insertedRows) wouldInsert.push({ userId, ...r });
    }
  }

  console.log('\n[backfill-invoice-review] Summary:');
  console.log(`  Matched (invoice/bill flagged):  ${totalMatched}`);
  console.log(`  ${DRY_RUN ? 'Would insert' : 'Inserted'}:                       ${totalInserted}`);
  console.log(`  Skipped as duplicate:             ${totalDuplicate}`);
  console.log(`  Skipped (no PDF / extract fail):  ${totalOther}`);

  if (DRY_RUN && wouldInsert.length) {
    console.log('\n[backfill-invoice-review] Would-insert detail (subject/sender only — dry-run does not extract vendor/amount):');
    for (const r of wouldInsert) {
      console.log(`  user=${r.userId} msg=${r.id} from="${r.sender}" subject="${r.subject}"`);
    }
  }

  if (DRY_RUN) console.log('\n[backfill-invoice-review] --dry-run: no rows were written.');
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[backfill-invoice-review] Failed:', err);
    process.exit(1);
  });
