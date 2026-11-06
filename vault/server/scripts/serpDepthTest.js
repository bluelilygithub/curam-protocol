'use strict';

// SERP Tracker stage 2: ONE paid search through DataForSEO's Standard Queue, to see what a result depth really costs before the full
// keyword list is switched on. Prints the cost DataForSEO reports, logs it in serp_api_costs like any other call, and saves the raw answer
// as a fixture for the stage 3 parser and its tests. It posts exactly one task and never re-posts: if the answer is not ready in time it
// prints the task ID so it can be collected later (reading a task is free).
//
//   node server/scripts/serpDepthTest.js "walk in wine cabinets" --depth 100 --go
//   node server/scripts/serpDepthTest.js "walk in wine cabinets" --depth 10 --device mobile --go
//   node server/scripts/serpDepthTest.js --collect <taskId>           (read an earlier task; costs nothing)
//
// Without --go it only prints what it WOULD send. Options: --depth N (10-100, default 100), --device desktop|mobile (default desktop), --no-ai
// (leave out the AI Overview request, which may add a small charge), --wait-minutes N (default 15).
// Uses the first saved SERP Tracker site for its place, language and domain.

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');
const { getBalance, postSerpTask, waitForSerpTask, getSerpTask, hasCredentials } = require('../services/serpTracker/dataforseo');
const { logCost } = require('../services/serpTracker/costs');
const { localDate, hostBelongsTo } = require('../services/serpTracker/siteProfile');

const FIXTURE_DIR = path.join(__dirname, '..', 'services', 'serpTracker', 'fixtures');

function parseArgs(argv) {
  const out = { keyword: null, depth: 100, device: 'desktop', go: false, ai: true, waitMinutes: 15, collect: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--go') out.go = true;
    else if (a === '--no-ai') out.ai = false;
    else if (a === '--depth') out.depth = Number(argv[++i]);
    else if (a === '--device') out.device = argv[++i];
    else if (a === '--wait-minutes') out.waitMinutes = Number(argv[++i]);
    else if (a === '--collect') out.collect = argv[++i];
    else if (!a.startsWith('--') && !out.keyword) out.keyword = a;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!Number.isInteger(out.depth) || out.depth < 10 || out.depth > 100 || out.depth % 10) throw new Error('--depth must be 10 to 100 in steps of 10');
  if (!['desktop', 'mobile'].includes(out.device)) throw new Error('--device must be desktop or mobile');
  if (!out.collect && !out.keyword) throw new Error('Give the keyword in quotes, or --collect <taskId>');
  return out;
}

/** What the answer says, in a few plain lines (the full detail is in the saved fixture). */
function summarise(result, domain) {
  const items = (result && result.items) || [];
  const types = {};
  for (const it of items) types[it.type] = (types[it.type] || 0) + 1;
  const organic = items.filter((i) => i.type === 'organic');
  const mine = organic.filter((i) => i.domain && hostBelongsTo(i.domain, domain));
  return {
    itemsReturned: items.length,
    organicResults: organic.length,
    itemTypes: types,
    myBestOrganicPosition: mine.length ? Math.min(...mine.map((i) => i.rank_group)) : null,
    myUrlsSeen: mine.map((i) => i.url),
    aiOverviewPresent: items.some((i) => i.type === 'ai_overview'),
    topFiveDomains: organic.slice(0, 5).map((i) => `${i.rank_group}. ${i.domain}`),
  };
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!hasCredentials()) throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set.');

  const siteRow = (await pool.query('SELECT id, "userId", "profileJson" FROM serp_sites ORDER BY id LIMIT 1')).rows[0];
  if (!siteRow) throw new Error('No SERP Tracker site is saved yet. Save one on the page first.');
  const profile = typeof siteRow.profileJson === 'string' ? JSON.parse(siteRow.profileJson) : siteRow.profileJson;
  const costDate = localDate(new Date(), profile.timezone);

  if (args.collect) {
    const r = await getSerpTask(args.collect);
    console.log(r.ready ? 'Ready.' : 'Not ready yet.');
    if (r.ready) console.log(JSON.stringify(summarise(r.result, profile.domain), null, 2));
    return;
  }

  const task = { keyword: args.keyword, locationName: profile.locationName, languageCode: profile.languageCode, device: args.device, depth: args.depth, loadAiOverview: args.ai, tag: 'serp-depth-test' };
  console.log('Search to post:', JSON.stringify(task));
  const before = await getBalance();
  console.log(`Balance before: US$${before.balanceUsd.toFixed(4)}`);
  if (!args.go) { console.log('Dry run: nothing was sent. Add --go to post it.'); return; }
  if (before.balanceUsd < 0.1) throw new Error('Balance is under US$0.10: not posting.');

  const posted = await postSerpTask(task);
  await logCost(pool, { userId: siteRow.userId, siteId: siteRow.id, costDate, endpoint: `/v3/serp/google/organic/task_post depth=${args.depth} ${args.device}`, costUsd: posted.costUsd });
  console.log(`Posted. Task ID ${posted.taskId}. Cost reported by DataForSEO: US$${posted.costUsd}`);

  console.log(`Waiting up to ${args.waitMinutes} minutes (checking every 10 s; reading is free)...`);
  const got = await waitForSerpTask(posted.taskId, { intervalMs: 10000, maxMs: args.waitMinutes * 60000 });
  if (!got.ready) {
    console.log(`Not ready in time. Nothing is lost and nothing is charged again: collect it later with\n  node server/scripts/serpDepthTest.js --collect ${posted.taskId}`);
    return;
  }

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const slug = args.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = path.join(FIXTURE_DIR, `serp-${slug}-d${args.depth}-${args.device}.json`);
  fs.writeFileSync(file, JSON.stringify(got.raw, null, 1));
  console.log(`Raw answer saved: ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  console.log(JSON.stringify(summarise(got.result, profile.domain), null, 2));

  const after = await getBalance();
  console.log(`Balance after: US$${after.balanceUsd.toFixed(4)} (used US$${(before.balanceUsd - after.balanceUsd).toFixed(4)})`);
})()
  .catch((err) => { console.error(`FAILED: ${err.message}`); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}).then(() => setTimeout(() => process.exit(process.exitCode || 0), 100)));
