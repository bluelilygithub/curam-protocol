'use strict';

// DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/services/gscHistory.test.js
// Real database, fake Search Console. Covers the pure helpers, paging, resume after a failure, a second sync at the same time, the keyword
// maths (impression-weighted position, the earlier period, striking distance, search text with % and _), the per-person filter, and the alert.
const assert = require('assert');
const h = require('./gscHistory');
const { syncAllGsc } = require('../cron/serpTrackerCron');

(async () => {
  // ---- pure helpers
  assert.strictEqual(h.pickProperty('www.Example.com.au', [{ siteUrl: 'https://example.com.au/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:example.com.au', permissionLevel: 'siteOwner' }]), 'sc-domain:example.com.au', 'the domain property wins');
  assert.strictEqual(h.pickProperty('example.com.au', [{ siteUrl: 'https://www.example.com.au/', permissionLevel: 'siteFullUser' }]), 'https://www.example.com.au/');
  assert.strictEqual(h.pickProperty('example.com.au', [{ siteUrl: 'sc-domain:example.com.au', permissionLevel: 'siteUnverifiedUser' }]), null, 'an unverified property is not usable');
  assert.strictEqual(h.pickProperty('example.com.au', []), null);
  assert.strictEqual(h.pickProperty('', [{ siteUrl: 'sc-domain:x', permissionLevel: 'siteOwner' }]), null);

  const w = h.planWindows('2025-01-01', '2025-03-15');
  assert.deepStrictEqual(w[0], { start: '2025-02-13', end: '2025-03-15' }, 'newest window first, 31 days');
  assert.strictEqual(w[w.length - 1].start, '2025-01-01', 'the oldest window starts at the earliest day');
  for (let i = 1; i < w.length; i++) assert.strictEqual(h.addDays(w[i].end, 1), w[i - 1].start, 'windows touch with no gap and no overlap');
  assert.deepStrictEqual(h.planWindows('2025-01-05', '2025-01-05'), [{ start: '2025-01-05', end: '2025-01-05' }]);
  assert.deepStrictEqual(h.planWindows('2025-02-01', '2025-01-01'), []);
  assert.strictEqual(h.earliestDay('2026-11-07'), '2025-07-07', '16 months back');
  assert.strictEqual(h.lastDay('2026-11-07'), '2026-11-04', 'three days of delay');

  if (!process.env.DATABASE_URL) { console.log('gscHistory.test.js: pure checks passed; SKIPPED the database checks (DATABASE_URL is not set)'); return; }
  const { pool } = require('../db');
  const tag = `gsch${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  const SITE = 'sc-domain:example.test';
  const TODAY = '2026-11-07';
  try {
    await require('../db').initDb?.().catch(() => {});
    // a fake Search Console: row for every day in the window for the given queries, 30 impressions a day
    const dayList = (a, b) => { const out = []; for (let d = a; d <= b; d = h.addDays(d, 1)) out.push(d); return out; };
    const makeFetch = (queries, calls = []) => async ({ startDate, endDate, startRow, rowLimit }) => {
      calls.push({ startDate, endDate, startRow, rowLimit });
      return dayList(startDate, endDate).flatMap((d) => queries.map(([q, pos, imp, clk]) => ({ keys: [d, q], clicks: clk, impressions: imp, position: typeof pos === 'function' ? pos(d) : pos })));
    };

    // ---- first sync: newest window first, then back to the earliest day; progress saved
    const calls = [];
    let r = await h.syncSite({ pool, userId: A, siteUrl: SITE, fetchRows: makeFetch([['wine cabinets', 3, 30, 2]], calls), today: TODAY });
    assert.deepStrictEqual([r.started, r.ok], [true, true]);
    assert.strictEqual(calls[0].endDate, '2026-11-04', 'the newest window ends three days ago');
    assert.strictEqual(calls[calls.length - 1].startDate, '2025-07-07', 'the oldest window reaches 16 months back');
    assert.ok(calls.every((c) => c.startRow === 0 && c.rowLimit === 25000), 'one page per window when the page is not full');
    let prog = await h.syncProgress(pool, A, SITE, TODAY);
    assert.strictEqual(prog.status, 'ok');
    assert.strictEqual(prog.percent, 100);
    assert.strictEqual(prog.from, '2025-07-07');
    assert.strictEqual(prog.to, '2026-11-04');
    const n1 = Number((await pool.query('SELECT COUNT(*) AS n FROM gsc_daily WHERE "userId"=$1', [A])).rows[0].n);
    assert.strictEqual(n1, dayList('2025-07-07', '2026-11-04').length, 'one row per day');

    // ---- run it again: nothing doubles (idempotent), and only the recent window plus nothing old is asked for
    const calls2 = [];
    await h.syncSite({ pool, userId: A, siteUrl: SITE, fetchRows: makeFetch([['wine cabinets', 3, 30, 2]], calls2), today: TODAY });
    assert.strictEqual(calls2.length, 1, 'a finished history only re-pulls the recent days');
    assert.strictEqual(calls2[0].startDate, h.addDays('2026-11-04', -h.RESYNC_DAYS));
    assert.strictEqual(Number((await pool.query('SELECT COUNT(*) AS n FROM gsc_daily WHERE "userId"=$1', [A])).rows[0].n), n1, 'a repeat adds no rows');

    // ---- a cut-off backfill carries on where it stopped
    const SITE2 = 'sc-domain:resume.test';
    let n = 0;
    const flaky = async (args) => { n += 1; if (n === 3) throw new Error('Google said no (test)'); return makeFetch([['q', 5, 10, 1]])(args); };
    r = await h.syncSite({ pool, userId: A, siteUrl: SITE2, fetchRows: flaky, today: TODAY });
    assert.strictEqual(r.ok, false);
    prog = await h.syncProgress(pool, A, SITE2, TODAY);
    assert.strictEqual(prog.status, 'failed');
    assert.match(prog.lastError, /Google said no/);
    assert.ok(prog.percent > 0 && prog.percent < 100, `partial progress is kept (${prog.percent}%)`);
    const doneTo = prog.from;
    const calls3 = [];
    r = await h.syncSite({ pool, userId: A, siteUrl: SITE2, fetchRows: makeFetch([['q', 5, 10, 1]], calls3), today: TODAY });
    assert.strictEqual(r.ok, true);
    assert.ok(calls3.every((c) => c.endDate < doneTo || c.startDate >= h.addDays('2026-11-04', -h.RESYNC_DAYS)), 'the resume does not redo the months already loaded');
    assert.strictEqual((await h.syncProgress(pool, A, SITE2, TODAY)).percent, 100);

    // ---- a full page asks for the next page
    const SITE3 = 'sc-domain:paging.test';
    const pageCalls = [];
    const big = async ({ startDate, endDate, startRow, rowLimit }) => {
      pageCalls.push(startRow);
      if (endDate !== '2026-11-04') return [];
      return startRow === 0 ? Array.from({ length: rowLimit }, (_, i) => ({ keys: ['2026-11-01', `kw ${i}`], clicks: 1, impressions: 2, position: 4 })) : [{ keys: ['2026-11-01', 'last one'], clicks: 1, impressions: 2, position: 4 }];
    };
    await h.syncSite({ pool, userId: A, siteUrl: SITE3, fetchRows: big, today: TODAY });
    assert.deepStrictEqual(pageCalls.slice(0, 2), [0, 25000], 'a full page of 25,000 rows asks for the next page');
    assert.strictEqual(Number((await pool.query('SELECT COUNT(*) AS n FROM gsc_daily WHERE "userId"=$1 AND "siteUrl"=$2', [A, SITE3])).rows[0].n), 25001);

    // ---- two syncs at once: the second is refused
    const SITE4 = 'sc-domain:twice.test';
    let release; const gate = new Promise((res) => { release = res; });
    const slow = async () => { await gate; return []; };
    const first = h.syncSite({ pool, userId: A, siteUrl: SITE4, fetchRows: slow, today: TODAY });
    await new Promise((res) => setTimeout(res, 100));
    assert.deepStrictEqual(await h.syncSite({ pool, userId: A, siteUrl: SITE4, fetchRows: slow, today: TODAY }), { started: false });
    assert.strictEqual((await h.syncProgress(pool, A, SITE4, TODAY)).status, 'running');
    release();
    assert.strictEqual((await first).ok, true);

    // ---- keyword maths on a known set: "up" improves from 10 to 4, "down" slips from 3 to 12, a rare one, a 50% word
    const SITE5 = 'sc-domain:maths.test';
    const dmax = '2026-11-04';
    const rows = [];
    for (let i = 0; i < 28; i++) { // the current 28 days
      const d = h.addDays(dmax, -i);
      rows.push({ keys: [d, 'up'], clicks: 3, impressions: 100, position: 4 });
      rows.push({ keys: [d, 'down'], clicks: 1, impressions: 100, position: 12 });
      rows.push({ keys: [d, '100% real_deal'], clicks: 0, impressions: 1, position: 15 });
    }
    for (let i = 28; i < 56; i++) { // the 28 days before
      const d = h.addDays(dmax, -i);
      rows.push({ keys: [d, 'up'], clicks: 1, impressions: 100, position: 10 });
      rows.push({ keys: [d, 'down'], clicks: 5, impressions: 100, position: 3 });
    }
    // two days of "mix" with different impressions: weighted position = (2*1 + 8*9) / 10 = 7.4
    rows.push({ keys: [dmax, 'mix'], clicks: 0, impressions: 2, position: 1 });
    rows.push({ keys: [h.addDays(dmax, -1), 'mix'], clicks: 0, impressions: 8, position: 9 });
    await h.syncSite({ pool, userId: A, siteUrl: SITE5, fetchRows: async ({ startDate, endDate }) => rows.filter((r) => r.keys[0] >= startDate && r.keys[0] <= endDate), today: TODAY });
    const all = await h.listKeywords(pool, A, SITE5, { days: 28 });
    const by = Object.fromEntries(all.keywords.map((k) => [k.query, k]));
    assert.strictEqual(by.up.clicks, 84);
    assert.strictEqual(by.up.impressions, 2800);
    assert.strictEqual(by.up.position, 4);
    assert.strictEqual(by.up.prevPosition, 10);
    assert.strictEqual(by.up.change, 6, 'positive change = moved up');
    assert.strictEqual(by.down.change, -9);
    assert.ok(Math.abs(by.mix.position - 7.4) < 0.001, `position is weighted by impressions (${by.mix.position})`);
    assert.strictEqual(by.mix.prevPosition, null, 'no earlier figure is null, not zero');
    assert.deepStrictEqual(all.keywords.map((k) => k.query).slice(0, 2), ['up', 'down'], 'default order is clicks, most first');
    const bypos = await h.listKeywords(pool, A, SITE5, { days: 28, sort: 'position' });
    assert.strictEqual(bypos.keywords[0].query, 'mix' === bypos.keywords[0].query ? 'mix' : 'up', 'position sorts best (smallest) first');
    assert.ok(bypos.keywords[0].position <= bypos.keywords[1].position);
    const strike = await h.listKeywords(pool, A, SITE5, { days: 28, striking: true });
    assert.deepStrictEqual(strike.keywords.map((k) => k.query), ['down', '100% real_deal'], 'striking distance: positions 8 to 20 with at least 10 impressions ("up" is 4, "mix" is 7.4)');
    const strike2 = await h.listKeywords(pool, A, SITE5, { days: 28, striking: true, minImpressions: 50 });
    assert.deepStrictEqual(strike2.keywords.map((k) => k.query), ['down'], 'the impressions floor is applied (the 28-impression keyword drops out)');
    assert.deepStrictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, q: '100%' })).keywords.map((k) => k.query), ['100% real_deal'], '% in the search text is not a wildcard');
    assert.deepStrictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, q: 'real_' })).keywords.length, 1);
    assert.strictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, q: 'REAL' })).keywords.length, 1, 'search is not case sensitive');
    assert.strictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, q: 'u_' })).keywords.length, 0, '_ is not a wildcard either');
    assert.strictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, limit: 1 })).keywords.length, 1);
    assert.strictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, limit: 1 })).total, 4, 'total counts all matches, not just the page');
    assert.ok((await h.listKeywords(pool, A, SITE5, { days: 'all' })).keywords.length >= 4);
    assert.strictEqual((await h.listKeywords(pool, A, SITE5, { days: 28, sort: 'nonsense; DROP TABLE gsc_daily' })).keywords.length, 4, 'an unknown sort falls back, nothing is injected');

    // ---- history: oldest first, only that keyword
    const hist = await h.keywordHistory(pool, A, SITE5, 'mix', { days: 'all' });
    assert.deepStrictEqual(hist.map((d) => d.day), [h.addDays(dmax, -1), dmax]);
    assert.strictEqual((await h.keywordHistory(pool, A, SITE5, 'up', { days: 7 })).length, 7);

    // ---- another person sees none of it
    assert.strictEqual((await h.listKeywords(pool, B, SITE5, { days: 28 })).keywords.length, 0);
    assert.strictEqual((await h.keywordHistory(pool, B, SITE5, 'up', { days: 'all' })).length, 0);
    assert.strictEqual(await h.syncProgress(pool, B, SITE5, TODAY), null);
    assert.strictEqual((await h.findDrops(pool, B, SITE5)).length, 0);

    // ---- drops: "down" went from 3 to 12 on 100 impressions a day, "up" improved, "mix" has too few earlier impressions
    const SITE6 = 'sc-domain:drops.test';
    const dr = [];
    for (let i = 0; i < 7; i++) dr.push({ keys: [h.addDays(dmax, -i), 'slipper'], clicks: 1, impressions: 20, position: 11 }, { keys: [h.addDays(dmax, -i), 'climber'], clicks: 1, impressions: 20, position: 2 });
    for (let i = 7; i < 35; i++) dr.push({ keys: [h.addDays(dmax, -i), 'slipper'], clicks: 3, impressions: 20, position: 3 }, { keys: [h.addDays(dmax, -i), 'climber'], clicks: 3, impressions: 20, position: 9 }, { keys: [h.addDays(dmax, -i), 'tiny'], clicks: 0, impressions: 1, position: 2 });
    for (let i = 0; i < 7; i++) dr.push({ keys: [h.addDays(dmax, -i), 'tiny'], clicks: 0, impressions: 1, position: 30 });
    await h.syncSite({ pool, userId: A, siteUrl: SITE6, fetchRows: async ({ startDate, endDate }) => dr.filter((r) => r.keys[0] >= startDate && r.keys[0] <= endDate), today: TODAY });
    const drops = await h.findDrops(pool, A, SITE6);
    assert.deepStrictEqual(drops.map((d) => d.query), ['slipper'], 'only the keyword that really slipped, with enough impressions');
    const captured = [];
    const fp = (s, k) => `${s}:${k}`;
    assert.strictEqual(await h.captureDrops({ pool, userId: A, siteUrl: SITE6, label: 'Example', capture: async (c) => captured.push(c), makeFingerprint: fp, today: TODAY }), 1);
    assert.strictEqual(captured[0].userId, A);
    assert.match(captured[0].title, /slipper/);
    await h.captureDrops({ pool, userId: A, siteUrl: SITE6, label: 'Example', capture: async (c) => captured.push(c), makeFingerprint: fp, today: TODAY });
    assert.strictEqual(captured[0].fingerprint, captured[1].fingerprint, 'the same week gives the same fingerprint, so the inbox does not repeat it');

    // ---- the daily job: skips people without the tool / without a connection, carries on after a failure, loads one property once
    const log = [];
    const fakeHistory = {
      syncSite: async ({ siteUrl }) => { log.push(siteUrl); if (siteUrl === 'bad') return { started: true, ok: false, error: 'boom' }; return { started: true, ok: true, rows: 1 }; },
      captureDrops: async () => 2,
    };
    const alerts = [];
    const out = await syncAllGsc({
      pool: null,
      loadAllSites: async () => [
        { id: 1, userId: 1, profile: { domain: 'a.com' }, gscSiteUrl: 'ok' },
        { id: 2, userId: 1, profile: { domain: 'a2.com' }, gscSiteUrl: 'ok' },
        { id: 3, userId: 1, profile: { domain: 'b.com' }, gscSiteUrl: 'bad' },
        { id: 4, userId: 2, profile: { domain: 'c.com' }, gscSiteUrl: 'nope' },
        { id: 5, userId: 3, profile: { domain: 'd.com' }, gscSiteUrl: 'unconnected' },
        { id: 6, userId: 1, profile: { domain: 'e.com' }, gscSiteUrl: null },
      ],
      mayUse: async (uid) => uid !== 2, connection: async (uid) => ({ connected: uid !== 3 }), queryRows: async () => [],
      history: fakeHistory, capture: async (c) => alerts.push(c), makeFingerprint: fp,
    });
    assert.deepStrictEqual(log, ['ok', 'bad'], 'one load per property; people without the tool or a connection are skipped');
    assert.deepStrictEqual(out, { sites: 5, synced: 1, failed: 1, skipped: 2, alerts: 2 });
    assert.strictEqual(alerts.length, 1, 'a failed update raises one inbox alert');
    assert.match(alerts[0].body, /boom/);

    console.log('gscHistory.test.js: all passed');
  } finally {
    for (let i = 0; i < 3; i++) { try { await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]]); break; } catch (e) { await new Promise((r) => setTimeout(r, 200)); } }
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
