'use strict';

// Removes attachments that have passed their expiry (kept voice-note audio, docs/voice-notes.md). It sends nothing outside Vault, so like the
// recycle-bin purge it runs on every server. A file past its time is also refused by the download route and left out of lists, so this is a
// tidy-up of disk space, not a dependency.

const { purgeExpiredAttachments } = require('../utils/attachments');

const HOUR_MS = 60 * 60 * 1000;
let timer = null;

async function run() {
  try {
    const n = await purgeExpiredAttachments();
    if (n) console.log(`[attachments] removed ${n} expired file${n === 1 ? '' : 's'}`);
  } catch (err) {
    console.warn('[attachments] expiry clean-up failed:', err.message);
  }
}

function startAttachmentExpiry() {
  setTimeout(run, 90 * 1000); // shortly after boot
  timer = setInterval(run, HOUR_MS);
  timer.unref?.();
}

module.exports = { startAttachmentExpiry, run };
