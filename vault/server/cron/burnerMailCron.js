'use strict';

// Deletes the emails of burner addresses a day after they expire. The address itself is kept (a tombstone) so it is never issued again;
// an expired address already stops receiving mail and drops out of the list, so this is a tidy-up, not a dependency. Sends nothing outside Vault, so it runs on every server.

const { purgeExpired } = require('../routes/burnerMail');

const HOUR_MS = 60 * 60 * 1000;
let timer = null;

async function run() {
  try {
    const n = await purgeExpired();
    if (n) console.log(`[burner-mail] removed ${n} email${n === 1 ? '' : 's'} from expired addresses`);
  } catch (err) {
    console.warn('[burner-mail] clean-up failed:', err.message);
  }
}

function startBurnerMailPurge() {
  setTimeout(run, 120 * 1000);
  timer = setInterval(run, HOUR_MS);
  timer.unref?.();
}

module.exports = { startBurnerMailPurge, run };
