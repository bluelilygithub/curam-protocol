'use strict';

// SERP Tracker daily job: 0 20 * * * UTC = 6:00 am Brisbane. Opens a run for every tracked site, one after another, so a failure on
// one site never stops the next. It calls a paid service, so it is started only where external jobs are allowed (server/index.js,
// not under DISABLE_EXTERNAL_CRON) and runs under withCronLock so two instances during a deploy never both run it.
// `runAllSites` takes everything it needs as arguments so tests need no database or network. See docs/serp-tracker.md.

const cron = require('node-cron');
const { withCronLock } = require('../utils/cronLock');

/** @returns {{ sites, ran, failed, skipped }} */
async function runAllSites({ pool, loadAllSites, runSite, mayUse, deps, modules = [], log = () => {} }) {
  const sites = await loadAllSites(pool);
  const out = { sites: sites.length, ran: 0, failed: 0, skipped: 0 };
  const allowed = new Map(); // userId -> may they still use the tool (asked once per job)
  for (const site of sites) {
    if (!allowed.has(site.userId)) allowed.set(site.userId, await mayUse(site.userId));
    if (!allowed.get(site.userId)) { out.skipped += 1; continue; }
    try {
      const r = await runSite({ pool, site, trigger: 'cron', deps, modules });
      out.ran += 1;
      if (r.status === 'failed') out.failed += 1;
    } catch (err) {
      if (err && err.status === 409) { out.skipped += 1; continue; } // a run for this site is already going
      out.failed += 1;
      log(`site ${site.id} could not be run: ${err && err.message}`);
    }
  }
  return out;
}

let task = null;

/** Real dependencies, loaded only when the job actually starts. */
function realDeps() {
  const { pool } = require('../db');
  const { loadAllSites } = require('../services/serpTracker/store');
  const { runSite } = require('../services/serpTracker/runner');
  const { getBalance, hasCredentials } = require('../services/serpTracker/dataforseo');
  const { logCost } = require('../services/serpTracker/costs');
  const { capture, makeFingerprint } = require('../services/SuggestionService');
  const { loadFeatureAccess } = require('../middleware/auth');
  const mayUse = async (userId) => {
    const { rows } = await pool.query('SELECT "isAdmin" FROM users WHERE id = $1', [userId]);
    if (!rows.length) return false;
    if (rows[0].isAdmin) return true; // admins always have it, as in requireFeature
    return (await loadFeatureAccess(userId)).serpTracker !== false;
  };
  const log = (m) => console.warn(`[serp-tracker] ${m}`);
  return { pool, loadAllSites, runSite, mayUse, log, modules: [], deps: { getBalance, hasCredentials, logCost, capture, makeFingerprint, log } };
}

function startSerpTrackerCron() {
  if (task) return;
  task = cron.schedule('0 20 * * *', async () => {
    try {
      const r = await withCronLock('serp-tracker-daily', () => runAllSites(realDeps()));
      if (r) console.log(`[serp-tracker] daily run: ${r.ran} of ${r.sites} sites ran, ${r.failed} with a failure, ${r.skipped} skipped`);
    } catch (err) { console.warn('[serp-tracker] daily run failed:', err.message); }
  }, { timezone: 'UTC' });
  console.log('[serp-tracker] daily run scheduled at 20:00 UTC (6:00 am Brisbane)');
}

module.exports = { runAllSites, realDeps, startSerpTrackerCron };
