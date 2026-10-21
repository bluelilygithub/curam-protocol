'use strict';

// Landing page ("where Vault opens"): an in-app path like /finance, or an https link. Set by an admin,
// per member or for everyone (workspace_settings key 'default_landing'). Empty = none.

const { pool } = require('../db');

const KEY = 'default_landing';

/** Returns the cleaned value, '' for "none", or null when invalid. */
function cleanLanding(input) {
  const v = String(input ?? '').trim();
  if (!v) return '';
  if (v.length > 500 || /[\u0000-\u001f\u007f\\]/.test(v)) return null;
  if (v.startsWith('/')) {
    if (v.startsWith('//') || v === '/' || v.startsWith('/login') || v.startsWith('/reset-password')) return null;
    return v;
  }
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function getWorkspaceLanding() {
  const { rows } = await pool.query('SELECT value FROM workspace_settings WHERE key=$1', [KEY]);
  return rows[0]?.value || '';
}

async function setWorkspaceLanding(value) {
  if (!value) return pool.query('DELETE FROM workspace_settings WHERE key=$1', [KEY]);
  return pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt") VALUES ($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, "updatedAt"=NOW()`, [KEY, value]);
}

/** What this user should be sent to on open: their own, else the workspace one. Accountants always open Finance. */
async function landingFor(user) {
  if (user.accountantOfUserId) return '';
  if (user.landingPath) return user.landingPath;
  return getWorkspaceLanding();
}

module.exports = { cleanLanding, getWorkspaceLanding, setWorkspaceLanding, landingFor };
