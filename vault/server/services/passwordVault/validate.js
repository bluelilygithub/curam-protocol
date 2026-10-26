'use strict';

// Password Vault: what the server checks about the encrypted blobs it stores. The server NEVER sees a master password, a key or a
// plain password: it only keeps base64 text the browser made (AES-256-GCM, a fresh 12-byte nonce per save, key from the master
// password in the browser). These checks stop junk and oversized rows; they cannot tell good ciphertext from random bytes, and are
// not meant to. See docs/password-vault.md.

const KDFS = { 'pbkdf2-sha256': { minIterations: 300000, maxIterations: 5000000 } };
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_CIPHERTEXT_BYTES = 48 * 1024; // one entry (title, username, address, password, notes) after encryption
const MAX_ENTRIES_PER_USER = 2000;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Decoded size of a base64 string, or null when it is not base64.
function b64Bytes(s) {
  if (typeof s !== 'string' || !s || s.length % 4 !== 0 || !B64.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

// { iv, ciphertext } -> an error sentence, or null when the blob looks right.
function blobError(b) {
  if (!b || typeof b !== 'object') return 'The encrypted data is missing.';
  if (b64Bytes(b.iv) !== IV_BYTES) return 'The encrypted data has a bad nonce.';
  const n = b64Bytes(b.ciphertext);
  if (n === null || n <= GCM_TAG_BYTES) return 'The encrypted data is not valid.';
  if (n > MAX_CIPHERTEXT_BYTES) return 'This entry is too big. Shorten the notes.';
  return null;
}

// { kdf, kdfIterations, salt, verifier } -> an error sentence, or null.
function keyParamsError(p) {
  if (!p || typeof p !== 'object') return 'The key settings are missing.';
  const kdf = KDFS[p.kdf];
  if (!kdf) return 'That key method is not supported.';
  const it = Number(p.kdfIterations);
  if (!Number.isInteger(it) || it < kdf.minIterations || it > kdf.maxIterations) return 'The key strength setting is out of range.';
  const saltBytes = b64Bytes(p.salt);
  if (saltBytes === null || saltBytes < 16 || saltBytes > 64) return 'The salt is not valid.';
  return blobError(p.verifier);
}

module.exports = { KDFS, IV_BYTES, GCM_TAG_BYTES, MAX_CIPHERTEXT_BYTES, MAX_ENTRIES_PER_USER, b64Bytes, blobError, keyParamsError };
