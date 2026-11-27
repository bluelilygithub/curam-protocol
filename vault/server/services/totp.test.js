#!/usr/bin/env node
// TOTP (RFC 6238) and the AES-256-GCM helper. No database needed.
// Run: node server/services/totp.test.js
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const totp = require('./totp');
const { encrypt, decrypt } = require('../utils/aesGcm');

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890"; the RFC shows 8 digits, an app shows the last 6
const rfc = Buffer.from('12345678901234567890');
for (const [t, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
  assert.strictEqual(totp.codeAt(rfc, Math.floor(t / 30)), code, `T=${t}`);
}

// window: one step either side
const now = 1111111109 * 1000;
const step = totp.stepAt(now);
assert.strictEqual(totp.verify(rfc, '081804', { now }), step);
assert.strictEqual(totp.verify(rfc, totp.codeAt(rfc, step - 1), { now }), step - 1, 'previous step accepted');
assert.strictEqual(totp.verify(rfc, totp.codeAt(rfc, step + 1), { now }), step + 1, 'next step accepted');
assert.strictEqual(totp.verify(rfc, totp.codeAt(rfc, step - 2), { now }), null, 'two steps old refused');
assert.strictEqual(totp.verify(rfc, totp.codeAt(rfc, step + 2), { now }), null, 'two steps ahead refused');

// reuse: a used step, or anything before it, is refused
assert.strictEqual(totp.verify(rfc, '081804', { now, lastStep: step }), null, 'same code twice refused');
assert.strictEqual(totp.verify(rfc, totp.codeAt(rfc, step - 1), { now, lastStep: step }), null, 'older code after a newer one refused');
assert.strictEqual(totp.verify(rfc, totp.codeAt(rfc, step + 1), { now, lastStep: step }), step + 1, 'a later step still works');

// rubbish
for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '08 18 04x']) assert.strictEqual(totp.verify(rfc, bad, { now }), bad === '08 18 04x' ? step : null, String(bad));

// otpauth link and manual key: base32 of the RFC secret is well known
assert.strictEqual(totp.base32Encode(rfc), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
assert.strictEqual(totp.manualKey(rfc), 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
assert.strictEqual(totp.otpauthUri(rfc, 'me@example.com'),
  'otpauth://totp/Curam%20Vault%3Ame%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Curam%20Vault&algorithm=SHA1&digits=6&period=30');
assert.strictEqual(totp.newSecret().length, 20);

// AES-256-GCM: round trip; a changed byte, the wrong key or a malformed value fails
const key = crypto.randomBytes(32);
const secret = totp.newSecret();
const stored = encrypt(key, secret);
assert.ok(!stored.includes(secret.toString('base64')), 'not stored plain');
assert.ok(decrypt(key, stored).equals(secret));
assert.notStrictEqual(encrypt(key, secret), stored, 'a fresh IV every time');
const [iv, tag, ct] = stored.split('.');
const flip = (b64) => { const b = Buffer.from(b64, 'base64'); b[0] ^= 1; return b.toString('base64'); };
for (const tampered of [[iv, tag, flip(ct)], [iv, flip(tag), ct], [flip(iv), tag, ct]]) assert.throws(() => decrypt(key, tampered.join('.')));
assert.throws(() => decrypt(crypto.randomBytes(32), stored), 'wrong key');
assert.throws(() => decrypt(key, 'nonsense'));

console.log('totp + aes-gcm: ok');
