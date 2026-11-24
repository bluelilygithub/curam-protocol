'use strict';

// Shared scheduled trigger for the monthly admin compliance advisories. Uses the first admin's
// user_timezone setting, falls back to Australia/Sydney, and locks per app so the Shares and Finance jobs
// cannot block one another. See docs/shares-compliance.md and docs/finance-compliance.md.

const cron = require('node-cron');
const { withCronLock } = require('../../utils/cronLock');

const SCHEDULE = '0 7 2 * *';

async function getWorkspaceTimezone(pool = require('../../db').pool) {
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

async function getAdminIds(pool = require('../../db').pool) {
  const { rows } = await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC');
  return rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
}

function createCron({ config, service, pool = require('../../db').pool, schedule = SCHEDULE } = {}) {
  let task = null;
  const logPrefix = config.logPrefix || config.app;

  /** The job itself. Kept separate from the schedule so it can be tested or called by hand. */
  async function runMonthlyCompliance() {
    try {
      const adminIds = await getAdminIds(pool);
      if (!adminIds.length) {
        console.warn(`[${logPrefix}-cron] no admin account found; skipping`);
        return null;
      }
      const reports = await service.startReports({ userIds: adminIds, trigger: 'scheduled', background: false, deps: { pool } });
      console.log(`[${logPrefix}-cron] saved ${reports.length} report${reports.length === 1 ? '' : 's'}`);
      return reports;
    } catch (err) {
      console.error(`[${logPrefix}-cron]`, err.message);
      return null;
    }
  }

  async function startCron() {
    if (task) return task;
    const tz = await getWorkspaceTimezone(pool);
    task = cron.schedule(
      schedule,
      () => withCronLock(config.cronName, runMonthlyCompliance),
      { timezone: tz }
    );
    console.log(`[${logPrefix}-cron] monthly check on the 2nd at 7:00 (${tz})`);
    return task;
  }

  return { SCHEDULE, getWorkspaceTimezone, getAdminIds, runMonthlyCompliance, startCron };
}

module.exports = { createCron, SCHEDULE, getWorkspaceTimezone, getAdminIds };
