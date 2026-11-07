'use strict';

// SERP Tracker: daily tracking (the "Rankings" module of a run). For every keyword x device of a site that has Daily tracking switched on, ask
// DataForSEO's STANDARD QUEUE (task_post, then a free task_get) where the site is, and keep one row a day in serp_rankings.
//
// Three ideas from OpenSEO (open-seo, MIT, read 7 Nov 2026), written for this app (see reads.js):
//   - the standard queue: about 30% of the Live price, and it gives real website addresses (Live gave Google redirect links);
//   - a read that finds the site is trusted, a read that MISSES it is read again (up to MAX_TRACK_READS in all), and "not found" is only recorded when
//     every readable read missed; the best position wins;
//   - the cost is estimated before the job is switched on, and the monthly cap is checked before every round of posts.
//
// A failure is a failure, never "not ranked": a search that could not be posted, finished or read is saved with status 'failed' and its reason, and the
// step then fails so the run, the page and the Suggestions inbox all say so. Rows that did work are kept either way.
// Everything it needs is passed in `deps`, so tests need no network. See docs/serp-tracker.md.

const { parseSerp, SerpParseError } = require('./serpParse');
const { readRecord, betterRead, needsAnotherRead } = require('./reads');
const { capStatus, estimateTrackingUsd, TRACK_DEPTH_CAP, MAX_TRACK_READS } = require('./costs');

const POLL_MS = 10 * 1000;
const ROUND_WAIT_MS = 20 * 60 * 1000; // DataForSEO answers a queued task in about 5 minutes on average; one round waits up to this long
const TOTAL_BUDGET_MS = 75 * 60 * 1000; // no new round starts after this (a run that is still "running" after 2 hours is closed as dead)
const POST_CONCURRENCY = 5;

function realDeps() {
  const dfs = require('./dataforseo');
  return { postTask: dfs.postSerpTask, waitTask: dfs.waitForSerpTask, hasCredentials: dfs.hasCredentials, now: () => Date.now() };
}

/** Run `fn` over `items` with at most `limit` at once. */
async function withLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const fmtUsd = (n) => `US$${Number(n).toFixed(4)}`;

/**
 * @param ctx   { pool, site: { id, userId, profile }, runId, runDate, logCost(entry) }
 * @param opts  { env, deps }
 * @returns {string} the detail line for the run's step; THROWS (after saving what it has) when anything failed or the monthly limit stopped it
 */
async function collectRankings(ctx, { env = process.env, deps = realDeps() } = {}) {
  const { site, runDate, logCost } = ctx;
  const profile = site.profile;
  if (!profile.dailyTracking) return 'Daily tracking is off for this site. Turn it on in Site setup.';
  const keywords = profile.keywords || [];
  const devices = profile.devices || [];
  if (!keywords.length) return 'No keywords to track. Add some in Site setup.';
  if (!deps.hasCredentials(env)) throw new Error('DataForSEO is not set up on this server, so nothing was collected.');

  const depth = Math.min(profile.serpDepth || TRACK_DEPTH_CAP, TRACK_DEPTH_CAP);
  const perTask = estimateTrackingUsd({ keywords: 1, devices: 1, depth });
  const competitors = (profile.competitors || []).map((c) => c.domain);
  const units = [];
  for (const k of keywords) for (const device of devices) units.push({ keyword: k.term, device, reads: [], attempts: 0, errors: [], cost: 0, best: null, skippedForCap: false });

  const started = deps.now();
  let capHit = false;
  let totalPosts = 0;

  for (let round = 1; round <= MAX_TRACK_READS; round++) {
    const want = units.filter((u) => u.attempts < MAX_TRACK_READS && (round === 1 ? true : needsAnotherRead({ hasSite: true, reads: u.reads, maxReads: MAX_TRACK_READS })));
    if (!want.length) break;
    if (round > 1 && deps.now() - started > TOTAL_BUDGET_MS) break;

    // the monthly limit is checked before every round: only as many searches as fit are posted, the rest are left for the owner to see
    const cap = await capStatus(ctx.pool, runDate, env);
    const room = Math.max(0, Math.floor((cap.cap - cap.spent) / perTask));
    const posting = want.slice(0, room);
    if (posting.length < want.length) { capHit = true; for (const u of want.slice(room)) u.skippedForCap = true; }
    if (!posting.length) break;

    // post (charged), logging each cost BEFORE anything is read from the answer, because DataForSEO charges whether or not it can be read
    await withLimit(posting, POST_CONCURRENCY, async (u) => {
      u.taskId = null; // never poll a task from an earlier round
      try {
        const got = await deps.postTask({
          keyword: u.keyword, locationName: profile.locationName, languageCode: profile.languageCode, searchDomain: profile.searchDomain,
          device: u.device, depth, tag: `serp-site-${site.id}`,
        }, { env });
        u.attempts += 1;
        totalPosts += 1;
        u.cost += got.costUsd;
        u.taskId = got.taskId;
        await logCost({ endpoint: `/v3/serp/google/organic/task_post depth=${depth} ${u.device} (read ${u.attempts})`, costUsd: got.costUsd });
      } catch (err) {
        if (err && err.code === 'NO_CREDENTIALS') throw err;
        u.taskId = null;
        u.attempts += 1;
        u.errors.push(String((err && err.message) || err).slice(0, 200));
      }
    });

    // collect (free): every posted task is polled until it is ready, or this round's time is up
    await withLimit(posting.filter((u) => u.taskId), 20, async (u) => {
      try {
        const done = await deps.waitTask(u.taskId, { intervalMs: POLL_MS, maxMs: ROUND_WAIT_MS, env });
        if (!done.ready) { u.errors.push('DataForSEO did not finish this search in time (it was still charged).'); return; }
        const parsed = parseSerp(done.result, { myDomain: profile.domain, competitors, depth });
        u.reads.push(readRecord(parsed));
        if (betterRead(parsed, u.best)) u.best = parsed;
      } catch (err) {
        u.errors.push(err instanceof SerpParseError ? `${err.message}` : `could not read the answer: ${String((err && err.message) || err).slice(0, 160)}`);
      }
    });
  }

  // save: one row per keyword and device for today (a second run today replaces the first)
  let found = 0; let notFound = 0; let failed = 0; let totalReads = 0; let totalCost = 0;
  for (const u of units) {
    totalCost += u.cost;
    totalReads += u.reads.length;
    let status;
    let error = null;
    if (isFoundUnit(u)) { status = 'found'; found += 1; } else if (u.reads.length > 0) { status = 'not_found'; notFound += 1; } else {
      status = 'failed'; failed += 1;
      error = (u.skippedForCap && !u.errors.length ? 'Not searched: the monthly spending limit was reached.' : u.errors.join(' | ') || 'No readable answer.').slice(0, 500);
    }
    const mine = u.best && u.best.mine;
    await ctx.pool.query(
      `INSERT INTO serp_rankings ("userId", "siteId", "runDate", keyword, device, status, position, url, depth, "readsJson", "organicCount", "costUsd", error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
       ON CONFLICT ("siteId", "runDate", keyword, device) DO UPDATE SET status = EXCLUDED.status, position = EXCLUDED.position, url = EXCLUDED.url, depth = EXCLUDED.depth,
         "readsJson" = EXCLUDED."readsJson", "organicCount" = EXCLUDED."organicCount", "costUsd" = EXCLUDED."costUsd", error = EXCLUDED.error, "createdAt" = NOW()`,
      [site.userId, site.id, runDate, u.keyword, u.device, status, status === 'found' ? mine.bestPosition : null, status === 'found' ? mine.bestUrl : null, depth,
        JSON.stringify(u.reads), u.best ? u.best.organicCount : null, u.cost, error],
    );
  }

  const detail = `${units.length} searches (${keywords.length} keywords x ${devices.length} devices, top ${depth}): found ${found}, not found ${notFound}, failed ${failed}. ${totalPosts} reads, ${fmtUsd(totalCost)}.`;
  if (failed > 0 || capHit) {
    const why = capHit ? ' The monthly spending limit stopped some searches, so they were not made.' : '';
    throw new Error(`${detail}${why} Searches that failed are saved as failed, never as "not found".`);
  }
  return detail;
}

const isFoundUnit = (u) => u.reads.some((r) => r.position != null);

/** The module the runner calls (runner.js: { name, run(ctx) }). */
const rankingsModule = { name: 'Rankings', run: (ctx) => collectRankings(ctx) };

module.exports = { collectRankings, rankingsModule, POST_CONCURRENCY, ROUND_WAIT_MS, TOTAL_BUDGET_MS };
