'use strict';

/**
 * One-time backfill: scan every Gmail-connected user's inbox since a given date, run Inbox
 * Intel's existing is_expense classifier (server/routes/gmail.js), and queue any invoice/bill
 * emails into expense_review_queue for human review. Never creates a Finance expense
 * directly — extraction only inserts as reviewStatus='pending'.
 *
 * Shares its pipeline with server/cron/expenseReviewCron.js via
 * server/services/expenseReviewService.js's runPoll() — this script is a dry-run-aware
 * driver over the same logic, not a separate implementation.
 *
 * Uses real Gmail pageToken pagination (fetchAllInboxEmailsSince in server/routes/gmail.js)
 * with a server-side `after:YYYY/MM/DD` query — a genuine sweep back to --since, not a
 * single fetch-then-filter page (an earlier version of this script only looked at the most
 * recent ~100 threads regardless of date; fixed after that silently under-counted a real run).
 *
 * Safe to re-run — dedupes on expense_review_queue's unique (userId, gmailMessageId).
 *
 * Usage:
 *   node server/scripts/backfillInvoiceReview.js
 *   node server/scripts/backfillInvoiceReview.js --dry-run
 *   node server/scripts/backfillInvoiceReview.js --since=2026-07-01
 */

require('dotenv').config();

const { pool } = require('../db');
const { runPoll } = require('../services/expenseReviewService');
const { getGmailConnectedUserIds } = require('../cron/expenseReviewCron');

const DRY_RUN = process.argv.includes('--dry-run');
const sinceArg = process.argv.find(a => a.startsWith('--since='));
const SINCE_DATE = sinceArg ? sinceArg.split('=')[1] : '2026-07-01';

async function run() {
  await pool.query('SELECT 1'); // wait for schema init

  const userIds = await getGmailConnectedUserIds();
  if (!userIds.length) {
    console.log('[backfill-invoice-review] No Gmail-connected users found. Nothing to do.');
    return;
  }
  console.log(`[backfill-invoice-review] ${userIds.length} Gmail-connected user(s) to scan since ${SINCE_DATE} (real pagination).`);

  let totalMatched = 0;
  let totalInserted = 0;
  let totalDuplicate = 0;
  let totalOther = 0;
  const wouldInsert = [];

  for (const userId of userIds) {
    console.log(`[backfill-invoice-review] user=${userId} scanning...`);
    let summary;
    try {
      summary = await runPoll(userId, { afterDate: SINCE_DATE, dryRun: DRY_RUN });
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
  console.log(`  Since:                             ${SINCE_DATE}`);
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
