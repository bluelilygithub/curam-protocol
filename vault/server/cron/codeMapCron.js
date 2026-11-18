'use strict';

// Code Map weekly run: Sunday 03:17 Australia/Brisbane. Runs the analysis as the first admin (the same job as the Run analysis button),
// so the Changes tab always has a recent run to compare with, and new high findings reach the inbox through the job itself.
// It reads Vault's own files and calls nothing outside Vault, so (like the recycle bin tidy) it runs on every server. withCronLock stops two
// servers running it during a rolling deploy; the lock is held until the run has finished. If someone is already running an analysis, the
// weekly one is skipped. See docs/code-map.md.

const cron = require('node-cron');
const { withCronLock } = require('../utils/cronLock');
const { getLogger } = require('../middleware/requestContext');

const SCHEDULE = '17 3 * * 0';
const TIMEZONE = 'Australia/Brisbane';

let task = null;

/** One weekly run. Injectable for tests. Returns { skipped } or { runId, status }. */
async function runWeeklyCodeMap({ pool = require('../db').pool, jobs = require('../services/codeMap/jobs') } = {}) {
  const { rows } = await pool.query('SELECT id FROM users WHERE "isAdmin" = TRUE ORDER BY id ASC LIMIT 1');
  if (!rows[0]) return { skipped: 'no admin' };
  let runId;
  try {
    runId = await jobs.start(rows[0].id);
  } catch (err) {
    if (err.status === 409) return { skipped: 'a run is already going' };
    throw err;
  }
  await jobs.whenDone(runId);
  const run = await jobs.get(runId);
  return { runId, status: run ? run.status : 'gone' };
}

function startCodeMapCron() {
  if (task) return;
  const log = getLogger();
  task = cron.schedule(SCHEDULE, () => {
    withCronLock('codeMap', () => runWeeklyCodeMap()).then((r) => {
      if (r) getLogger().info({ result: r }, '[codeMap] weekly run');
    }).catch((err) => getLogger().error({ err }, '[codeMap] weekly run failed'));
  }, { timezone: TIMEZONE });
  log.info('[codeMap] weekly run scheduled for Sunday 03:17 Australia/Brisbane');
}

module.exports = { startCodeMapCron, runWeeklyCodeMap, SCHEDULE, TIMEZONE };
