#!/usr/bin/env node
// AUTH_ENCRYPTION_KEY shapes (docs/env-vars.md): 64 hex characters or base64 of 32 bytes. No database needed.
// Run: node server/services/loginChallenge.key.test.js
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: {} } };
const { authKeyProblem, _internal } = require('./loginChallenge');

const bytes = crypto.randomBytes(32);
const check = (value) => { process.env.AUTH_ENCRYPTION_KEY = value; _internal.resetKeyCache(); return authKeyProblem(); };

assert.strictEqual(check(bytes.toString('base64')), null, 'base64 works');
assert.strictEqual(check(bytes.toString('hex')), null, 'hex works');
assert.strictEqual(check(bytes.toString('hex').toUpperCase()), null, 'upper-case hex works');
assert.strictEqual(check(`  ${bytes.toString('base64')}\n`), null, 'spaces and a newline around it are ignored');
assert.strictEqual(check(bytes.toString('base64').replace(/=$/, '')), null, 'base64 without its = works');
const same = () => _internal.hashCode('c', '123456');
check(bytes.toString('hex')); const h1 = same();
check(bytes.toString('base64')); const h2 = same();
assert.strictEqual(h1, h2, 'hex and base64 of the same bytes are the same key');

assert.ok(/not set/.test(check('')), 'missing');
for (const bad of [crypto.randomBytes(16).toString('hex'), crypto.randomBytes(48).toString('base64'), `"${bytes.toString('base64')}"`, 'correct horse battery staple', bytes.toString('hex').slice(1)]) {
  const p = check(bad);
  assert.ok(p && /64 hex characters or 44 base64/.test(p), `refused: length ${bad.length}`);
  assert.ok(!p.includes(bad), 'the message never contains the value');
}
console.log('loginChallenge key shapes: ok');
