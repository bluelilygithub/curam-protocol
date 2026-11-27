# Two-step login

After the right password, Vault asks for a second step before it makes a session. Members and accountant logins get a 6-digit code by email, only on a device Vault doesn't recognise. Admins use an authenticator app (TOTP), with backup codes as their fallback.

This is the brief, with the Milestone 0 findings and the agreed changes (2026-11-27) folded in. It is built in four milestones; the status of each is at the end. **What each person sees** and **Recovery** are the two sections to read first.

## What each person sees

- **Member:** password, then (only on a browser Vault doesn't remember) a 6-digit code by email, with "Remember this device for 30 days" ticked. Settings → Security lists their remembered devices (Forget one, Forget all devices) and Sign out other sessions. No authenticator, no backup codes.
- **Accountant login:** the same emailed code at sign-in. Settings → Security answers 403 for them (the read-only accountant scope refuses it) and says it is not available for a read-only login; an admin manages their sign-in.
- **Admin:** password, then an authenticator code (or "Use a backup code"), unless the browser is remembered (7 days). The first time, they set up the authenticator during sign-in (QR, manual key, confirm a code, 10 backup codes once). Settings → Security also shows when the authenticator was set up, how many backup codes are left (amber at 3 or fewer) and **Regenerate backup codes** (needs the current authenticator code; the 10 new codes show once with Copy, Download and "I've saved these"; the old ones stop working at once).
- **A new person:** an admin types their email in Dashboard (or Settings → Members) and presses **Create and send invite**. They get a welcome email with a link to choose their own password (7 days, once; the same `password_resets` table and page as Forgot password), then the second step above at their first sign-in. If the email can't be sent the admin sees the link to pass on, or sets a password with Reset Password. (Before 2026-11-27 the admin typed a password and no email was sent.)
- **Admin, on Dashboard:** **Reset 2-step login** on every other user's row (not their own), confirmed in a `Dialog`.

Nothing on Settings → Security ever signs out the browser you are using: Forget and Forget all devices only make those browsers ask for a code at their next sign-in, and Sign out other sessions ends every session except the one making the request.

## Recovery

- **A member lost access to their email, or suspects someone else signed in:** an admin uses **Reset 2-step login** on their Dashboard row (signs them out everywhere and forgets their devices), and Reset Password if needed. Their next sign-in asks for an emailed code.
- **An admin lost their phone but has backup codes:** sign in with a backup code, then ask another admin to reset their two-step login so they set up the authenticator on the new phone at the next sign-in. There is no "set up again" button for yourself, on purpose: it would let a stolen session replace the authenticator.
- **An admin lost their phone and their backup codes, and another admin exists:** the other admin uses **Reset 2-step login** on their row.
- **The only admin is locked out** (or every admin is): in the Railway dashboard open the Vault service's shell (or run `railway ssh` with the Railway CLI) and run `node server/scripts/reset-2fa.js <their email>`. It prints what it removed. Then sign in with the password and set up the authenticator again. It works for user 1 (forced admin on every boot). It does not change the password; for that, use "Forgot password" on the sign-in page.
- **Never change `AUTH_ENCRYPTION_KEY` once any admin has enrolled.** Their authenticator secrets are encrypted with it and could no longer be read, so every admin would be locked out and need `reset-2fa.js`; outstanding backup codes and emailed codes would stop working too. If the key really must change (a leak), change it, then run `reset-2fa.js` for every admin and have them enrol again.
- **The key is broken or missing:** nobody can finish a sign-in. See "When the key is broken" below; fix it in Railway, do not work round it.

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
  - admin on a remembered device with an authenticator set up → session
  - admin with an authenticator → `{ challengeId, method: 'totp', rememberDays: 7 }`
  - admin without one → `{ challengeId, method: 'totp_enrol', rememberDays: 7 }`
- `POST /api/auth/challenge/verify` `{ challengeId, code, rememberDevice }` → session (+ device cookie from Milestone 2). A dead challenge answers `400 { code: 'challenge_dead' }`; a wrong code `400 { error, attemptsLeft }`.
- `POST /api/auth/challenge/resend` `{ challengeId }`. A failed send answers `502 { code: 'code_send_failed' }`. An unknown, dead or unusable challenge (including a broken key) answers `400 { code: 'challenge_dead' }`.
- `POST /api/auth/challenge/backup` `{ challengeId, backupCode, rememberDevice }` → session and `backupCodesLeft` (admins, `totp` challenges only)
- `POST /api/auth/challenge/enrol/start` `{ challengeId }` → `{ otpauthUri, manualKey }`. **No image**: the browser draws the QR code with `qrEncode.mjs`.
- `POST /api/auth/challenge/enrol/confirm` `{ challengeId, code }` → `{ backupCodes }` + session

Errors are generic ("That code didn't work") and never reveal whether an account exists. Wrong codes answer 400, not 401, so nothing treats them as "signed out".

Behind `requireAuth` (Milestone 4, details under Milestones): `GET /api/auth/security`, `DELETE /api/auth/devices/:id` (owner check), `POST /api/auth/devices/forget-all`, `POST /api/auth/backup-codes/regenerate` `{ code }`, `POST /api/auth/sessions/sign-out-others`. Behind `requireAdmin` (built in Milestone 3): `POST /api/admin/users/:id/reset-2fa` (clears the authenticator, backup codes, remembered devices, open challenges and every session; answers `{ ok, removed }`). No model calls, so no `aiLimiter`.

## UI

- Login page, step 2 (`client/src/pages/LoginPage.jsx`): one code box (`autocomplete="one-time-code"`, numeric keyboard; a pasted code with spaces is cleaned to its 6 digits), Resend with a one-minute countdown, Start again, and from Milestone 2 "Remember this device". Admins get their own step in `client/src/pages/login/AdminSecondStep.jsx`: authenticator code, or "Use a backup code". It uses raw `fetch` like the password step: `apiClient`'s 401 handler reloads `/login` and would lose the challenge.
- **No VoiceInput on code fields, on purpose**: a code is read off another screen and typed or pasted, and speaking it aloud is a security risk.
- Admin enrolment (Milestone 3): QR code from `qrEncode.mjs`, the manual key with a copy button, confirm a code, then the backup codes once with Copy, Download and "I've saved these".
- Settings → Security (Milestone 4): authenticator status, backup codes left with Regenerate, trusted devices with Forget (inline Yes/No) and Forget all, Sign out other sessions, (i) box, Settings guide and tour updated.
- Dashboard (Milestone 4): "Reset 2-step login" on each user row, confirmed in the shared `Dialog`.

## Milestones

1. **Live (2026-11-27).** `auth_login_challenges`, the email-code flow for members and accountants, verify and resend, IP and per-account limits, send-failure handling. Files: `server/services/loginChallenge.js`, `server/routes/auth.js`, `server/db.js`, `server/index.js` (boot key check), `client/src/pages/LoginPage.jsx`. **Until Milestone 3, admins sign in with their password alone, as before.** Until Milestone 2, members are asked for a code at every sign-in (there are no trusted devices yet). Tests: `DATABASE_URL=... node server/services/loginChallenge.db.test.js` (13), `DATABASE_URL=... node server/routes/auth.test.js` (7, now completes the code step).
2. **Live (2026-11-27).** `auth_trusted_devices`; `server/services/trustedDevices.js` (cookie `vault_device`, httpOnly, Secure, SameSite=Lax, `Path=/api/auth` so it is only sent to the sign-in routes; stored as a SHA-256 hash; 30 days, 7 for an admin; label such as "Chrome on Windows"). Login skips the code when the browser's cookie matches a live device **for that same user**. `POST /api/auth/challenge/verify` with `rememberDevice: true` sets the cookie; the login page's "Remember this device for N days" box is ticked by default (`rememberDays` comes from the login answer). New passwords: changing your own (`server/routes/user.js`) ends your other sessions and keeps this one; a reset (`auth.js`) or an admin setting one (`admin.js`) ends every session; all three forget every remembered device. Clean-up: `server/cron/authCleanupCron.js`, hourly in `withCronLock('auth-cleanup')`, deletes challenges over a day old and expired devices. The "admin login from a new device" alert arrives with Milestone 3, when admins first get a second step. Test: `DATABASE_URL=... node server/services/trustedDevices.db.test.js` (10). Seen in a browser locally: box ticked, cookie flags, a second sign-in on the same browser skips the code, a fresh browser is asked for one.
3. **Live (2026-11-27).** Admins sign in with an authenticator app. Confirmed on the live site by the owner (the only admin): enrolled with Google Authenticator, backup codes saved, then signed in from a fresh private window in Edge with an authenticator code. A backup-code sign-in was not tried live, on purpose (each code works once); it was tested locally.
   - **Files:** `server/services/totp.js` (RFC 6238 on Node's `crypto`: `codeAt`, `verify` with ±1 step and no reuse, `otpauthUri`, `manualKey`), `server/utils/aesGcm.js` (AES-256-GCM, `iv.tag.ciphertext`; reusable for the Google OAuth tokens later), `server/services/authenticator.js` (admin challenges, enrolment, backup codes, alerts), `server/services/twoStepReset.js` (one reset used by the admin route and the script), `server/scripts/reset-2fa.js`, tables `auth_totp` and `auth_backup_codes` in `server/db.js`, `client/src/pages/login/AdminSecondStep.jsx`.
   - **Login:** an admin always gets a second step unless the browser is a remembered device (7 days) **and** an authenticator is already set up. No authenticator yet: `totp_enrol` (15 minutes to finish). Otherwise `totp` (10 minutes). `loginChallenge.finishChallenge()` checks every method the same way: 5 wrong per challenge, 10 wrong an hour per account, session made in the challenge's transaction.
   - **Enrolment:** `enrol/start` returns only `otpauthUri` and `manualKey`; a reload shows the same secret until it is confirmed. The secret is stored encrypted, `enabledAt` empty. `enrol/confirm` takes the first code, switches it on, records the step (so that code is spent), makes 10 backup codes and the session. A password alone can never replace an authenticator that is already on.
   - **Backup codes:** 10 codes like `ABCDE-FGHJK` (no 0, O, 1 or I), HMAC-SHA256 with `AUTH_ENCRYPTION_KEY` and the user id, single-use, shown once with Copy, Download and "I've saved these". Case, spaces and dashes are ignored when typed. Regenerating them from Settings is Milestone 4.
   - **Alerts (Suggestions, primary admin):** an admin finishing a second step on a browser Vault did not remember ("Admin sign-in from a new device", one per person, device, address and day), and every backup code used (with how many are left).
   - **Admins and email:** admins never get an email challenge; `resend` on an admin challenge answers `challenge_dead`; members cannot use the backup or enrolment routes.
   - **Broken key:** admins cannot sign in either (503 with a plain message). Fix the key in Railway; nobody gets in on a password alone. Do not change the key once admins have enrolled.
   - **Reset:** `POST /api/admin/users/:id/reset-2fa` (admin only) and `node server/scripts/reset-2fa.js <email>` remove the authenticator, backup codes, remembered devices, sessions and open challenges. The admin flag is untouched, so an admin (user 1 included) is asked to set up again at the next sign-in. The Dashboard button is Milestone 4.
   - **Tests:** `node server/services/totp.test.js` (RFC 6238 Appendix B SHA-1 vectors, ±1 window, reuse, AES-GCM round trip and tampering), `DATABASE_URL=... node server/services/authenticator.db.test.js` (11: enrolment, TOTP, backup codes once only, another admin's codes refused, no email for admins, no replacing an authenticator, 5 wrong codes, 7-day device, admin reset, the script, broken key). Seen in a browser locally: password → enrol screen → QR (checked to encode exactly the server's otpauth link; a phone was not used) → code → backup codes (Copy, Download, Continue locked until ticked) → signed in; then an authenticator-code sign-in, a backup-code sign-in, and the same backup code refused. `reset-2fa.js` run on local user 1.
4. **Built (2026-11-27), not yet pushed.** Settings → Security and the Dashboard reset action.
   - **Routes** (`server/routes/auth.js`, each with `requireAuth` on the route, because the global one skips `/api/auth/*`): `GET /api/auth/security` → `{ isAdmin, authenticatorSince, backupCodesLeft, devices: [{ id, label, lastUsedAt, expiresAt, createdAt, current }], otherSessions }` (`current` marks this browser: the device cookie is sent to `/api/auth/*` and read by `trustedDevices.currentTokenHash()`); `DELETE /api/auth/devices/:id` (your own only, else 404); `POST /api/auth/devices/forget-all`; `POST /api/auth/backup-codes/regenerate { code }` (IP-limited like the other code routes, and **5 wrong codes an hour per account**: after that it answers 429 even to a right code until the hour is up. Each wrong code is stored as an already-used `regen` row in `auth_login_challenges` with `attempts` 0, so it never counts against signing in and a stolen session cannot use it to lock the owner out; the hourly clean-up removes it after a day. A right code is checked and the new codes made in one transaction, so the code is spent and a wrong one changes nothing); `POST /api/auth/sessions/sign-out-others` (deletes every session but the request's own token). None touches the requesting session.
   - **Client:** `client/src/components/settings/SecurityPanel.jsx` (Settings section `Security` in the You group, `settingsGroups.mjs`), reusing `BackupCodes` and `CodeInput` from `client/src/pages/login/AdminSecondStep.jsx`; the (i) box opens by itself once (`vault_security_info_seen`). Dashboard and Settings → Members: `client/src/components/UsersAdminPanel.jsx`, "Reset 2-step login" hidden on your own row. Settings guide: a `Security` entry in `server/services/settingsTutor.js`. Tour: step 8 of the Settings tour (`client/src/utils/tours/integrationsTour.js`).
   - **Tests:** `DATABASE_URL=... node server/routes/authSecurity.db.test.js` (9: every route needs a session; the regenerate limit (5 wrong an hour per account, then even a right code refused, other accounts unaffected, sign-in count untouched, open again after an hour); own devices only, "this browser" marked, no hashes sent; forget one / all keeps this session and other people's devices; sign out others keeps this session; regenerate needs a fresh authenticator code, kills the old codes, the same code can't be used twice; members can't make codes; accountants refused). `node client/src/utils/settingsGroups.test.mjs` updated for the new section.
   - **Seen in a browser locally** (Playwright, against a second local copy with a throwaway key; screenshots looked at): (i) box, "9 of 10" backup codes, "This browser"; regenerate (wrong code refused, 10 new codes, Copy and Download checked, Done locked until ticked, an old code dead); forget one (No keeps it, Yes removes it); forget all (empty state, this and other sessions still signed in); sign out others (other session ended, this one still signed in after a reload); Dashboard reset of a test member in the Dialog (Cancel changes nothing, Reset signs them out and forgets their devices, no button on your own row); member view (no authenticator box); tour step 8. A full admin enrolment and a member emailed-code sign-in were not repeated for this milestone (seen in Milestones 1 to 3, code unchanged).

**Before pushing Milestone 3** (or anything else that depends on the key):

1. Confirm the key works **on the live server** with `GET /api/admin/auth-health` while signed in as an admin (expects `ok: true`). The API takes a `Bearer` token, so call it from the browser console on the live site: `fetch('/api/admin/auth-health',{headers:{Authorization:'Bearer '+JSON.parse(localStorage['vault-auth']).state.token}}).then(r=>r.json()).then(console.log)`. The admin Home page showing no "Two-step login is broken" warning means the same. If it is not ok, fix the key in Railway first and push nothing that depends on it.
2. After the deploy, run the same check again before saying it is live.
3. Keep a second browser signed in as admin until admin enrolment has been seen working on the live site.

Do not change the key once any admin has enrolled: their authenticator secrets could no longer be read.

## Out of scope

Encrypting the stored Google OAuth tokens (could reuse the same AES-256-GCM helper and key). Moving the session token from `localStorage` to an httpOnly cookie (future item in `docs/hardening.md`).
