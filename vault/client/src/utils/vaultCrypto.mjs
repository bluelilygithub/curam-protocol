// Password Vault encryption, all in the browser (Web Crypto, no library). The server never sees the master password, the key or any
// readable entry: it stores what these functions return.
//
//   master password --PBKDF2-SHA256 (salt, 600,000 rounds)--> 256-bit AES-GCM key (not extractable, kept in memory only)
//   entry (JSON)    --AES-256-GCM, fresh random 12-byte nonce every save--> { iv, ciphertext } as base64
//
// The key settings are stored with the vault (`kdf`, `kdfIterations`, `salt`), so the method can be strengthened later (for example
// to Argon2id) without breaking old vaults. `aad` ("additional data", the person's id) is mixed into every encryption so a blob cannot
// be moved to another person's vault. See docs/password-vault.md. Test: node client/src/utils/vaultCrypto.test.mjs

export const KDF = 'pbkdf2-sha256';
export const KDF_ITERATIONS = 600000; // OWASP's figure for PBKDF2-HMAC-SHA256
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
const CHECK = 'curam-vault-check-v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// What goes in as additional data: ties a blob to one person's vault.
export const aadFor = (userId) => `curam-vault:v1:${userId}`;

// The same typed password must give the same key on every device, so it is normalised (NFKC) before use.
const normalise = (pw) => String(pw).normalize('NFKC');

export async function deriveKey(masterPassword, saltB64, iterations = KDF_ITERATIONS, kdf = KDF) {
  if (kdf !== KDF) throw new Error('This vault uses a key method this version does not know.');
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', enc.encode(normalise(masterPassword)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable: script cannot read the key bytes back out
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(key, value, aad) {
  const iv = randomBytes(IV_BYTES);
  const data = enc.encode(JSON.stringify(value));
  const buf = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, data);
  return { iv: toB64(iv), ciphertext: toB64(buf) };
}

// Throws when the key is wrong or the data was changed (AES-GCM checks both).
export async function decryptJson(key, blob, aad) {
  const buf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv), additionalData: enc.encode(aad) }, key, fromB64(blob.ciphertext));
  return JSON.parse(dec.decode(buf));
}

/** Make brand-new key settings for a master password. Returns { settings, key }; `settings` is what the server stores. */
export async function createKeySettings(masterPassword, aad, iterations = KDF_ITERATIONS) {
  const salt = toB64(randomBytes(SALT_BYTES));
  const key = await deriveKey(masterPassword, salt, iterations);
  const verifier = await encryptJson(key, { check: CHECK }, aad);
  return { settings: { kdf: KDF, kdfIterations: iterations, salt, verifier }, key };
}

/** Try a master password against stored settings. Returns the key, or null when it is wrong. */
export async function unlockWith(masterPassword, stored, aad) {
  const key = await deriveKey(masterPassword, stored.salt, stored.kdfIterations, stored.kdf);
  try {
    const v = await decryptJson(key, stored.verifier, aad);
    return v && v.check === CHECK ? key : null;
  } catch {
    return null;
  }
}
