'use strict';
// DATABASE_URL=... node server/routes/htmlContentCheck.rounds.db.test.js
// Real database, fake sign-in, stand-in fetchers (no live site). Proves, for milestone 2 of HTML Content Check:
//   - creating a job fetches round 0; Check again stores round 1, 2 ...; an unchanged page is still stored as a round;
//   - a failed fetch is stored as a failed round with its reason (never a server error's own text), and the next attempt replaces it;
//   - a job whose first fetch fails is still created; the job's fetch mode picks plain or the real browser;
//   - a saved copy can be uploaded (only .html/.htm, 5 MB at most); the page's own address becomes finalUrl;
//   - the page is kept gzipped in "rawHtml", never sent back, and left out of the recycle-bin copy; restore brings the rounds back;
//   - another member cannot fetch for, or read the rounds of, someone else's job.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP htmlContentCheck.rounds.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const router = require('./htmlContentCheck');

const BEFORE = fs.readFileSync(path.join(__dirname, '../services/htmlContentCheck/fixtures/artist-before.html'), 'utf8');
const AFTER = fs.readFileSync(path.join(__dirname, '../services/htmlContentCheck/fixtures/artist-after.html'), 'utf8');
const pub = (message) => Object.assign(new Error(message), { isPublic: true });

// What the stand-in "internet" answers next; `calls` records which fetcher ran.
const net = { plain: { html: BEFORE, finalUrl: 'https://gallery.example/artists/dorothy-stoner' }, browser: null, calls: [] };
router._setPageDeps({
  plainFetch: async (url) => { net.calls.push(['plain', url]); if (net.plain instanceof Error) throw net.plain; return net.plain; },
  browserFetch: async (url) => { net.calls.push(['browser', url]); if (net.browser instanceof Error) throw net.browser; return net.browser; },
  browserAvailable: () => true,
});

function serve() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']), isAdmin: false }; next(); });
  app.use('/api/html-content-check', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;
  const tag = `hcc-rounds-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  require('../services/recycleBin/adapters');
  const bin = require('../services/recycleBin');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/api/html-content-check`;
  const call = async (user, method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const uploadAs = async (user, jobId, name, text) => {
    const form = new FormData();
    form.append('file', new Blob([text], { type: 'text/html' }), name);
    const res = await fetch(`${base}/jobs/${jobId}/rounds`, { method: 'POST', headers: { 'x-test-user': String(user) }, body: form });
    return { status: res.status, body: await res.json() };
  };

  // a round is one row per page (milestone 4b); these jobs have one page. Snapshots are not sent back: read them from the table.
  const rr = (body) => ({ number: body.round.number, ...body.round.pages[0] });
  const snapOf = async (jobId, n) => (await pool.query('SELECT snapshot FROM content_check_rounds WHERE "jobId" = $1 AND number = $2', [jobId, n])).rows[0].snapshot;

  try {
    // ---- create fetches round 0 ----
    let r = await call(A, 'POST', '/jobs', { url: 'gallery.example/artists/dorothy-stoner', requestText: '- Fix the heading' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const job = r.body;
    assert.deepEqual(net.calls, [['plain', 'https://gallery.example/artists/dorothy-stoner']], 'auto mode: plain fetch first');
    assert.equal(job.rounds.length, 1);
    const r0 = job.rounds[0];
    assert.equal(r0.number, 0); assert.equal(r0.status, 'ready'); assert.equal(r0.fetchedVia, 'plain');
    assert.equal(r0.finalUrl, 'https://gallery.example/artists/dorothy-stoner');
    assert.equal(r0.title, 'Dorothy Stoner | Example Gallery'); assert.ok(r0.words > 50); assert.ok(r0.blocks > 10);

    r = await call(A, 'GET', `/jobs/${job.id}/rounds/0`);
    assert.equal(r.status, 200);
    assert.equal((await snapOf(job.id, 0)).v, 1);
    assert.ok((await snapOf(job.id, 0)).blocks.some((b) => b.text === 'Grace Cossington Smith, Margaret Preston'), 'the sidebar is in the snapshot');
    assert.equal(r.body.pages[0].rawHtml, undefined, 'the stored page is never sent back');
    assert.equal(r.body.pages[0].snapshot, undefined, 'nor the snapshot');
    const raw = (await pool.query('SELECT "rawHtml" FROM content_check_rounds WHERE "jobId" = $1 AND number = 0', [job.id])).rows[0].rawHtml;
    assert.equal(zlib.gunzipSync(raw).toString('utf8'), BEFORE, 'the page is kept, gzipped');

    // ---- Check again: unchanged is still a round; then the edited page ----
    net.calls = [];
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(r.status, 201); assert.equal(rr(r.body).number, 1); assert.equal(rr(r.body).status, 'ready');
    net.plain = { html: AFTER, finalUrl: 'https://gallery.example/artists/dorothy-stoner' };
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(rr(r.body).number, 2);
    assert.ok((await snapOf(job.id, 2)).blocks.some((b) => b.text === 'Dorothy Stoner (1921–2008)'));

    // ---- a failed round is stored with its reason; the next attempt replaces it ----
    net.plain = pub('Could not fetch the page (HTTP 500)');
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(rr(r.body).number, 3); assert.equal(rr(r.body).status, 'failed');
    assert.equal(rr(r.body).error, 'Could not fetch the page (HTTP 500)'); assert.equal(rr(r.body).fetchedVia, 'plain');
    net.plain = new Error('ECONNRESET at 10.1.2.3 secret detail');
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(rr(r.body).number, 3, 'a second failure replaces the first');
    assert.ok(!/secret|10\.1\.2\.3/.test(rr(r.body).error), 'an unexpected error is not shown as is');
    const huge = `<html><body>${Array.from({ length: 60 }, () => `<p>${'abcdefgh '.repeat(1000)}</p>`).join('')}</body></html>`;
    net.plain = { html: huge, finalUrl: 'https://gallery.example/artists/dorothy-stoner' };
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(rr(r.body).status, 'failed'); assert.match(rr(r.body).error, /Nothing was cut/);
    net.plain = { html: AFTER, finalUrl: 'https://gallery.example/artists/dorothy-stoner' };
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(rr(r.body).number, 3); assert.equal(rr(r.body).status, 'ready', 'success replaces the failed round');
    assert.deepEqual(r.body.job.rounds.map((x) => `${x.number}:${x.status}`), ['0:ready', '1:ready', '2:ready', '3:ready']);

    // ---- milestone 3: each round keeps what changed, against the starting point and the round before ----
    const rounds = r.body.job.rounds;
    assert.equal(rounds[0].sincePrevious, null, 'the starting point has nothing to compare with');
    assert.equal(rounds[1].sincePrevious.total, 0, 'the unchanged page: a round with no changes');
    assert.equal(rounds[2].sincePrevious.total, 7); assert.equal(rounds[2].sincePrevious.volatile, 1);
    assert.equal(rounds[3].sincePrevious.total, 0, 'round 3 is the same page as round 2');
    assert.equal(rounds[3].sinceBaseline.total, 7, 'but still differs from the starting point');
    assert.equal(rounds[3].previousNumber, 2);
    let full = (await call(A, 'GET', `/jobs/${job.id}/rounds/2`)).body;
    assert.equal(full.pages[0].results.diff.baselineNumber, 0);
    assert.ok(full.pages[0].results.diff.vsPrevious.changes.some((c) => c.type === 'removed' && c.before.text === '1998: Retrospective, Example Gallery'));
    // a round kept before changes were worked out (milestone 2) gets them when read
    await pool.query(`UPDATE content_check_rounds SET results = '{}'::jsonb WHERE "jobId" = $1 AND number = 2`, [job.id]);
    full = (await call(A, 'GET', `/jobs/${job.id}/rounds/2`)).body;
    assert.equal(full.pages[0].results.diff.vsPrevious.stats.total, 7, 'filled in on read');
    // the round before a failed one is skipped: compare with the last round that was read
    // (round 3 replaced the failed attempts, so its "before" is round 2)

    // ---- near-empty plain copy: the real browser, recorded as such ----
    net.plain = { html: '<html><body><div id="app"></div></body></html>', finalUrl: 'https://gallery.example/app' };
    net.browser = { html: AFTER, finalUrl: 'https://gallery.example/app/' };
    net.calls = [];
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.deepEqual(net.calls.map((c) => c[0]), ['plain', 'browser']);
    assert.equal(rr(r.body).fetchedVia, 'browser'); assert.equal(rr(r.body).finalUrl, 'https://gallery.example/app/');

    // ---- a job set to the real browser never tries a plain fetch; one whose first fetch fails is still made ----
    net.calls = [];
    r = await call(A, 'POST', '/jobs', { kind: 'compare', url: 'https://spa.example/', fetchMode: 'browser' });
    assert.deepEqual(net.calls.map((c) => c[0]), ['browser']); assert.equal(r.body.rounds[0].fetchedVia, 'browser');
    net.plain = pub('That address is not allowed');
    r = await call(A, 'POST', '/jobs', { kind: 'compare', url: 'https://blocked.example/' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.rounds.map((x) => [x.number, x.status, x.error]), [[0, 'failed', 'That address is not allowed']]);
    assert.equal(await snapOf(r.body.id, 0), null, 'a failed round has no snapshot');

    // ---- a starting point that needed the real browser: later rounds use it too, so the two ways of reading do not look like edits ----
    net.plain = { html: '<html><body><div id="root"></div></body></html>', finalUrl: 'https://js.example/' };
    net.browser = { html: BEFORE, finalUrl: 'https://js.example/' };
    r = await call(A, 'POST', '/jobs', { kind: 'compare', url: 'https://js.example/' });
    assert.equal(r.body.rounds[0].fetchedVia, 'browser');
    net.plain = { html: BEFORE, finalUrl: 'https://js.example/' }; // the plain copy would now be readable, but is not used
    net.calls = [];
    const next = await call(A, 'POST', `/jobs/${r.body.id}/rounds`);
    assert.deepEqual(net.calls.map((c) => c[0]), ['browser']);
    assert.equal(rr(next.body).fetchedVia, 'browser'); assert.equal(next.body.job.rounds[1].sincePrevious.total, 0);

    // ---- a saved copy instead of fetching ----
    r = await call(A, 'POST', '/jobs', { kind: 'compare', url: 'https://staging.example/page', fetch: false });
    const savedJob = r.body;
    assert.deepEqual(savedJob.rounds, []);
    assert.equal((await uploadAs(A, savedJob.id, 'page.pdf', '%PDF')).status, 400, 'only .html or .htm');
    assert.equal((await uploadAs(A, savedJob.id, 'page.html', 'x'.repeat(5 * 1024 * 1024 + 1))).status, 413, 'over 5 MB');
    r = await uploadAs(A, savedJob.id, 'Dorothy Stoner.html', `<!-- saved from url=(0040)https://staging.example/artists/saved -->\n${BEFORE.replace(/<link rel="canonical"[^>]*>/, '')}`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(rr(r.body).number, 0); assert.equal(rr(r.body).fetchedVia, 'upload');
    assert.equal(rr(r.body).finalUrl, 'https://staging.example/artists/saved');

    // ---- someone else's job ----
    assert.equal((await call(B, 'POST', `/jobs/${job.id}/rounds`)).status, 404);
    assert.equal((await uploadAs(B, job.id, 'x.html', BEFORE)).status, 404);
    assert.equal((await call(B, 'GET', `/jobs/${job.id}/rounds/0`)).status, 404);
    assert.equal((await call(A, 'GET', `/jobs/${job.id}/rounds/99`)).status, 404);
    assert.equal((await call(A, 'GET', `/jobs/${job.id}/rounds/x`)).status, 404);
    assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM content_check_rounds WHERE "jobId" = $1', [job.id])).rows[0].n), 5, "B added nothing to A's job");

    // ---- delete: the bin copy has the rounds but not the stored pages; restore brings the rounds back ----
    r = await call(A, 'DELETE', `/jobs/${job.id}`);
    assert.equal(r.status, 200);
    const payload = (await pool.query('SELECT payload FROM recycle_bin WHERE id = $1', [r.body.binId])).rows[0].payload;
    assert.equal(payload.rounds.length, 5);
    assert.ok(payload.rounds.every((x) => !('rawHtml' in x)), 'no stored page in the bin copy');
    await bin.restoreItem(A, r.body.binId);
    const back = (await call(A, 'GET', `/jobs/${job.id}`)).body;
    assert.deepEqual(back.rounds.map((x) => `${x.number}:${x.status}:${x.fetchedVia}`), ['0:ready:plain', '1:ready:plain', '2:ready:plain', '3:ready:plain', '4:ready:browser']);
    assert.ok((await snapOf(job.id, 2)).blocks.length > 10, 'snapshots back');
    assert.equal((await pool.query('SELECT "rawHtml" FROM content_check_rounds WHERE "jobId" = $1 AND number = 0', [job.id])).rows[0].rawHtml, null, 'the stored page does not come back');

    console.log('htmlContentCheck.rounds.db.test.js: all checks passed');
  } finally {
    server.close();
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1::int[])', [[A, B]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A, B]]);
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
