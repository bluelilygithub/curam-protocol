'use strict';

// Hourly: deletes sign-in challenges older than a day and expired remembered devices (docs/two-step-login.md).
// Sends nothing, so it runs on every server; withCronLock stops two servers doing it at once during a rolling deploy.

const { withCronLock } = require('../utils/cronLock');
const { purgeOldAuthRecords } = require('../services/trustedDevices');
const { getLogger } = require('../middleware/requestContext');

const HOUR_MS = 60 * 60 * 1000;

async function run() {
  try {
    const r = await withCronLock('auth-cleanup', purgeOldAuthRecords);
    if (r && (r.challenges || r.devices)) getLogger().info(r, 'auth clean-up');
  } catch (err) {
    getLogger().warn({ err: err.message }, 'auth clean-up failed');
  }
}

function startAuthCleanup() {
  setTimeout(run, 150 * 1000).unref?.();
  setInterval(run, HOUR_MS).unref?.();
}

module.exports = { startAuthCleanup, run };
