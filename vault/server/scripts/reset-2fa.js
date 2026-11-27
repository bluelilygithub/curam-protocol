#!/usr/bin/env node
/**
 * Reset one person's two-step login when no admin can sign in to do it from Dashboard (docs/two-step-login.md).
 * Removes their authenticator, backup codes, remembered devices and every session. Leaves the account, password and
 * admin flag alone, so an admin is asked to set up an authenticator again at the next sign-in. Works for user 1.
 *
 * On Railway (shell in the Vault service, via `railway ssh`):  cd /app && node server/scripts/reset-2fa.js you@example.com
 * Locally:  DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/scripts/reset-2fa.js you@example.com
 */
'use strict';
const { Pool } = require('pg');
const { runtimeConfig } = require('../config/runtime');
const { resetTwoStep } = require('../services/twoStepReset');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: node server/scripts/reset-2fa.js <email>');
    process.exit(2);
  }
  const url = runtimeConfig.databaseUrl;
  if (!url) { console.error('DATABASE_URL is not set.'); process.exit(2); }
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const pool = new Pool({ connectionString: url, ssl: host === 'localhost' || host === '127.0.0.1' ? false : { rejectUnauthorized: false } });
  try {
    const { rows } = await pool.query('SELECT id, email, "isAdmin" FROM users WHERE email=$1', [email]);
    if (!rows[0]) { console.error(`No account with the email ${email}.`); process.exitCode = 1; return; }
    const u = rows[0];
    const c = await resetTwoStep(pool, u.id);
    console.log(`Two-step login reset for ${u.email} (user ${u.id}${u.isAdmin ? ', admin' : ''}).`);
    console.log(`Removed: ${c.authenticator} authenticator, ${c.backupCodes} backup codes, ${c.devices} remembered devices, ${c.sessions} sessions.`);
    console.log(u.isAdmin
      ? 'Next sign-in: password, then set up an authenticator app again.'
      : 'Next sign-in: password, then an emailed code.');
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
