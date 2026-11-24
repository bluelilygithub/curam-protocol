'use strict';

// Tickets daily digest at 7 AM in the workspace time zone (the first admin's, as the compliance crons use). Sends email, so it is started
// with the other external crons (DISABLE_EXTERNAL_CRON turns it off). One run at a time across servers (withCronLock); the per-person day
// in ticket_digest_log stops a second send. See services/ticketDigest.js and docs/tickets.md.

const cron = require('node-cron');
const { withCronLock } = require('../utils/cronLock');

const SCHEDULE = '0 7 * * *';
let task = null;

async function startTicketDigestCron() {
  if (task) return;
  const timeZone = await require('../services/complianceAdvisory/cron').getWorkspaceTimezone();
  task = cron.schedule(SCHEDULE, () => {
    withCronLock('tickets-digest', () => require('../services/ticketDigest').runDigest({ timeZone }))
      .then((r) => { if (r && (r.sent || r.failed)) console.log(`[tickets-digest] ${r.day}: ${r.sent} sent, ${r.failed} failed, ${r.empty} with nothing to send`); })
      .catch((err) => console.error('[tickets-digest] run failed:', err.message));
  }, { timezone: timeZone });
  console.log(`[tickets-digest] daily digest scheduled for 07:00 ${timeZone}`);
}

module.exports = { startTicketDigestCron, SCHEDULE };
