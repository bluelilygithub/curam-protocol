'use strict';

// Hourly incremental poll: finds invoice/bill emails via Inbox Intel's classifier and queues
// them into expense_review_queue for human review. First-ever run per user (no
// expense_review_last_polled_at setting yet) falls back to a 6-month lookback — same window
// as server/scripts/backfillInvoiceReview.js, and both call the same runPoll() in
// server/services/expenseReviewService.js so the logic never forks in two.

const cron = require('node-cron');
const { pool } = require('../db');
const { runPoll } = require('../services/expenseReviewService');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');

const LAST_POLLED_KEY = 'expense_review_last_polled_at';
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;

let cronTask = null;

async function getWorkspaceTimezone() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    return rows[0]?.value?.trim() || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

async function getGmailConnectedUserIds() {
  const { rows } = await pool.query(`SELECT DISTINCT "userId" AS id FROM gmail_tokens`);
  return rows.map(r => r.id);
}

async function getLastPolledAt(userId) {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE "userId"=$1 AND key=$2`, [userId, LAST_POLLED_KEY]
  );
  return rows[0]?.value ? new Date(rows[0].value) : null;
}

async function setLastPolledAt(userId, when) {
  await pool.query(
    `INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3)
     ON CONFLICT ("userId","key") DO UPDATE SET value = EXCLUDED.value`,
    [userId, LAST_POLLED_KEY, when.toISOString()]
  );
}

// Exported so the backfill script can call the exact same per-user polling logic in
// non-dry-run mode (it uses runPoll directly for dry-run reporting).
async function pollUser(userId) {
  const last = await getLastPolledAt(userId);
  // Gmail's `after:` query is date-granularity, not time-of-day — re-scanning part of
  // `last`'s own day on an hourly poll is harmless since expense_review_queue dedupes on
  // (userId, gmailMessageId).
  const afterDate = (last ? last : new Date(Date.now() - SIX_MONTHS_MS)).toISOString().slice(0, 10);
  const startedAt = new Date();

  const summary = await runPoll(userId, { afterDate });
  await setLastPolledAt(userId, startedAt);

  console.log(`[expense-review-cron] user=${userId} matched=${summary.matched} inserted=${summary.inserted} dup=${summary.skippedDuplicate} other=${summary.skippedOther} since=${last ? afterDate : '6-month-backfill:' + afterDate}`);

  await captureIf(summary.matched > 0 && summary.inserted === 0 && summary.skippedOther > 0, {
    userId,
    source: 'expenseReviewCron',
    category: 'alert',
    fingerprint: makeFingerprint('expenseReviewCron', `user:${userId}:extract-failures:${startedAt.toISOString().slice(0, 10)}`),
    title: 'Invoice review: matched emails failed extraction',
    body: `${summary.matched} invoice-flagged emails found, but ${summary.skippedOther} failed PDF extraction (no attachment or model error). Check /expense-review and server logs for details.`,
    context: 'server/cron/expenseReviewCron.js',
  });

  return summary;
}

async function runExpenseReviewPoll() {
  const userIds = await getGmailConnectedUserIds();
  for (const userId of userIds) {
    try {
      await pollUser(userId);
    } catch (err) {
      console.error(`[expense-review-cron] user=${userId} failed:`, err.message);
    }
  }
}

async function startExpenseReviewCron() {
  if (cronTask) cronTask.stop();
  const tz = await getWorkspaceTimezone();
  cronTask = cron.schedule('0 * * * *', runExpenseReviewPoll, { timezone: tz });
  console.log(`[expense-review-cron] scheduled hourly (tz=${tz})`);
}

module.exports = { startExpenseReviewCron, runExpenseReviewPoll, pollUser, getGmailConnectedUserIds, LAST_POLLED_KEY };
