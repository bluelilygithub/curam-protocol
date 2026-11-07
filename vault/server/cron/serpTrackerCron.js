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

/**
 * The Keywords tab's daily Search Console update: every tracked site that has a property chosen, one after another (a failure on one never stops
 * the next), skipping people who no longer have the tool or whose Search Console is not connected. Free: it only reads Google.
 * Everything is passed in so a test needs no database or network.
 */
async function syncAllGsc({ pool, loadAllSites, mayUse, connection, queryRows, history, capture, makeFingerprint, log = () => {} }) {
  const sites = (await loadAllSites(pool)).filter((s) => s.gscSiteUrl);
  const out = { sites: sites.length, synced: 0, failed: 0, skipped: 0, alerts: 0 };
  const seen = new Set();
  for (const site of sites) {
    const key = `${site.userId}|${site.gscSiteUrl}`;
    if (seen.has(key)) continue; // two sites on one property are loaded once
    seen.add(key);
    try {
      if (!(await mayUse(site.userId)) || !(await connection(site.userId)).connected) { out.skipped += 1; continue; }
      const fetchRows = ({ startDate, endDate, startRow, rowLimit }) => queryRows(site.userId, site.gscSiteUrl, { startDate, endDate, dimensions: ['date', 'query'], rowLimit, startRow });
      const r = await history.syncSite({ pool, userId: site.userId, siteUrl: site.gscSiteUrl, fetchRows, log });
      if (!r.started) { out.skipped += 1; continue; }
      if (!r.ok) {
        out.failed += 1;
        await capture({
          userId: site.userId, source: 'serpTracker', category: 'alert',
          fingerprint: makeFingerprint('serpTracker', `gscsync:${site.gscSiteUrl}`),
          title: `Search Console update failed for ${site.profile.name || site.profile.domain}`,
          body: `${r.error} Open SERP Tracker, Keywords, and press Update. If it keeps failing, reconnect Search Console.`, context: '/serp-tracker',
        });
        continue;
      }
      out.synced += 1;
      out.alerts += await history.captureDrops({ pool, userId: site.userId, siteUrl: site.gscSiteUrl, label: site.profile.name || site.profile.domain, capture, makeFingerprint });
    } catch (err) {
      out.failed += 1;
      log(`gsc update for site ${site.id} could not be done: ${err && err.message}`);
    }
  }
  return out;
}

let task = null;
let purgeTask = null;
let gscTask = null;

/** Daily 21:00 UTC = 7:00 am Brisbane: bring each site's Search Console history up to date (and raise an alert for a keyword that slipped). */
function startGscDailySync() {
  if (gscTask) return;
  gscTask = cron.schedule('0 21 * * *', async () => {
    try {
      const r = await withCronLock('serp-tracker-gsc-daily', async () => {
        const base = realDeps();
        const gsc = require('../services/gscService');
        return syncAllGsc({
          pool: base.pool, loadAllSites: base.loadAllSites, mayUse: base.mayUse, connection: gsc.connection, queryRows: gsc.queryRows,
          history: require('../services/gscHistory'), capture: require('../services/SuggestionService').capture,
          makeFingerprint: require('../services/SuggestionService').makeFingerprint, log: base.log,
        });
      });
      if (r) console.log(`[serp-tracker] Search Console update: ${r.synced} of ${r.sites} sites, ${r.failed} failed, ${r.skipped} skipped, ${r.alerts} alerts`);
    } catch (err) { console.warn('[serp-tracker] Search Console update failed:', err.message); }
  }, { timezone: 'UTC' });
  console.log('[serp-tracker] Search Console daily update scheduled at 21:00 UTC (7:00 am Brisbane)');
}

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
  return { pool, loadAllSites, runSite, mayUse, log, modules: [require('../services/serpTracker/rankCollect').rankingsModule], deps: { getBalance, hasCredentials, logCost, capture, makeFingerprint, log } };
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

/** Daily 03:40: empty the raw DataForSEO answers kept over 90 days (the parsed lookups stay). Sends nothing, so it runs everywhere. */
function startSerpTrackerPurge() {
  if (purgeTask) return;
  purgeTask = cron.schedule('40 3 * * *', () => {
    require('../services/serpTracker/lookups').purgeRaw(require('../db').pool).then((n) => {
      if (n) console.log(`[serp-tracker] cleared ${n} raw answers older than 90 days`);
    }).catch((err) => console.warn('[serp-tracker] purge failed:', err.message));
  });
  console.log('[serp-tracker] 90-day raw answer clean-up scheduled daily at 03:40');
}

module.exports = { runAllSites, syncAllGsc, realDeps, startSerpTrackerCron, startSerpTrackerPurge, startGscDailySync };
