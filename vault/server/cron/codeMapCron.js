'use strict';

// Code Map weekly run: Sunday 03:17 Australia/Brisbane. Runs the analysis as the first admin (the same job as the Run analysis button),
// so the Changes tab always has a recent run to compare with, and new high findings reach the inbox through the job itself.
// Then the Security tab's live site check (services/codeMap/liveCheck.js, same as its button) against APP_URL, so a security header removed
// or a route left open shows up within a week without anyone pressing anything; failing high checks reach the inbox through the check itself.
// The analysis reads Vault's own files; the live check calls only this app's own public address, and is skipped when APP_URL is not set or
// is a local address (a cron has no request to take the address from, and a dev machine would report its own server as down).
// Like the recycle bin tidy it runs on every server; withCronLock stops two servers running it during a rolling deploy, held until both
// parts have finished. If someone is already running an analysis, the weekly analysis is skipped but the live check still runs. Neither
// part's failure stops the other. See docs/code-map.md.
// Between the two, the Models check (services/codeMap/models/check.js): which model each tool uses and how its calls went in the last
// 30 days, with high and medium findings in the inbox. Plain code, no model call. It runs even when the analysis was skipped or failed
// (it reads the latest finished run), and its failure stops neither of the others.

const cron = require('node-cron');
const { withCronLock } = require('../utils/cronLock');
const { getLogger } = require('../middleware/requestContext');

const SCHEDULE = '17 3 * * 0';
const TIMEZONE = 'Australia/Brisbane';
const LOCAL_RX = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(\/|$)/i;

let task = null;

/** The weekly analysis as the admin. Returns { skipped } or { runId, status }. */
async function weeklyAnalysis(adminId, jobs) {
  let runId;
  try {
    runId = await jobs.start(adminId);
  } catch (err) {
    if (err.status === 409) return { skipped: 'a run is already going' };
    throw err;
  }
  await jobs.whenDone(runId);
  const run = await jobs.get(runId);
  return { runId, status: run ? run.status : 'gone' };
}

/** The weekly live site check. Returns { skipped } or { id, counts }. */
async function weeklyLiveCheck(adminId, liveChecks, appUrl) {
  const base = String(appUrl || '').trim().replace(/\/$/, '');
  if (!base) return { skipped: 'APP_URL is not set' };
  if (LOCAL_RX.test(base)) return { skipped: 'APP_URL is a local address' };
  const r = await liveChecks.check(adminId, base);
  return { id: r.id, counts: r.counts };
}

/** One weekly run: the analysis, then the live check. Injectable for tests. Returns { skipped } or { runId?, status?, skipped?, live }. */
async function runWeeklyCodeMap({
  pool = require('../db').pool,
  jobs = require('../services/codeMap/jobs'),
  liveChecks = require('../services/codeMap/liveCheck'),
  modelsCheck = (o) => require('../services/codeMap/models/check').runModelsCheck(o),
  appUrl = process.env.APP_URL,
  log = getLogger(),
} = {}) {
  const { rows } = await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC LIMIT 1');
  if (!rows[0]) return { skipped: 'no admin' };
  const adminId = rows[0].id;
  let analysis;
  let analysisError = null;
  try {
    analysis = await weeklyAnalysis(adminId, jobs);
  } catch (err) {
    analysisError = err;
  }
  let models;
  try {
    const r = await modelsCheck({ userId: adminId });
    models = { id: r.id, counts: r.report.counts };
  } catch (err) {
    log.error({ err }, '[codeMap] weekly models check failed');
    models = { error: String((err && err.message) || 'failed').slice(0, 200) };
  }
  let live;
  try {
    live = await weeklyLiveCheck(adminId, liveChecks, appUrl);
  } catch (err) {
    log.error({ err }, '[codeMap] weekly live check failed');
    live = { error: String((err && err.message) || 'failed').slice(0, 200) };
  }
  if (analysisError) { Object.assign(analysisError, { models, live }); throw analysisError; } // the scheduler logs it; the others have run
  return { ...analysis, models, live };
}

function startCodeMapCron() {
  if (task) return;
  const log = getLogger();
  task = cron.schedule(SCHEDULE, () => {
    withCronLock('codeMap', () => runWeeklyCodeMap()).then((r) => {
      if (r) getLogger().info({ result: r }, '[codeMap] weekly run');
    }).catch((err) => getLogger().error({ err, models: err && err.models, live: err && err.live }, '[codeMap] weekly run failed'));
  }, { timezone: TIMEZONE });
  log.info('[codeMap] weekly run (analysis, models check, then live site check) scheduled for Sunday 03:17 Australia/Brisbane');
}

module.exports = { startCodeMapCron, runWeeklyCodeMap, SCHEDULE, TIMEZONE };
