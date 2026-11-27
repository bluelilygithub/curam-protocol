# Two-step login

After the right password, Vault asks for a second step before it makes a session. Members and accountant logins get a 6-digit code by email, only on a device Vault doesn't recognise. Admins use an authenticator app (TOTP), with backup codes as their fallback.

This is the brief, with the Milestone 0 findings and the agreed changes (2026-11-27) folded in. It is built in four milestones; the status of each is at the end.

## What was there before (Milestone 0, 2026-11-27)

- `POST /api/auth/login` (`server/routes/auth.js`) returns the session token in the JSON body; the browser keeps it in `localStorage` (`vault-auth`, `client/src/store/authStore.js`) and sends it as a `Bearer` header. Sessions last 24 hours (`SESSION_HOURS`).
- That route is the **only** place a session is made (`createSession()` in `auth.js` since Milestone 1). Gmail, Search Console and Calendar sign-ins, shelf tokens and the PC helper make no sessions.
- Password reset (`reset-password-confirm`) and an admin setting a password (`PUT /api/admin/users/:id/password`) end all of that user's sessions. Changing your own password (`POST /api/user/change-password`) ended none: Milestone 2 fixes this.
- `docs/hardening.md` said nothing about login limits, lockout or 2FA.
- QR codes are made in the browser by `client/src/pages/graphics/qrEncode.mjs` (`encodeQr`, `qrToSvg`).
- `users.id` is `SERIAL` (integer). There is no role column: admin = `users."isAdmin"`, accountant = `users."accountantOfUserId" IS NOT NULL`, member = neither.
- `trust proxy` is set to 1, so `req.ip` is the visitor's address. There is no cookie-parser: the device cookie is read from the raw `Cookie` header.
- **User 1 is forced to be an admin on every boot** (`server/db.js`, `UPDATE users SET "isAdmin" = TRUE WHERE id = 1`). So user 1 must enrol in TOTP in Milestone 3, and `reset-2fa.js` must work for user 1.

## Decisions

1. Keep the session-token auth (`auth_sessions`). This adds a second step; it replaces nothing.
2. Members and accountant logins: a 6-digit code by email, asked for only on a device Vault doesn't recognise.
3. Admins: an authenticator app (TOTP) is required. Admins never get email codes. Backup codes are their fallback.
4. After the right password the server makes a login challenge, not a session. The session is made only when the second step succeeds, in the same transaction that marks the challenge used.
5. Email code: 6 digits, valid 10 minutes, at most 5 wrong tries, then the challenge is dead. Resend at most once a minute; at most 6 code emails an hour per account (the first send plus 5 resends), across challenges. Stored as HMAC-SHA256 (key `AUTH_ENCRYPTION_KEY`, challenge id mixed in), never in plain text. A resend does not reset the wrong-try count.
6. Send codes, not links (email scanners open links).
7. "Remember this device" is ticked by default: **30 days for members and accountants, 7 days for admins.** The device token is random, in an httpOnly, Secure, SameSite=Lax cookie, stored hashed and tied to one user.
8. TOTP follows RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step), built with Node's `crypto`. No new package; `package.json` is untouched. A used time step can't be reused.
9. The TOTP secret is encrypted at rest with AES-256-GCM, key `AUTH_ENCRYPTION_KEY` (32 bytes, base64; `docs/env-vars.md`). It is needed **from Milestone 1** (email codes are HMACed with it). Boot logs a clear error, without the key, if it is missing or the wrong length.
10. 10 backup codes, random and long, **hashed with HMAC-SHA256 (same key), not bcrypt**: they are high-entropy, and checking against 10 bcrypt hashes would take seconds per try. Single-use, shown once, regenerated from Settings with a current TOTP code.
11. An admin with no TOTP is sent to enrol (QR code, manual key, confirm a code, backup codes) as part of their next login, before any session exists.
12. Changing or resetting a password ends the user's other sessions and forgets all their trusted devices. **Changing your own password keeps the session you are using**; a reset or an admin setting a password ends every session.
13. Recovery: an admin can reset another user's two-step login from Dashboard. A sole admin who is locked out runs `node server/scripts/reset-2fa.js <email>` from the Railway shell (not added to `package.json`). It must work for user 1.
14. Rate limits: `express-rate-limit` **by IP** on login, verify, resend and backup routes. **Per-account limits only on the code steps** (5 wrong per challenge, 10 wrong an hour per account), never on the password step, so nobody can lock someone out by knowing their email address.
15. Suggestions inbox (to the primary admin): repeated wrong codes on one account, a code email that could not be sent, an admin login from a new device, and use of a backup code.
16. These are security records, not user content, so they skip the recycle bin (`docs/recycle-bin.md`).
17. Never log codes, secrets, device tokens or challenge ids.
18. Login checks run in this order, before any challenge is made or email sent: wrong password → 401 as before; `mustChangePassword`; accountant access ended; account disabled. Then the second step.

## When a code can't be sent

`server/utils/sendEmail.js` (checked before Milestone 1):

- MailChannels: rejects (throws) on a non-2xx answer or a network error. **Its HTTPS request has no timeout**, so it could hang.
- SMTP (nodemailer): throws on failure, with nodemailer's own long timeouts.
- No mail set up: throws `Email delivery is not configured`.
- `DISABLE_EMAIL` set: does **not** throw; returns `{ ok: false, skipped: true }`.

So `loginChallenge.js` wraps each send in a 15-second timeout and treats a throw, a timeout or `ok: false` as a failure. The person sees "We couldn't send your code. Try again, or ask an admin." with a **Send code** button that works straight away (a failed send starts no one-minute wait and is not counted as a send), and the primary admin gets a Suggestions alert (one per day).

## When the key is broken

On 2026-11-27 the first deploy went live with an `AUTH_ENCRYPTION_KEY` the server could not use, and members could not sign in until it was replaced in Railway. Since then:

- **Two formats:** the key may be 64 hex characters or base64 (44 characters); both are 32 bytes (`authKey()` in `server/services/loginChallenge.js`). Anything else is refused.
- **At boot** (`checkAuthKeyAtBoot()`, called from `server/index.js`): a plain error in the log saying what is wrong (not set, or set but N characters long), never the value, and a Suggestions alert to the primary admin (one a day): "Two-step login is broken: members can't sign in", with the fix.
- **Admins see it** at the top of Needs attention (its own "Sign-in" box in the Home sidebar, first line on the mobile dashboard and project list) for as long as the key is broken: `server/routes/attention.js` adds `authKeyBroken` for admins only, `server/services/attention.js` words it. Members never see it.
- **`GET /api/admin/auth-health`** (admin only) answers `{ ok, problem }`; `problem` is the plain reason, never the key. **This is the check.**
- **It cannot be probed from outside.** The open routes `challenge/resend` and `challenge/verify` answer a broken key exactly as they answer an unknown id (400 "This sign-in has expired. Start again."), and the key is checked only after the database lookup, so the timing matches too (2026-11-27; until then resend answered 503 and gave it away). Only the password step says "Sign-in is unavailable right now. Ask an admin.", and only to someone who typed a right password.

## Data model (`server/db.js`, idempotent)

Each table is added in the milestone that uses it.

```sql
-- Milestone 1
CREATE TABLE IF NOT EXISTS auth_login_challenges (
  id TEXT PRIMARY KEY,                     -- random, 32 bytes hex
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,                    -- 'email' | 'totp' | 'totp_enrol'
  "codeHash" TEXT,                         -- email method only
  attempts INTEGER NOT NULL DEFAULT 0,
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMPTZ,                -- NULL until a send succeeds
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt" TIMESTAMPTZ,
  ip TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Milestone 2
CREATE TABLE IF NOT EXISTS auth_trusted_devices (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  label TEXT,                              -- e.g. "Chrome on Windows"
  "lastIp" TEXT,
  "lastUsedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ NOT NULL,        -- 30 days, or 7 for an admin
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Milestone 3
CREATE TABLE IF NOT EXISTS auth_totp (
  "userId" INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  "secretEnc" TEXT NOT NULL,               -- AES-256-GCM: iv.tag.ciphertext, base64
  "enabledAt" TIMESTAMPTZ,                 -- NULL until the first code is confirmed
  "lastStep" BIGINT                        -- last accepted time step (no reuse)
);
CREATE TABLE IF NOT EXISTS auth_backup_codes (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "codeHash" TEXT NOT NULL,                -- HMAC-SHA256
  "usedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Milestone 2 adds a cron (inside `withCronLock`) that deletes challenges older than a day and expired trusted devices.

## API

Before `requireAuth` (under `/api/auth`), IP rate-limited:

- `POST /api/auth/login`: wrong password, same as before. Right password:
  - member or accountant on a trusted device → session (Milestone 2)
  - member or accountant on a new device → email the code, return `{ challengeId, method: 'email', emailHint: 'j***@example.com' }`; if the email failed, also `sendFailed: true` and the message above
  - admin with TOTP → `{ challengeId, method: 'totp' }` (Milestone 3)
  - admin without TOTP → `{ challengeId, method: 'totp_enrol' }` (Milestone 3)
- `POST /api/auth/challenge/verify` `{ challengeId, code, rememberDevice }` → session (+ device cookie from Milestone 2). A dead challenge answers `400 { code: 'challenge_dead' }`; a wrong code `400 { error, attemptsLeft }`.
- `POST /api/auth/challenge/resend` `{ challengeId }`. A failed send answers `502 { code: 'code_send_failed' }`. An unknown, dead or unusable challenge (including a broken key) answers `400 { code: 'challenge_dead' }`.
- `POST /api/auth/challenge/backup` `{ challengeId, backupCode }` (admins, Milestone 3)
- `POST /api/auth/challenge/enrol/start` `{ challengeId }` → `{ otpauthUri, manualKey }`. **No image**: the browser draws the QR code with `qrEncode.mjs`.
- `POST /api/auth/challenge/enrol/confirm` `{ challengeId, code }` → `{ backupCodes }` + session

Errors are generic ("That code didn't work") and never reveal whether an account exists. Wrong codes answer 400, not 401, so nothing treats them as "signed out".

Behind `requireAuth` (Milestone 4): `GET /api/auth/security`, `DELETE /api/auth/devices/:id` (owner check), `POST /api/auth/devices/forget-all`, `POST /api/auth/backup-codes/regenerate` `{ code }`, `POST /api/auth/sessions/sign-out-others`. Behind `requireAdmin`: `POST /api/admin/users/:id/reset-2fa` (clears TOTP, backup codes and trusted devices, ends that user's sessions). No model calls, so no `aiLimiter`.

## UI

- Login page, step 2 (`client/src/pages/LoginPage.jsx`): one code box (`autocomplete="one-time-code"`, numeric keyboard; a pasted code with spaces is cleaned to its 6 digits), Resend with a one-minute countdown, Start again, and from Milestone 2 "Remember this device". Admins get "Use a backup code" (Milestone 3). It uses raw `fetch` like the password step: `apiClient`'s 401 handler reloads `/login` and would lose the challenge.
- **No VoiceInput on code fields, on purpose**: a code is read off another screen and typed or pasted, and speaking it aloud is a security risk.
- Admin enrolment (Milestone 3): QR code from `qrEncode.mjs`, the manual key with a copy button, confirm a code, then the backup codes once with Copy, Download and "I've saved these".
- Settings → Security (Milestone 4): authenticator status, backup codes left with Regenerate, trusted devices with Forget (inline Yes/No) and Forget all, Sign out other sessions, (i) box, Settings guide and tour updated.
- Dashboard (Milestone 4): "Reset 2-step login" on each user row, confirmed in the shared `Dialog`.

## Milestones

1. **Built (2026-11-27, not yet deployed).** `auth_login_challenges`, the email-code flow for members and accountants, verify and resend, IP and per-account limits, send-failure handling. Files: `server/services/loginChallenge.js`, `server/routes/auth.js`, `server/db.js`, `server/index.js` (boot key check), `client/src/pages/LoginPage.jsx`. **Until Milestone 3, admins sign in with their password alone, as before.** Until Milestone 2, members are asked for a code at every sign-in (there are no trusted devices yet). Tests: `DATABASE_URL=... node server/services/loginChallenge.db.test.js` (13), `DATABASE_URL=... node server/routes/auth.test.js` (7, now completes the code step).
2. **Built (2026-11-27, not yet deployed; goes out with Milestone 1).** `auth_trusted_devices`; `server/services/trustedDevices.js` (cookie `vault_device`, httpOnly, Secure, SameSite=Lax, `Path=/api/auth` so it is only sent to the sign-in routes; stored as a SHA-256 hash; 30 days, 7 for an admin; label such as "Chrome on Windows"). Login skips the code when the browser's cookie matches a live device **for that same user**. `POST /api/auth/challenge/verify` with `rememberDevice: true` sets the cookie; the login page's "Remember this device for N days" box is ticked by default (`rememberDays` comes from the login answer). New passwords: changing your own (`server/routes/user.js`) ends your other sessions and keeps this one; a reset (`auth.js`) or an admin setting one (`admin.js`) ends every session; all three forget every remembered device. Clean-up: `server/cron/authCleanupCron.js`, hourly in `withCronLock('auth-cleanup')`, deletes challenges over a day old and expired devices. The "admin login from a new device" alert arrives with Milestone 3, when admins first get a second step. Test: `DATABASE_URL=... node server/services/trustedDevices.db.test.js` (10). Seen in a browser locally: box ticked, cookie flags, a second sign-in on the same browser skips the code, a fresh browser is asked for one.
3. TOTP: crypto helper with encryption, forced admin enrolment, backup codes, `reset-2fa.js`. Tests: RFC 6238 Appendix B SHA-1 vectors (secret `12345678901234567890`; T=59 → 287082; T=1111111109 → 081804), ±1 window, reuse rejected, encrypt/decrypt round trip, tampered ciphertext fails, admins can't fall back to email codes.
4. Settings → Security, the Dashboard reset action, guide, tour, docs. Check everything in a browser locally, including a full admin enrolment and a member login from a new browser.

**Before pushing Milestone 3** (or anything else that depends on the key):

1. Confirm the key works **on the live server** with `GET /api/admin/auth-health` while signed in as an admin (expects `ok: true`). The API takes a `Bearer` token, so call it from the browser console on the live site: `fetch('/api/admin/auth-health',{headers:{Authorization:'Bearer '+JSON.parse(localStorage['vault-auth']).state.token}}).then(r=>r.json()).then(console.log)`. The admin Home page showing no "Two-step login is broken" warning means the same. If it is not ok, fix the key in Railway first and push nothing that depends on it.
2. After the deploy, run the same check again before saying it is live.
3. Keep a second browser signed in as admin until admin enrolment has been seen working on the live site.

Do not change the key once any admin has enrolled: their authenticator secrets could no longer be read.

## Out of scope

Encrypting the stored Google OAuth tokens (could reuse the same AES-256-GCM helper and key). Moving the session token from `localStorage` to an httpOnly cookie (future item in `docs/hardening.md`).
