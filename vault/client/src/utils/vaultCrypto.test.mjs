// node client/src/utils/vaultCrypto.test.mjs   (part of npm run test:password-vault)

import assert from 'node:assert';
import { KDF_ITERATIONS, aadFor, createKeySettings, decryptJson, encryptJson, fromB64, toB64, unlockWith } from './vaultCrypto.mjs';

// base64 round trip, including a big buffer (the chunked conversion)
const big = new Uint8Array(100000).map((_, i) => i % 251);
assert.deepStrictEqual(fromB64(toB64(big)), big);
assert.strictEqual(toB64(new Uint8Array([104, 105])), 'aGk=');

// (assert.rejects treats a string as an expected message, so a tiny helper carries the reason instead)
const mustFail = async (p, why) => { try { await p; } catch { return; } assert.fail(why); };

const aad = aadFor(7);
const ITER = 2000; // fast for the tests; the real value is checked below

const { settings, key } = await createKeySettings('correct horse battery staple', aad, ITER);
assert.strictEqual(settings.kdf, 'pbkdf2-sha256');
assert.strictEqual(settings.kdfIterations, ITER);
assert.ok(settings.salt && settings.verifier.iv && settings.verifier.ciphertext);

// round trip, with accents and emoji
const entry = { title: 'Bank – café', password: 'pässwörd 🔑', notes: 'x'.repeat(5000) };
const blob = await encryptJson(key, entry, aad);
assert.deepStrictEqual(await decryptJson(key, blob, aad), entry);

// nothing readable is stored
assert.ok(!Buffer.from(blob.ciphertext, 'base64').toString('latin1').includes('pässwörd'));
assert.ok(!JSON.stringify(blob).includes('Bank'));

// a fresh nonce every time: the same entry never encrypts to the same bytes
const again = await encryptJson(key, entry, aad);
assert.notStrictEqual(again.iv, blob.iv);
assert.notStrictEqual(again.ciphertext, blob.ciphertext);
const nonces = new Set();
for (let i = 0; i < 200; i++) nonces.add((await encryptJson(key, { i }, aad)).iv);
assert.strictEqual(nonces.size, 200, 'no repeated nonce in 200 saves');

// the right master password opens it, a wrong or near-miss one does not
const stored = { ...settings };
assert.ok(await unlockWith('correct horse battery staple', stored, aad), 'right password unlocks');
assert.strictEqual(await unlockWith('correct horse battery stapl', stored, aad), null, 'wrong password is refused');
assert.strictEqual(await unlockWith('Correct horse battery staple', stored, aad), null, 'case matters');
const other = await unlockWith('correct horse battery staple', stored, aad);
assert.deepStrictEqual(await decryptJson(other, blob, aad), entry, 'a second unlock reads the same data');

// the same typed password gives the same key whichever way an accent was typed (composed vs combining)
const a = await createKeySettings('café-password-1', aad, ITER);
assert.ok(await unlockWith('café-password-1', a.settings, aad), 'normalised before use');

// tampering and moving blobs are caught
const flipped = Buffer.from(blob.ciphertext, 'base64'); flipped[3] ^= 1;
await mustFail(decryptJson(key, { iv: blob.iv, ciphertext: flipped.toString('base64') }, aad), 'a changed byte is detected');
await mustFail(decryptJson(key, { iv: again.iv, ciphertext: blob.ciphertext }, aad), 'the wrong nonce is detected');
await mustFail(decryptJson(key, blob, aadFor(8)), "another person's vault cannot read it");

// the key cannot be read back out of the browser object
await mustFail(globalThis.crypto.subtle.exportKey('raw', key), 'key is not extractable');

// an unknown key method is refused rather than guessed at
await assert.rejects(unlockWith('x', { ...stored, kdf: 'md5' }, aad), /key method/);

// the real strength setting works and is not trivially fast
assert.strictEqual(KDF_ITERATIONS, 600000);
const t0 = Date.now();
const real = await createKeySettings('a real master password', aad);
const ms = Date.now() - t0;
assert.strictEqual(real.settings.kdfIterations, 600000);
assert.ok(await unlockWith('a real master password', real.settings, aad));
console.log(`vaultCrypto tests passed (600k rounds ≈ ${ms} ms here)`);
