'use strict';

// Two-step login, Milestone 2: "Remember this device". A random token in an httpOnly cookie, stored only as a SHA-256 hash and
// tied to one user; a remembered device skips the emailed code. 30 days, 7 for an admin. See docs/two-step-login.md.
// Never log a device token.

const crypto = require('crypto');
const { pool } = require('../db');

const COOKIE = 'vault_device';
const COOKIE_PATH = '/api/auth'; // the browser sends it to the sign-in routes only

function deviceDays(user) {
  return user.isAdmin ? 7 : 30;
}

// The token is 32 random bytes, so a plain hash is enough and the database lookup by hash leaks nothing useful.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** "Chrome on Windows", from the user agent; a label for Settings, never trusted for anything. */
function deviceLabel(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'A browser';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** Hash of this browser's device cookie (sent only to /api/auth/*), to mark "This browser" in Settings. */
function currentTokenHash(req) {
  const token = readCookie(req);
  return token ? hashToken(token) : null;
}

/** Is this browser a remembered device for this user? Stamps last use when it is. */
async function isTrusted(req, userId) {
  const token = readCookie(req);
  if (!token) return false;
  const { rowCount } = await pool.query(
    `UPDATE auth_trusted_devices SET "lastUsedAt"=NOW(), "lastIp"=$3
     WHERE "tokenHash"=$1 AND "userId"=$2 AND "expiresAt" > NOW()`,
    [hashToken(token), userId, req.ip || null]
  );
  return rowCount > 0;
}

/** Remember this browser for the user. `db` may be a transaction's client. Returns the cookie header to send. */
async function trustDevice(db, req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const days = deviceDays(user);
  await db.query(
    `INSERT INTO auth_trusted_devices ("userId", "tokenHash", label, "lastIp", "lastUsedAt", "expiresAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW() + make_interval(days => $5))`,
    [user.id, hashToken(token), deviceLabel(req.headers['user-agent']), req.ip || null, days]
  );
  return `${COOKIE}=${token}; Max-Age=${days * 86400}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`;
}

/** Forget every remembered device for a user (password change or reset, admin action). */
async function forgetAllDevices(db, userId) {
  await db.query('DELETE FROM auth_trusted_devices WHERE "userId"=$1', [userId]);
}

/** Cron tidy-up: login challenges older than a day and expired devices. Security records, so no recycle bin. */
async function purgeOldAuthRecords() {
  const a = await pool.query(`DELETE FROM auth_login_challenges WHERE "createdAt" < NOW() - INTERVAL '1 day'`);
  const b = await pool.query(`DELETE FROM auth_trusted_devices WHERE "expiresAt" < NOW()`);
  return { challenges: a.rowCount, devices: b.rowCount };
}

module.exports = { isTrusted, trustDevice, currentTokenHash, forgetAllDevices, purgeOldAuthRecords, deviceDays, deviceLabel, COOKIE };
