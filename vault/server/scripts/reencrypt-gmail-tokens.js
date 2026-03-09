/**
 * One-time script to re-encrypt existing plaintext gmail_tokens rows.
 *
 * Run once after setting ENCRYPTION_KEY in your environment:
 *   node vault/server/scripts/reencrypt-gmail-tokens.js
 *
 * Safe to run multiple times — already-encrypted rows are a no-op.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const db = require('../db');
const { encrypt, decrypt, getKey } = require('../utils/encryption');

if (!getKey()) {
  console.error('ENCRYPTION_KEY is not set. Set it in your .env before running this script.');
  process.exit(1);
}

const rows = db.prepare('SELECT userId, accessToken, refreshToken FROM gmail_tokens').all();

if (rows.length === 0) {
  console.log('No gmail_tokens rows found — nothing to do.');
  process.exit(0);
}

let updated = 0;
for (const row of rows) {
  const plainAccess  = decrypt(row.accessToken);
  const plainRefresh = row.refreshToken ? decrypt(row.refreshToken) : null;

  const encAccess  = encrypt(plainAccess);
  const encRefresh = plainRefresh ? encrypt(plainRefresh) : null;

  // Skip if already encrypted (encrypt() produced the same format as what was stored)
  if (encAccess === row.accessToken && encRefresh === row.refreshToken) continue;

  db.prepare(`UPDATE gmail_tokens SET accessToken=?, refreshToken=?, updatedAt=datetime('now') WHERE userId=?`)
    .run(encAccess, encRefresh, row.userId);
  updated++;
}

console.log(`Done. Re-encrypted ${updated} of ${rows.length} rows.`);
