'use strict';

// What kind of picture a buffer really is, from its first bytes (never from the name or the type the sender claimed).
// Used by the Vault Shelf routes: only a real PNG / JPEG / GIF / WebP is accepted, so a renamed program or script is refused.

/** @returns {{ mime: string, ext: string } | null} */
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { mime: 'image/png', ext: '.png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  const head6 = buf.toString('latin1', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return { mime: 'image/gif', ext: '.gif' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

module.exports = { sniffImage };
