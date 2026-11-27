'use strict';

// Reset someone's two-step login: authenticator, backup codes, remembered devices and every session go, in one transaction.
// Their admin flag is untouched, so an admin (user 1 included, forced admin on boot) enrols again at the next sign-in.
// Used by POST /api/admin/users/:id/reset-2fa and server/scripts/reset-2fa.js. Takes the pool as an argument and requires
// nothing from ../db, so the script can run it without starting the app's schema set-up. See docs/two-step-login.md.

async function resetTwoStep(pool, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const counts = {};
    for (const [name, sql] of [
      ['authenticator', 'DELETE FROM auth_totp WHERE "userId"=$1'],
      ['backupCodes', 'DELETE FROM auth_backup_codes WHERE "userId"=$1'],
      ['devices', 'DELETE FROM auth_trusted_devices WHERE "userId"=$1'],
      ['sessions', 'DELETE FROM auth_sessions WHERE "userId"=$1'],
      ['challenges', 'DELETE FROM auth_login_challenges WHERE "userId"=$1'],
    ]) counts[name] = (await client.query(sql, [userId])).rowCount;
    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { resetTwoStep };
