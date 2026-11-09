'use strict';

// Daily at 8:00 am Brisbane (22:00 UTC the day before): raise a Suggestions card for every open deal that has gone quiet.
// It sends nothing outside Vault and calls no paid service, so (like the recycle bin tidy) it runs on every server. The lock stops
// two servers raising the same cards during a rolling deploy.

const cron = require('node-cron');
const { runStaleDealCheck } = require('../services/staleDeals');
const { withCronLock } = require('../utils/cronLock');

let task = null;

function startStaleDealsCron() {
  if (task) return;
  task = cron.schedule('0 22 * * *', () => {
    withCronLock('stale-deals', runStaleDealCheck).then((r) => {
      if (r) console.log(`[stale-deals] ${r.stale} stale of ${r.checked} open deals`);
    }).catch((err) => console.warn('[stale-deals] run failed:', err.message));
  });
  console.log('[stale-deals] scheduled daily at 22:00 UTC (8:00 am Brisbane)');
}

module.exports = { startStaleDealsCron };
