'use strict';

/**
 * Time zone for a Fitness user. Comes from Vault Settings, never hardcoded:
 *   1. the member's own `user_timezone` setting (Settings -> profile, or the Fitness profile screen, same row)
 *   2. otherwise the workspace default = the first admin's `user_timezone` (same rule as /api/settings/workspace-timezone)
 *   3. otherwise Australia/Brisbane (config DEFAULT_TIMEZONE)
 */

const { pool } = require('../../db');
const { DEFAULT_TIMEZONE } = require('./config');

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** @returns {Promise<{ timezone: string, source: 'user'|'workspace'|'default' }>} */
async function resolveUserTimezone(userId) {
  try {
    const { rows: own } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='user_timezone'`, [userId],
    );
    const mine = own[0]?.value?.trim();
    if (mine && isValidTimezone(mine)) return { timezone: mine, source: 'user' };

    const { rows: ws } = await pool.query(
      `SELECT s.value FROM settings s JOIN users u ON u.id = s."userId"
        WHERE s.key='user_timezone' AND u."isAdmin"=TRUE ORDER BY u.id ASC LIMIT 1`,
    );
    const shared = ws[0]?.value?.trim();
    if (shared && isValidTimezone(shared)) return { timezone: shared, source: 'workspace' };
  } catch (err) {
    console.warn('[fitness/timezone] lookup failed, using default:', err.message);
  }
  return { timezone: DEFAULT_TIMEZONE, source: 'default' };
}

module.exports = { resolveUserTimezone, isValidTimezone };
