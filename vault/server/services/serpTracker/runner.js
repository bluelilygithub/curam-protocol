'use strict';

// SERP Tracker: one run for one site. A run = open a row, check the DataForSEO balance, run each module on its own, close the row.
// A failure is always recorded as a failure (status 'failed' + the error text), never as missing data, and one module failing never
// stops the next. Later stages add modules by passing them in `modules` ({ name, run(ctx) }); nothing here needs to change for them.
// Everything the run touches is passed in, so tests need no database and no network. See docs/serp-tracker.md.

const { localDate, isLocalMonday } = require('./siteProfile');

const STALE_RUN_MS = 2 * 60 * 60 * 1000; // a 'running' row older than this belongs to a run that died (restart, crash)

class RunAlreadyActive extends Error {
  constructor() { super('A run for this site is already in progress.'); this.name = 'RunAlreadyActive'; this.status = 409; }
}

/**
 * @param args.pool
 * @param args.site        { id, userId, profile }
 * @param args.trigger     'cron' | 'manual'
 * @param args.deps        { getBalance, hasCredentials, logCost, capture, makeFingerprint, now, log }
 * @param args.modules     [{ name, run({ pool, site, runId, runDate, isWeekly, logCost }) -> detail string|undefined }]
 * @returns {{ runId, status, balanceUsd, totalCostUsd, steps, errors }}
 */
async function runSite({ pool, site, trigger = 'cron', deps, modules = [] }) {
  const now = deps.now ? deps.now() : new Date();
  const tz = site.profile.timezone;
  const runDate = localDate(now, tz);
  const isWeekly = isLocalMonday(now, tz);

  // one run per site at a time; a dead one is closed as failed so it cannot block the site forever
  await pool.query(
    `UPDATE serp_runs SET status = 'failed', "finishedAt" = NOW(),
            "errorsJson" = "errorsJson" || '["The run did not finish (the server probably restarted)."]'::jsonb
      WHERE "siteId" = $1 AND status = 'running' AND "startedAt" < $2`,
    [site.id, new Date(now.getTime() - STALE_RUN_MS)],
  );
  const active = await pool.query(`SELECT 1 FROM serp_runs WHERE "siteId" = $1 AND status = 'running' LIMIT 1`, [site.id]);
  if (active.rows.length) throw new RunAlreadyActive();

  const ins = await pool.query(
    'INSERT INTO serp_runs ("userId", "siteId", "runDate", trigger) VALUES ($1,$2,$3,$4) RETURNING id',
    [site.userId, site.id, runDate, trigger],
  );
  const runId = ins.rows[0].id;
  const steps = [];
  const errors = [];
  let balanceUsd = null;

  const step = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, status: 'ok', detail: detail || '', ms: Date.now() - t0 });
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 400); // error text never carries a header or key (see dataforseo.js)
      steps.push({ name, status: 'failed', detail: msg, ms: Date.now() - t0 });
      errors.push(`${name}: ${msg}`);
      if (deps.log) deps.log(`run ${runId} step "${name}" failed: ${msg}`);
    }
  };

  const logCost = (entry) => deps.logCost(pool, { userId: site.userId, siteId: site.id, runId, costDate: runDate, ...entry });

  await step('Account balance', async () => {
    const res = await deps.getBalance();
    balanceUsd = res.balanceUsd;
    await logCost({ endpoint: '/v3/appendix/user_data', costUsd: res.costUsd });
    return `US$${res.balanceUsd.toFixed(2)} left`;
  });

  for (const mod of modules) {
    await step(mod.name, () => mod.run({ pool, site, runId, runDate, isWeekly, logCost }));
  }

  const status = errors.length ? 'failed' : 'ok';
  const sum = await pool.query('SELECT COALESCE(SUM("costUsd"), 0) AS total FROM serp_api_costs WHERE "runId" = $1', [runId]);
  const totalCostUsd = Number(sum.rows[0].total);
  await pool.query(
    `UPDATE serp_runs SET status = $2, "finishedAt" = NOW(), "balanceUsd" = $3, "totalCostUsd" = $4, "stepsJson" = $5::jsonb, "errorsJson" = $6::jsonb WHERE id = $1`,
    [runId, status, balanceUsd, totalCostUsd, JSON.stringify(steps), JSON.stringify(errors)],
  );

  if (status === 'failed' && deps.capture) {
    try {
      await deps.capture({
        userId: site.userId, source: 'serpTracker', category: 'alert',
        fingerprint: deps.makeFingerprint('serpTracker', `site:${site.id}:run-failed`), // no date: a site that keeps failing is one inbox item
        title: 'The SERP Tracker daily run had a failure',
        body: `The run for ${site.profile.domain} on ${runDate} had ${errors.length} failed step(s): ${errors.join(' | ').slice(0, 600)}. Nothing was lost as "not ranked": the failed step simply collected nothing. Open SERP Tracker to see the run.`,
        context: `serp run ${runId}`,
      });
    } catch (err) { if (deps.log) deps.log(`alert for run ${runId} not raised: ${err && err.message}`); }
  }
  return { runId, status, balanceUsd, totalCostUsd, steps, errors };
}

module.exports = { runSite, RunAlreadyActive, STALE_RUN_MS };
