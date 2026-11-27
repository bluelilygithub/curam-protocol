'use strict';

// AES-256-GCM for small secrets at rest (two-step login's authenticator secrets; docs/two-step-login.md).
// Stored as "iv.tag.ciphertext", each part base64. A changed byte anywhere makes decrypt throw.

const crypto = require('crypto');

function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

/** Returns a Buffer; throws if the key is wrong or the stored value was changed. */
function decrypt(key, stored) {
  const [iv, tag, ct] = String(stored).split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !ct || iv.length !== 12 || tag.length !== 16) throw new Error('bad encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

module.exports = { encrypt, decrypt };
