'use strict';

// Authenticator-app codes, RFC 6238: HMAC-SHA1, 30-second steps, 6 digits, one step either side allowed.
// Built on Node's crypto (no package). See docs/two-step-login.md.

const crypto = require('crypto');

const STEP_SEC = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** The 6-digit code for one time step (RFC 4226 dynamic truncation). */
function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', secret).update(counter).digest();
  const off = h[h.length - 1] & 0x0f;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1000000).padStart(6, '0');
}

const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SEC);

/**
 * Check a typed code. Returns the matching step, or null. A step at or before lastStep is refused,
 * so a code (or an earlier one) can never be used twice.
 */
function verify(secret, typed, { lastStep = null, now = Date.now() } = {}) {
  const code = String(typed || '').replace(/\D/g, '');
  if (code.length !== 6) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep != null && step <= Number(lastStep)) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

function newSecret() {
  return crypto.randomBytes(20); // 160 bits, as RFC 4226 recommends
}

/** What the authenticator app scans. Shown as a QR code drawn in the browser. */
function otpauthUri(secret, accountName, issuer = 'Curam Vault') {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SEC}`;
}

/** The secret typed by hand, in groups of four: "ABCD EFGH ...". */
function manualKey(secret) {
  return base32Encode(secret).match(/.{1,4}/g).join(' ');
}

module.exports = { codeAt, verify, newSecret, otpauthUri, manualKey, stepAt, base32Encode };
