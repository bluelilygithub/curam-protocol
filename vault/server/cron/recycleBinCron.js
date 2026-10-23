'use strict';

// Removes recycle-bin items older than 30 days. It sends nothing outside Vault, so (like the fitness task sync) it runs on every
// server, including where external cron jobs are switched off. The bin's own list also purges, so this is a tidy-up, not a dependency.

const { purgeExpired } = require('../services/recycleBin');

const DAY_MS = 24 * 60 * 60 * 1000;
let timer = null;

async function run() {
  try {
    const n = await purgeExpired();
    if (n) console.log(`[recycle-bin] removed ${n} item${n === 1 ? '' : 's'} older than the retention period`);
  } catch (err) {
    console.warn('[recycle-bin] purge failed:', err.message);
  }
}

function startRecycleBinPurge() {
  setTimeout(run, 60 * 1000); // shortly after boot
  timer = setInterval(run, DAY_MS);
  timer.unref?.();
}

module.exports = { startRecycleBinPurge, run };
