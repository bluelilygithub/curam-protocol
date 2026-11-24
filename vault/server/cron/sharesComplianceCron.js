'use strict';

// Shares Compliance Advisory: 7 AM on the 2nd of each month in the workspace timezone. Runs inline under a
// Postgres advisory lock so two servers in a rolling deploy cannot create two reports. See docs/shares-compliance.md.

const cron = require('node-cron');
const { pool } = require('../db');
const { withCronLock } = require('../utils/cronLock');
const svc = require('../services/sharesCompliance/service');

const SCHEDULE = '0 7 2 * *';
let task = null;

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

async function getAdminIds() {
  const { rows } = await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC');
  return rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
}

/** The job itself. Kept separate from the schedule so it can be tested or called by hand. */
async function runMonthlyCompliance() {
  try {
    const adminIds = await getAdminIds();
    if (!adminIds.length) {
      console.warn('[shares-compliance-cron] no admin account found; skipping');
      return null;
    }
    const reports = await svc.startReports({ userIds: adminIds, trigger: 'scheduled', background: false });
    console.log(`[shares-compliance-cron] saved ${reports.length} report${reports.length === 1 ? '' : 's'}`);
    return reports;
  } catch (err) {
    console.error('[shares-compliance-cron]', err.message);
    return null;
  }
}

async function startSharesComplianceCron() {
  if (task) return task;
  const tz = await getWorkspaceTimezone();
  task = cron.schedule(
    SCHEDULE,
    () => withCronLock('shares-compliance', runMonthlyCompliance),
    { timezone: tz }
  );
  console.log(`[shares-compliance-cron] monthly check on the 2nd at 7:00 (${tz})`);
  return task;
}

module.exports = { startSharesComplianceCron, runMonthlyCompliance, getWorkspaceTimezone, getAdminIds, SCHEDULE };
