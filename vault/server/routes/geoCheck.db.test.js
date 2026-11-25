'use strict';
// DATABASE_URL=... node server/routes/geoCheck.db.test.js
// Real database and real attachment files (in a temp folder), fake browser and proxy. Proves:
//   - a run captures countries x screens in the background, at most GEO_CHECK_CONTEXTS at once, and a failed country does not fail the run;
//   - exit mismatches are kept per capture; finished runs are "not seen" until opened;
//   - one person cannot see, open, stop, delete or load the pictures of another's run;
//   - limits: countries, the 24-picture cap, unknown countries, private addresses, one run at a time server-wide, 6 runs an hour;
//   - Stop keeps what was done; the byte ceiling and a full attachment space stop a run with a plain message;
//   - every country failing at the proxy raises a suggestion;
//   - delete goes to the recycle bin with its captures, restore brings them and the pictures back, delete forever removes the files.
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.DATABASE_URL) { console.log('SKIP geoCheck.db.test.js: DATABASE_URL is not set'); process.exit(0); }
// relative on purpose: UPLOAD_DIR is relative in local .env files, and the picture route once failed on that
process.env.UPLOAD_DIR = path.relative(process.cwd(), fs.mkdtempSync(path.join(os.tmpdir(), 'geo-check-test-')));

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const { createRouter } = require('./geoCheck');
const { createGeoJobs } = require('../services/geoCheck/jobs');
const bin = require('../services/recycleBin');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PHONE = { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, mobile: true };
const LAPTOP = { id: 'laptop', label: 'Laptop', width: 1366, height: 768 };
const URL1 = 'http://93.184.216.34/shop';

function fakeCapture({ fail = {}, exits = {}, bytes = 1000, gate = null } = {}) {
  const stats = { inFlight: 0, max: 0, calls: [] };
  const fn = async ({ country, screens }, { signal, browser }) => {
    assert.ok(browser && browser.fake, 'the run shares one browser');
    stats.calls.push(country); stats.inFlight += 1; stats.max = Math.max(stats.max, stats.inFlight);
    try {
      if (gate) await gate(signal);
      else await sleep(30);
      if (fail[country]) return { country, status: 'failed', exitCountry: null, verified: false, httpStatus: null, finalUrl: null, bytes: 10, shots: [], error: fail[country] };
      const exit = exits[country] || country;
      const shots = signal.aborted ? [] : screens.map(() => ({ image: JPEG, cut: false, facts: { htmlLang: 'en', title: `Shop ${country}`, prices: ['$1'], currencies: [], headings: [], buttons: [], consentBanner: false } }));
      return { country, status: 'ok', exitCountry: exit, verified: exit === country, label: '', httpStatus: 200, finalUrl: URL1, bytes, shots, error: null };
    } finally { stats.inFlight -= 1; }
  };
  return { fn, stats };
}

function makeJobs(capture, extra = {}) {
  const suggestions = [];
  const jobs = createGeoJobs({
    pool, captureCountry: capture, launchBrowser: async () => ({ fake: true, close: async () => {} }), isConfigured: () => true,
    captureIf: async (cond, p) => { if (cond) suggestions.push(p); }, makeFingerprint: (s, k) => `${s}:${k}`, log: () => {},
    env: { GEO_CHECK_CONTEXTS: '2', ...(extra.env || {}) }, ...(extra.deps || {}),
  });
  return { jobs, suggestions };
}

function serve(router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']), isAdmin: false }; next(); });
  app.use('/api/geo-check', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

async function call(server, user, method, url, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/geo-check${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-test-user': String(user) }, body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

async function waitDone(server, user, id) {
  for (let i = 0; i < 200; i += 1) {
    const { rows } = await pool.query('SELECT status FROM geo_check_runs WHERE id = $1', [id]);
    if (rows[0].status !== 'running') return;
    await sleep(25);
  }
  throw new Error('run did not finish');
}

(async () => {
  await schemaDone;
  const tag = `geo${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const [A, B, C, D, E, F] = [await mk('a'), await mk('b'), await mk('c'), await mk('d'), await mk('e'), await mk('f')];
  const servers = [];
  try {
    // ── a normal run ──
    const cap = fakeCapture({ fail: { DE: 'The page took too long to load through the proxy.' }, exits: { JP: 'US' } });
    const main = makeJobs(cap.fn);
    const s = await serve(createRouter({ jobs: main.jobs, pool }));
    servers.push(s);

    let r = await call(s, A, 'GET', '/config');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.countries, ['AU', 'NZ', 'US', 'GB', 'DE', 'JP']);
    assert.equal(r.body.configured !== undefined, true);
    assert.equal(JSON.stringify(r.body).includes('PASSWORD'), false);
    r = await call(s, A, 'PUT', '/countries', { countries: ['au', 'de', 'jp', 'nz'] });
    assert.deepEqual(r.body.countries, ['AU', 'DE', 'JP', 'NZ']);
    assert.deepEqual((await call(s, A, 'GET', '/config')).body.countries, ['AU', 'DE', 'JP', 'NZ']);
    assert.equal((await call(s, A, 'PUT', '/countries', { countries: ['XX'] })).status, 400);

    r = await call(s, A, 'POST', '/runs', { url: '93.184.216.34/shop', label: 'before release', countries: ['AU', 'DE', 'JP', 'NZ'], screens: [PHONE, LAPTOP] });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const runId = r.body.id;
    await waitDone(s, A, runId);
    assert.equal(cap.stats.max, 2, 'two countries at once');
    const { rows: [unseen] } = await pool.query('SELECT "seenAt" FROM geo_check_runs WHERE id = $1', [runId]);
    assert.equal(unseen.seenAt, null, 'finished, not opened yet');
    r = await call(s, A, 'GET', `/runs/${runId}`);
    assert.equal(r.body.status, 'done');
    assert.equal(r.body.capturesDone, 8);
    assert.equal(r.body.progress, 100);
    assert.equal(r.body.bytesTotal, 3010);
    assert.equal(r.body.captures.length, 8);
    const de = r.body.captures.filter((c) => c.country === 'DE');
    assert.deepEqual(de.map((c) => c.status), ['failed', 'failed']);
    assert.match(de[0].error, /too long/);
    const jp = r.body.captures.find((c) => c.country === 'JP');
    assert.equal(jp.exitCountry, 'US');
    assert.equal(jp.verified, false);
    assert.equal(r.body.captures.find((c) => c.country === 'AU').verified, true);
    const au = r.body.captures.find((c) => c.country === 'AU' && c.deviceId === 'laptop');
    assert.equal(au.width, 1366);
    assert.equal(au.hasImage, true);
    assert.notEqual((await pool.query('SELECT "seenAt" FROM geo_check_runs WHERE id = $1', [runId])).rows[0].seenAt, null, 'opening marks it seen');

    // pictures: the owner gets the JPEG; nobody else gets it, or the run
    r = await call(s, A, 'GET', `/runs/${runId}/captures/${au.id}/image`);
    assert.equal(r.status, 200);
    assert.match(r.type, /image\/jpeg/);
    assert.deepEqual(r.body, JPEG);
    assert.equal((await call(s, B, 'GET', `/runs/${runId}/captures/${au.id}/image`)).status, 404);
    assert.equal((await call(s, B, 'GET', `/runs/${runId}`)).status, 404);
    assert.deepEqual((await call(s, B, 'GET', '/runs')).body.runs, []);
    assert.equal((await call(s, B, 'POST', `/runs/${runId}/stop`)).status, 404);
    assert.equal((await call(s, B, 'DELETE', `/runs/${runId}`)).status, 404);
    assert.equal((await call(s, A, 'GET', '/runs')).body.runs[0].id, runId);

    // ── limits ──
    const bad = async (body, status, re) => { const x = await call(s, B, 'POST', '/runs', { url: URL1, screens: [PHONE], countries: ['AU'], ...body }); assert.equal(x.status, status, JSON.stringify(x.body)); if (re) assert.match(x.body.error, re); };
    await bad({ url: 'http://127.0.0.1/admin' }, 400, /public web address/);
    await bad({ countries: ['AU', 'XX'] }, 400, /XX/);
    await bad({ countries: [] }, 400, /at least one country/);
    await bad({ countries: ['AU', 'NZ', 'US', 'GB', 'DE', 'JP', 'CA', 'IE', 'FR', 'ES', 'IT', 'NL', 'BE'] }, 400, /at most 12/);
    await bad({ countries: ['AU', 'NZ', 'US', 'GB', 'DE', 'JP', 'CA'], screens: [PHONE, LAPTOP, PHONE, LAPTOP] }, 400, /28 pictures/);
    await bad({ screens: [{ width: 100, height: 100 }] }, 400, /out of range/);

    // ── one run at a time server-wide; Stop keeps what was done ──
    let release;
    const held = new Promise((res) => { release = res; });
    const slow = fakeCapture({ gate: async (signal) => { await Promise.race([held, new Promise((res) => signal.addEventListener('abort', res))]); } });
    const slowJobs = makeJobs(slow.fn);
    const s2 = await serve(createRouter({ jobs: slowJobs.jobs, pool }));
    servers.push(s2);
    r = await call(s2, C, 'POST', '/runs', { url: URL1, countries: ['AU', 'NZ', 'US'], screens: [PHONE] });
    assert.equal(r.status, 202);
    const slowId = r.body.id;
    await sleep(50);
    r = await call(s2, D, 'POST', '/runs', { url: URL1, countries: ['AU'], screens: [PHONE] });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Someone else/);
    assert.match((await call(s2, C, 'POST', '/runs', { url: URL1, countries: ['AU'], screens: [PHONE] })).body.error, /already running/);
    assert.equal((await call(s2, C, 'DELETE', `/runs/${slowId}`)).status, 409, 'stop before deleting');
    assert.equal((await call(s2, C, 'POST', `/runs/${slowId}/stop`)).body.stopped, true);
    await waitDone(s2, C, slowId);
    release();
    r = await call(s2, C, 'GET', `/runs/${slowId}`);
    assert.equal(r.body.status, 'stopped');
    assert.equal(r.body.errorMessage, 'Stopped.');
    assert.equal(slow.stats.calls.length, 2, 'the third country never started');

    // ── 6 runs an hour ──
    for (let i = 0; i < 6; i += 1) await pool.query(`INSERT INTO geo_check_runs ("userId", url, settings, status) VALUES ($1, $2, '{"countries":["AU"]}', 'done')`, [D, URL1]);
    r = await call(s, D, 'POST', '/runs', { url: URL1, countries: ['AU'], screens: [PHONE] });
    assert.equal(r.status, 429);

    // ── the byte ceiling ──
    const heavy = makeJobs(fakeCapture({ bytes: 2 * 1024 * 1024 }).fn, { env: { GEO_PROXY_MAX_MB_PER_RUN: '3', GEO_CHECK_CONTEXTS: '1' } });
    const s3 = await serve(createRouter({ jobs: heavy.jobs, pool }));
    servers.push(s3);
    r = await call(s3, E, 'POST', '/runs', { url: URL1, countries: ['AU'], screens: [PHONE] }); // first run: estimate unknown (4 MB a country) > 3 MB
    assert.equal(r.status, 400);
    assert.match(r.body.error, /about 4 MB/);
    await pool.query(`INSERT INTO geo_check_runs ("userId", url, settings, status, "bytesTotal") VALUES ($1, $2, '{"countries":["AU","NZ","US"]}', 'done', 3000)`, [E, URL1]);
    r = await call(s3, E, 'POST', '/runs', { url: URL1, countries: ['AU', 'NZ', 'US'], screens: [PHONE] }); // history: 1 KB a country
    assert.equal(r.status, 202);
    await waitDone(s3, E, r.body.id);
    r = await call(s3, E, 'GET', `/runs/${r.body.id}`);
    assert.equal(r.body.status, 'stopped');
    assert.match(r.body.errorMessage, /most one run may download \(3 MB\)/);
    assert.equal(r.body.captures.length, 2, 'stopped after the second country');

    // ── attachment space full ──
    const full = makeJobs(fakeCapture().fn, { deps: { saveImage: async () => { throw Object.assign(new Error('quota'), { statusCode: 413 }); } } });
    const s4 = await serve(createRouter({ jobs: full.jobs, pool }));
    servers.push(s4);
    r = await call(s4, F, 'POST', '/runs', { url: URL1, countries: ['AU', 'NZ', 'US'], screens: [PHONE] });
    await waitDone(s4, F, r.body.id);
    r = await call(s4, F, 'GET', `/runs/${r.body.id}`);
    assert.equal(r.body.status, 'stopped');
    assert.match(r.body.errorMessage, /storage is full/);

    // ── the proxy failing everywhere raises a suggestion ──
    const broken = makeJobs(fakeCapture({ fail: { AU: 'The proxy did not answer. Check...', NZ: 'The proxy did not answer. Check...' } }).fn);
    const s5 = await serve(createRouter({ jobs: broken.jobs, pool }));
    servers.push(s5);
    r = await call(s5, B, 'POST', '/runs', { url: URL1, countries: ['AU', 'NZ'], screens: [PHONE] });
    await waitDone(s5, B, r.body.id);
    r = await call(s5, B, 'GET', `/runs/${r.body.id}`);
    assert.equal(r.body.status, 'failed');
    assert.match(r.body.errorMessage, /^The proxy did not answer/);
    assert.equal(broken.suggestions.length, 1);
    assert.match(broken.suggestions[0].title, /proxy is not answering/);
    assert.equal(main.suggestions.length, 0, '1 mismatch in 4 is not worth a suggestion');

    // ── delete -> bin -> restore -> delete forever ──
    const { rows: files } = await pool.query(`SELECT a.id, a."storedPath" FROM geo_check_captures c JOIN attachments a ON a.id = c."attachmentId" WHERE c."runId" = $1`, [runId]);
    assert.equal(files.length, 6);
    r = await call(s, A, 'DELETE', `/runs/${runId}`);
    assert.equal(r.status, 200);
    const binId = r.body.binId;
    assert.equal((await call(s, A, 'GET', `/runs/${runId}`)).status, 404);
    assert.ok(files.every((f) => fs.existsSync(f.storedPath)), 'pictures kept while in the bin');
    await bin.restoreItem(A, binId);
    r = await call(s, A, 'GET', `/runs/${runId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.captures.length, 8);
    assert.equal(r.body.settings.countries.length, 4);
    assert.deepEqual(r.body.captures.find((c) => c.country === 'AU').extract.prices, ['$1']);
    assert.equal((await call(s, A, 'GET', `/runs/${runId}/captures/${au.id}/image`)).status, 200, 'pictures back too');
    r = await call(s, A, 'DELETE', `/runs/${runId}`);
    assert.equal(await bin.deleteForever(A, r.body.binId), true);
    assert.ok(files.every((f) => !fs.existsSync(f.storedPath)), 'files removed for good');
    assert.equal((await pool.query('SELECT COUNT(*) AS n FROM attachments WHERE id = ANY($1::int[])', [files.map((f) => f.id)])).rows[0].n, '0');

    console.log('geoCheck db tests passed');
  } finally {
    servers.forEach((x) => x.close());
    await pool.query(`DELETE FROM recycle_bin WHERE "userId" = ANY($1::int[])`, [[A, B, C, D, E, F]]);
    await pool.query(`DELETE FROM attachments WHERE "userId" = ANY($1::int[])`, [[A, B, C, D, E, F]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [[A, B, C, D, E, F]]);
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
