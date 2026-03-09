'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES  = 12; // 96-bit IV (recommended for GCM)

/**
 * Returns a 32-byte Buffer derived from the ENCRYPTION_KEY env var (64 hex chars).
 * Returns null if the key is absent — callers treat null as "no encryption".
 * Throws if the key is present but malformed.
 */
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, 'hex');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate with: openssl rand -hex 32');
  }
  return buf;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a string in the format "hexIV:hexAuthTag:hexCiphertext".
 * Returns the original value unchanged if ENCRYPTION_KEY is absent or plaintext is falsy.
 */
function encrypt(plaintext) {
  const key = getKey();
  if (!key || !plaintext) return plaintext;

  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Decrypt a string previously produced by encrypt().
 * Gracefully returns the value unchanged if:
 *   - ENCRYPTION_KEY is absent
 *   - The value doesn't match the expected "iv:tag:cipher" format (plaintext row)
 *   - Decryption fails for any reason
 * This allows existing plaintext rows to continue working during the migration period.
 */
function decrypt(stored) {
  const key = getKey();
  if (!key || !stored) return stored;

  const parts = stored.split(':');
  if (parts.length !== 3) return stored; // plaintext row — pass through

  const [ivHex, tagHex, encHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return stored; // decryption failed — return as-is
  }
}

module.exports = { encrypt, decrypt, getKey };
