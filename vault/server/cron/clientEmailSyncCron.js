'use strict';

// Daily at 7:00 am Brisbane (21:00 UTC the day before): record the email exchanged with each client in its Activity log, reading each
// person's own connected Gmail. Clients never read before (existing ones the first time, then any new one) go back to 1 July 2026; the
// rest read only what is new. It runs before the stale-deal check (22:00 UTC) so a deal being emailed about is not flagged as quiet.
// It reads Gmail (an outside service) so, like the other mail jobs, it is switched off where DISABLE_EXTERNAL_CRON is set (staging).

const cron = require('node-cron');
const { syncAllUsers } = require('../services/clientEmailSync');
const { capture } = require('../services/SuggestionService');
const { withCronLock } = require('../utils/cronLock');

let task = null;

function startClientEmailSyncCron() {
  if (task) return;
  task = cron.schedule('0 21 * * *', () => {
    withCronLock('client-email-sync', () => syncAllUsers({ capture })).then((r) => {
      if (r) console.log(`[client-email-sync] ${r.clients} clients for ${r.users} people: ${r.created} new, ${r.updated} updated, ${r.failed} failed`);
    }).catch((err) => console.warn('[client-email-sync] run failed:', err.message));
  });
  console.log('[client-email-sync] scheduled daily at 21:00 UTC (7:00 am Brisbane)');
}

module.exports = { startClientEmailSyncCron };
