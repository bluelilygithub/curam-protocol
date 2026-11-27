'use strict';

// Two-step login, Milestone 1: after a right password, members and accountants get a 6-digit code by
// email and the session is made only once the code is right. Admins sign in as before until Milestone 3
// (TOTP). Rules and limits: docs/two-step-login.md. Never log a code, a challenge id or the key.

const crypto = require('crypto');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');

const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;               // wrong codes per challenge, then it is dead
const RESEND_GAP_SEC = 60;
const MAX_SENDS_PER_HOUR = 6;         // first send + 5 resends, per account, across challenges
const MAX_FAILS_PER_HOUR = 10;        // wrong codes per account, across challenges
const SEND_TIMEOUT_MS = 15000;        // MailChannels' request has no timeout of its own

const GENERIC_ERROR = "That code didn't work. Check it and try again.";
const SEND_FAILED = "We couldn't send your code. Try again, or ask an admin.";
// Resend and verify are open to anyone: a broken key answers exactly like an unknown id, so key health can't be probed from outside
// (admins check it with GET /api/admin/auth-health).
const dead = () => ({ status: 400, body: { error: 'This sign-in has expired. Start again.', code: 'challenge_dead' } });

let cachedKey;
/** AUTH_ENCRYPTION_KEY as 32 bytes: 64 hex characters, or base64 (44 characters). null when missing or the wrong shape. */
function authKey() {
  if (cachedKey !== undefined) return cachedKey;
  const raw = String(process.env.AUTH_ENCRYPTION_KEY || '').trim();
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else if (/^[A-Za-z0-9+/]{43}=?$/.test(raw)) buf = Buffer.from(raw, 'base64');
  cachedKey = buf && buf.length === 32 ? buf : null;
  return cachedKey;
}

/** What is wrong with the key, in plain words, or null when it works. Never includes the value. */
function authKeyProblem() {
  if (authKey()) return null;
  const raw = String(process.env.AUTH_ENCRYPTION_KEY || '').trim();
  if (!raw) return 'AUTH_ENCRYPTION_KEY is not set.';
  return `AUTH_ENCRYPTION_KEY is set but is not 32 bytes: it should be 64 hex characters or 44 base64 characters, and it is ${raw.length} characters long.`;
}

/** Boot check: log and raise an inbox item (never the key) when two-step login cannot work, so it is seen before a member's sign-in fails. */
function checkAuthKeyAtBoot() {
  const problem = authKeyProblem();
  if (!problem) return true;
  getLogger().error(`${problem} Members and accountants cannot finish signing in. See docs/env-vars.md.`);
  (async () => {
    const { capture, makeFingerprint, getPrimaryAdminUserId } = require('./SuggestionService');
    const adminId = await getPrimaryAdminUserId();
    if (!adminId) return;
    await capture({
      userId: adminId, source: 'twoStepLogin', category: 'alert',
      fingerprint: makeFingerprint('twoStepLogin', `auth-key-broken:${new Date().toISOString().slice(0, 10)}`),
      title: "Two-step login is broken: members can't sign in",
      body: `${problem} Members and accountants get "Sign-in is unavailable" after their password. Set it in Railway (Vault service, Variables) to the output of: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))". Railway redeploys on its own; once the key works, the warning on the admin Home page goes away.`,
    });
  })().catch((err) => getLogger().warn({ err: err.message }, 'auth key alert not raised'));
  return false;
}

// The challenge id is mixed in so a hash from one challenge never fits another.
function hashCode(challengeId, code) {
  return crypto.createHmac('sha256', authKey()).update(`${challengeId}:${code}`).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function makeCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function emailHint(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 1)}***@${domain || ''}`;
}

/** Does this login need an emailed code? Never for an admin: admins use an authenticator app (services/authenticator.js). */
function needsEmailCode(user) {
  return !user.isAdmin;
}

async function sendCodeEmail(to, code) {
  const sendEmail = require('../utils/sendEmail');
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f0;padding:20px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
<h2 style="margin-top:0;">Your sign-in code</h2>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0;">${code}</p>
<p>Type this code on the Project Vault sign-in page. It works for ${CODE_TTL_MIN} minutes.</p>
<p style="margin-top:24px;font-size:12px;color:#888;">If you didn't try to sign in, someone may know your password. Change it, or tell your administrator.</p>
</div></body></html>`;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('send timed out')), SEND_TIMEOUT_MS); });
  try {
    const result = await Promise.race([sendEmail({ to, subject: `${code} is your Project Vault sign-in code`, html }), timeout]);
    // DISABLE_EMAIL returns { ok: false, skipped: true } instead of throwing
    if (!result || result.ok === false) throw new Error(result?.reason || 'email not sent');
  } finally {
    clearTimeout(timer);
  }
}

async function sendsLastHour(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN "lastSentAt" IS NULL THEN 0 ELSE 1 + "resendCount" END), 0)::int AS n
     FROM auth_login_challenges WHERE "userId"=$1 AND method='email' AND "createdAt" > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  return rows[0].n;
}

async function failsLastHour(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(attempts), 0)::int AS n FROM auth_login_challenges
     WHERE "userId"=$1 AND "createdAt" > NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  return rows[0].n;
}

async function reportSendFailure(user, err) {
  getLogger().warn({ userId: user.id, err: err.message }, 'login code email failed');
  const { capture, makeFingerprint, getPrimaryAdminUserId } = require('./SuggestionService');
  const adminId = await getPrimaryAdminUserId();
  if (!adminId) return;
  await capture({
    userId: adminId, source: 'twoStepLogin', category: 'alert',
    fingerprint: makeFingerprint('twoStepLogin', `send-failed:${new Date().toISOString().slice(0, 10)}`),
    title: 'A sign-in code email could not be sent',
    body: `Vault could not email a sign-in code to ${user.email} (${err.message}). Members cannot finish signing in while email is failing. Check MAIL_CHANNEL_API_KEY or the SMTP settings.`,
  });
}

async function reportRepeatedFailures(user) {
  getLogger().warn({ userId: user.id }, 'repeated wrong login codes');
  const { capture, makeFingerprint, getPrimaryAdminUserId } = require('./SuggestionService');
  const adminId = await getPrimaryAdminUserId();
  if (!adminId) return;
  await capture({
    userId: adminId, source: 'twoStepLogin', category: 'alert',
    fingerprint: makeFingerprint('twoStepLogin', `failed-codes:${user.id}:${new Date().toISOString().slice(0, 10)}`),
    title: `Repeated wrong sign-in codes for ${user.email}`,
    body: `Someone typed the right password for ${user.email} and then several wrong sign-in codes. If that was not them, their password is known: reset it from Dashboard.`,
  });
}

/**
 * Start an email challenge for a user whose password was right.
 * Returns { status, body } for the login route to send.
 */
async function startEmailChallenge(user, req) {
  if (!authKey()) {
    getLogger().error('login code not sent: AUTH_ENCRYPTION_KEY is missing');
    return { status: 503, body: { error: 'Sign-in is unavailable right now. Ask an admin.' } };
  }
  if (await sendsLastHour(user.id) >= MAX_SENDS_PER_HOUR) {
    return { status: 429, body: { error: 'Too many codes sent. Wait a while and try again.' } };
  }
  const id = crypto.randomBytes(32).toString('hex');
  const code = makeCode();
  await pool.query(
    `INSERT INTO auth_login_challenges (id, "userId", method, "codeHash", "expiresAt", ip, "userAgent")
     VALUES ($1, $2, 'email', $3, NOW() + make_interval(mins => $4), $5, $6)`,
    [id, user.id, hashCode(id, code), CODE_TTL_MIN, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  const body = { challengeId: id, method: 'email', emailHint: emailHint(user.email) };
  try {
    await sendCodeEmail(user.email, code);
    await pool.query('UPDATE auth_login_challenges SET "lastSentAt"=NOW() WHERE id=$1', [id]);
  } catch (err) {
    await reportSendFailure(user, err).catch(() => {});
    return { status: 200, body: { ...body, sendFailed: true, error: SEND_FAILED } };
  }
  return { status: 200, body };
}

/** A fresh code for a live email challenge, at most once a minute and 6 sends an hour per account. */
async function resendCode(challengeId) {
  const { rows } = await pool.query(
    `SELECT c.*, u.email FROM auth_login_challenges c JOIN users u ON u.id=c."userId"
     WHERE c.id=$1 AND c.method='email' AND c."usedAt" IS NULL AND c."expiresAt" > NOW() AND c.attempts < $2`,
    [String(challengeId || ''), MAX_ATTEMPTS]
  );
  const ch = rows[0];
  if (!ch || !authKey()) return dead();
  if (ch.lastSentAt && Date.now() - new Date(ch.lastSentAt).getTime() < RESEND_GAP_SEC * 1000) {
    return { status: 429, body: { error: 'Wait a minute before asking for another code.' } };
  }
  if (await sendsLastHour(ch.userId) >= MAX_SENDS_PER_HOUR) {
    return { status: 429, body: { error: 'Too many codes sent. Wait a while and try again.' } };
  }
  const code = makeCode();
  try {
    await sendCodeEmail(ch.email, code);
  } catch (err) {
    await reportSendFailure({ id: ch.userId, email: ch.email }, err).catch(() => {});
    return { status: 502, body: { error: SEND_FAILED, code: 'code_send_failed' } };
  }
  // A failed first send left lastSentAt empty; that send was not a resend.
  await pool.query(
    `UPDATE auth_login_challenges SET "codeHash"=$2, "lastSentAt"=NOW(),
       "resendCount" = "resendCount" + CASE WHEN "lastSentAt" IS NULL THEN 0 ELSE 1 END
     WHERE id=$1`,
    [ch.id, hashCode(ch.id, code)]
  );
  return { status: 200, body: { ok: true } };
}

/**
 * Finish a challenge with whatever the person typed. check(client, ch, user) says whether it was right; on success the challenge is
 * marked used and onSuccess(client, user) makes the session inside the same transaction, so a challenge can never give two sessions.
 * Wrong answers count towards 5 per challenge and 10 an hour per account, whatever the method.
 */
async function finishChallenge(challengeId, methods, check, onSuccess) {
  const id = String(challengeId || '');
  const client = await pool.connect();
  let reportUser = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM auth_login_challenges WHERE id=$1 FOR UPDATE', [id]);
    const ch = rows[0];
    if (!ch || !methods.includes(ch.method) || ch.usedAt || new Date(ch.expiresAt) < new Date() || ch.attempts >= MAX_ATTEMPTS || !authKey()) {
      await client.query('ROLLBACK');
      return dead();
    }
    const { rows: users } = await client.query('SELECT * FROM users WHERE id=$1', [ch.userId]);
    const user = users[0];
    if (!user) { await client.query('ROLLBACK'); return dead(); }

    const tooMany = (await failsLastHour(user.id)) >= MAX_FAILS_PER_HOUR;
    if (tooMany || !(await check(client, ch, user))) {
      await client.query('ROLLBACK'); // undoes anything check() changed
      const { rows: up } = await pool.query(
        'UPDATE auth_login_challenges SET attempts=attempts+1 WHERE id=$1 RETURNING attempts', [id]
      );
      const over = up[0].attempts >= MAX_ATTEMPTS || tooMany;
      if (over) reportUser = user;
      return over
        ? { status: 400, body: { error: 'Too many wrong codes. Start again.', code: 'challenge_dead' } }
        : { status: 400, body: { error: GENERIC_ERROR, attemptsLeft: MAX_ATTEMPTS - up[0].attempts } };
    }

    await client.query('UPDATE auth_login_challenges SET "usedAt"=NOW() WHERE id=$1', [id]);
    const result = await onSuccess(client, user, ch);
    await client.query('COMMIT');
    return { status: 200, body: result, user, method: ch.method };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    if (reportUser) reportRepeatedFailures(reportUser).catch(() => {});
  }
}

/** The emailed code (members, accountants) or the authenticator code (admins). Admins never have an email challenge. */
function verifyCode(challengeId, code, onSuccess) {
  const typed = String(code || '').replace(/\D/g, '');
  return finishChallenge(challengeId, ['email', 'totp'], async (client, ch, user) => {
    if (ch.method === 'totp') return require('./authenticator').checkTotp(client, user.id, typed);
    return typed.length === 6 && !!ch.codeHash && sameHash(ch.codeHash, hashCode(ch.id, typed));
  }, onSuccess);
}

/** An admin's backup code, in place of the authenticator code. */
function verifyBackup(challengeId, backupCode, onSuccess) {
  return finishChallenge(challengeId, ['totp'],
    (client, ch, user) => require('./authenticator').useBackupCode(client, user.id, backupCode), onSuccess);
}

/** Enrolment step 2: the first code from the newly scanned authenticator switches it on. */
function confirmEnrol(challengeId, code, onSuccess) {
  return finishChallenge(challengeId, ['totp_enrol'],
    (client, ch, user) => require('./authenticator').checkTotp(client, user.id, code, { enrolling: true }), onSuccess);
}

module.exports = {
  needsEmailCode, startEmailChallenge, resendCode, verifyCode, verifyBackup, confirmEnrol, checkAuthKeyAtBoot, authKeyProblem,
  // for tests
  _internal: { authKey, hashCode, makeCode, emailHint, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, resetKeyCache: () => { cachedKey = undefined; } },
};
