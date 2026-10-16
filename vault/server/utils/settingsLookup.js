'use strict';

/**
 * Reading a setting that several people could have written. Settings are stored per user, so a lookup
 * by key alone returns whichever person's row the database happens to find first: a member could put
 * their own value under a shared name (an API key, a provider) and have it used for everyone.
 *
 * getSettingForUser returns the caller's own value if they set one, otherwise an administrator's value
 * (the workspace default), and never a value written by some other member.
 */

const { pool } = require('../db');

async function getSettingForUser(userId, key) {
  const { rows } = await pool.query(
    `SELECT s.value
       FROM settings s LEFT JOIN users u ON u.id = s."userId"
      WHERE s.key = $1 AND s.value IS NOT NULL AND s.value <> ''
        AND (s."userId" = $2 OR COALESCE(u."isAdmin", FALSE))
      ORDER BY (s."userId" = $2) DESC, s."userId" ASC
      LIMIT 1`,
    [key, userId == null ? null : userId]
  );
  return rows[0] ? rows[0].value : null;
}

module.exports = { getSettingForUser };
