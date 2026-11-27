'use strict';

// Two-step login, Milestone 3: admins use an authenticator app (TOTP), with 10 single-use backup codes as their only fallback.
// Admins are never sent email codes. An admin with no authenticator sets one up during sign-in, before any session exists.
// See docs/two-step-login.md. Never log a secret, a code or a challenge id.

const crypto = require('crypto');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const totp = require('./totp');
const { encrypt, decrypt } = require('../utils/aesGcm');

const TOTP_TTL_MIN = 10;
const ENROL_TTL_MIN = 15; // time to find the phone and install an app
const BACKUP_COUNT = 10;
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

const authKey = () => require('./loginChallenge')._internal.authKey();

async function isEnrolled(userId) {
  const { rows } = await pool.query('SELECT 1 FROM auth_totp WHERE "userId"=$1 AND "enabledAt" IS NOT NULL', [userId]);
  return rows.length > 0;
}

/** After a right password: a 'totp' challenge, or 'totp_enrol' when the admin has no authenticator yet. */
async function startAdminChallenge(user, req) {
  if (!authKey()) {
    getLogger().error('admin sign-in refused: AUTH_ENCRYPTION_KEY is missing or the wrong shape');
    return { status: 503, body: { error: 'Sign-in is unavailable right now. Check AUTH_ENCRYPTION_KEY in Railway.' } };
  }
  const method = (await isEnrolled(user.id)) ? 'totp' : 'totp_enrol';
  const id = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO auth_login_challenges (id, "userId", method, "expiresAt", ip, "userAgent")
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4), $5, $6)`,
    [id, user.id, method, method === 'totp' ? TOTP_TTL_MIN : ENROL_TTL_MIN, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  return { status: 200, body: { challengeId: id, method } };
}

/**
 * Enrolment step 1: the secret to scan. Reuses a secret already waiting for this admin (a reload shows the same QR).
 * Returns null when the challenge is not a live enrolment.
 */
async function enrolStart(challengeId) {
  const { rows } = await pool.query(
    `SELECT c."userId", u.email FROM auth_login_challenges c JOIN users u ON u.id=c."userId"
     WHERE c.id=$1 AND c.method='totp_enrol' AND c."usedAt" IS NULL AND c."expiresAt" > NOW() AND c.attempts < 5`,
    [String(challengeId || '')]
  );
  const ch = rows[0];
  if (!ch || !authKey()) return null;
  const { rows: existing } = await pool.query('SELECT "secretEnc", "enabledAt" FROM auth_totp WHERE "userId"=$1', [ch.userId]);
  if (existing[0]?.enabledAt) return null; // already set up: a password alone never replaces an authenticator
  let secret;
  if (existing[0]) {
    try { secret = decrypt(authKey(), existing[0].secretEnc); } catch { secret = null; }
  }
  if (!secret) {
    secret = totp.newSecret();
    await pool.query(
      `INSERT INTO auth_totp ("userId", "secretEnc") VALUES ($1, $2)
       ON CONFLICT ("userId") DO UPDATE SET "secretEnc"=EXCLUDED."secretEnc", "lastStep"=NULL WHERE auth_totp."enabledAt" IS NULL`,
      [ch.userId, encrypt(authKey(), secret)]
    );
  }
  return { otpauthUri: totp.otpauthUri(secret, ch.email), manualKey: totp.manualKey(secret) };
}

/** Check an authenticator code inside the caller's transaction; on success records the step so it can't be used again. */
async function checkTotp(client, userId, typed, { enrolling = false } = {}) {
  const { rows } = await client.query('SELECT * FROM auth_totp WHERE "userId"=$1 FOR UPDATE', [userId]);
  const row = rows[0];
  if (!row || (enrolling ? row.enabledAt : !row.enabledAt)) return false;
  let secret;
  try { secret = decrypt(authKey(), row.secretEnc); } catch { return false; }
  const step = totp.verify(secret, typed, { lastStep: row.lastStep });
  if (step == null) return false;
  await client.query(
    `UPDATE auth_totp SET "lastStep"=$2${enrolling ? ', "enabledAt"=NOW()' : ''} WHERE "userId"=$1`, [userId, step]
  );
  return true;
}

const normaliseBackup = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashBackup = (userId, code) => crypto.createHmac('sha256', authKey()).update(`backup:${userId}:${normaliseBackup(code)}`).digest('hex');

/** Use one backup code inside the caller's transaction. A used code stays used. */
async function useBackupCode(client, userId, code) {
  if (normaliseBackup(code).length !== 10) return false;
  const { rows } = await client.query(
    `UPDATE auth_backup_codes SET "usedAt"=NOW()
     WHERE id = (SELECT id FROM auth_backup_codes WHERE "userId"=$1 AND "codeHash"=$2 AND "usedAt" IS NULL LIMIT 1 FOR UPDATE)
     RETURNING id`,
    [userId, hashBackup(userId, code)]
  );
  return rows.length > 0;
}

/** Replace all of a user's backup codes with 10 new ones. Returns them, the only time they exist in plain text. */
async function newBackupCodes(client, userId) {
  const codes = Array.from({ length: BACKUP_COUNT }, () => {
    const s = Array.from({ length: 10 }, () => BACKUP_ALPHABET[crypto.randomInt(BACKUP_ALPHABET.length)]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  await client.query('DELETE FROM auth_backup_codes WHERE "userId"=$1', [userId]);
  for (const c of codes) await client.query('INSERT INTO auth_backup_codes ("userId", "codeHash") VALUES ($1, $2)', [userId, hashBackup(userId, c)]);
  return codes;
}

async function backupCodesLeft(userId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM auth_backup_codes WHERE "userId"=$1 AND "usedAt" IS NULL', [userId]);
  return rows[0].n;
}

async function alertAdmins(fingerprintKey, title, body) {
  const { capture, makeFingerprint, getPrimaryAdminUserId } = require('./SuggestionService');
  const adminId = await getPrimaryAdminUserId();
  if (!adminId) return;
  await capture({ userId: adminId, source: 'twoStepLogin', category: 'alert', fingerprint: makeFingerprint('twoStepLogin', fingerprintKey), title, body });
}

/** An admin finished a second step on a browser Vault did not remember. */
function reportAdminNewDevice(req, user, how) {
  const label = require('./trustedDevices').deviceLabel(req.headers['user-agent']);
  const day = new Date().toISOString().slice(0, 10);
  getLogger().info({ userId: user.id, how }, 'admin sign-in from a new device');
  alertAdmins(`admin-new-device:${user.id}:${label}:${req.ip}:${day}`,
    `Admin sign-in from a new device: ${user.email}`,
    `${user.email} signed in as an admin on ${label} (address ${req.ip || 'unknown'}) using ${how}. If that was not them, reset their two-step login and password from Dashboard.`
  ).catch(() => {});
}

function reportBackupCodeUsed(req, user, left) {
  getLogger().info({ userId: user.id, left }, 'backup code used');
  alertAdmins(`backup-used:${user.id}:${Date.now()}`,
    `A backup code was used: ${user.email}`,
    `${user.email} signed in with a backup code (${left} left). If they have lost their phone, they should set up the authenticator again. If it was not them, reset their two-step login and password from Dashboard.`
  ).catch(() => {});
}

module.exports = {
  isEnrolled, startAdminChallenge, enrolStart, checkTotp, useBackupCode, newBackupCodes, backupCodesLeft,
  reportAdminNewDevice, reportBackupCodeUsed,
  _internal: { normaliseBackup, hashBackup },
};
