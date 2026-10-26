'use strict';

// node server/services/passwordVault/validate.test.js   (npm run test:password-vault)

const assert = require('assert');
const crypto = require('crypto');
const { b64Bytes, blobError, keyParamsError, MAX_CIPHERTEXT_BYTES } = require('./validate');

const b64 = (n) => crypto.randomBytes(n).toString('base64');

assert.strictEqual(b64Bytes(b64(12)), 12);
assert.strictEqual(b64Bytes(b64(13)), 13);
assert.strictEqual(b64Bytes(b64(14)), 14);
assert.strictEqual(b64Bytes('not base64!'), null);
assert.strictEqual(b64Bytes(''), null);
assert.strictEqual(b64Bytes(42), null);

const good = { iv: b64(12), ciphertext: b64(40) };
assert.strictEqual(blobError(good), null);
assert.match(blobError(null), /missing/);
assert.match(blobError({ iv: b64(8), ciphertext: b64(40) }), /nonce/);
assert.match(blobError({ iv: b64(12), ciphertext: b64(16) }), /not valid/, 'a tag with no data is not an entry');
assert.match(blobError({ iv: b64(12), ciphertext: 'zz' }), /not valid/);
assert.match(blobError({ iv: b64(12), ciphertext: b64(MAX_CIPHERTEXT_BYTES + 1) }), /too big/);
assert.strictEqual(blobError({ iv: b64(12), ciphertext: b64(MAX_CIPHERTEXT_BYTES) }), null);

const params = { kdf: 'pbkdf2-sha256', kdfIterations: 600000, salt: b64(16), verifier: good };
assert.strictEqual(keyParamsError(params), null);
assert.match(keyParamsError({ ...params, kdf: 'md5' }), /not supported/);
assert.match(keyParamsError({ ...params, kdfIterations: 1000 }), /out of range/, 'a weakened key strength is refused');
assert.match(keyParamsError({ ...params, kdfIterations: 'x' }), /out of range/);
assert.match(keyParamsError({ ...params, salt: b64(4) }), /salt/);
assert.match(keyParamsError({ ...params, verifier: null }), /missing/);
assert.match(keyParamsError(null), /missing/);

console.log('passwordVault validate tests passed');
