'use strict';
// node server/services/serpTracker/dataforseo.test.js   (fake fetch, no network)
const assert = require('node:assert/strict');
const { request, getBalance, authHeader, hasCredentials, DataForSeoError } = require('./dataforseo');

const ENV = { DATAFORSEO_LOGIN: 'me@example.com', DATAFORSEO_PASSWORD: 'p@ss:word' };
const noSleep = async () => {};
const res = (status, body) => ({ status, json: async () => body });
const okBody = (balance = 12.5, cost = 0) => ({ status_code: 20000, cost, tasks: [{ result: [{ money: { balance } }] }] });

(async () => {
  // header is built in code from login:password (a colon in the password must survive)
  assert.equal(authHeader(ENV), `Basic ${Buffer.from('me@example.com:p@ss:word').toString('base64')}`);
  assert.equal(hasCredentials(ENV), true);
  assert.equal(hasCredentials({ DATAFORSEO_LOGIN: 'x' }), false);
  assert.throws(() => authHeader({}), (e) => e.code === 'NO_CREDENTIALS');

  // happy path: right URL, method and header; balance parsed
  let seen;
  const b = await getBalance({ env: ENV, fetchImpl: async (url, init) => { seen = { url, init }; return res(200, okBody(12.5, 0)); }, sleep: noSleep });
  assert.deepEqual(b, { balanceUsd: 12.5, costUsd: 0 });
  assert.equal(seen.url, 'https://api.dataforseo.com/v3/appendix/user_data');
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.headers.Authorization, authHeader(ENV));

  // 5xx and 429 are retried up to 3 times (4 calls in all), with doubling waits
  let calls = 0;
  const waits = [];
  await assert.rejects(
    request({ path: '/x', env: ENV, fetchImpl: async () => { calls++; return res(503, {}); }, sleep: async (ms) => { waits.push(ms); } }),
    (e) => e instanceof DataForSeoError && e.status === 503,
  );
  assert.equal(calls, 4);
  assert.deepEqual(waits, [1000, 2000, 4000]);

  // a retry that then succeeds
  calls = 0;
  const r = await request({ path: '/x', env: ENV, fetchImpl: async () => { calls++; return calls < 3 ? res(429, {}) : res(200, okBody()); }, sleep: noSleep });
  assert.equal(calls, 3);
  assert.equal(r.status_code, 20000);

  // network errors are retried too
  calls = 0;
  await request({ path: '/x', env: ENV, fetchImpl: async () => { calls++; if (calls < 2) throw new Error('ECONNRESET'); return res(200, okBody()); }, sleep: noSleep });
  assert.equal(calls, 2);

  // other 4xx are NOT retried (one call), and a refused login says so
  calls = 0;
  await assert.rejects(
    request({ path: '/x', env: ENV, fetchImpl: async () => { calls++; return res(401, {}); }, sleep: noSleep }),
    (e) => e.status === 401 && /refused/.test(e.message),
  );
  assert.equal(calls, 1);
  // the reason DataForSEO gives comes through, and still never a secret
  await assert.rejects(request({ path: '/x', env: ENV, fetchImpl: async () => res(403, { status_code: 40200, status_message: 'Access denied.' }), sleep: noSleep }), (e) => e.status === 403 && e.message.includes('Access denied.') && !e.message.includes(ENV.DATAFORSEO_PASSWORD));
  calls = 0;
  await assert.rejects(request({ path: '/x', env: ENV, fetchImpl: async () => { calls++; return res(404, {}); }, sleep: noSleep }), (e) => e.status === 404);
  assert.equal(calls, 1);

  // an API-level error code (HTTP 200 but status_code not 20000) is an error, not retried
  calls = 0;
  await assert.rejects(
    request({ path: '/x', env: ENV, fetchImpl: async () => { calls++; return res(200, { status_code: 40501, status_message: 'Invalid Field' }); }, sleep: noSleep }),
    (e) => e.code === 'API_STATUS' && e.message.includes('40501'),
  );
  assert.equal(calls, 1);

  // a body with no balance is an error, never a silent zero
  await assert.rejects(getBalance({ env: ENV, fetchImpl: async () => res(200, { status_code: 20000, tasks: [{ result: [{}] }] }), sleep: noSleep }), (e) => e.code === 'BAD_BODY');

  // no secret ever appears in an error message
  for (const failing of [
    async () => { throw new Error(`boom ${ENV.DATAFORSEO_PASSWORD}`); },
    async () => res(401, {}),
    async () => res(500, {}),
  ]) {
    try { await request({ path: '/x', env: ENV, fetchImpl: failing, sleep: noSleep }); assert.fail('should have thrown'); } catch (e) {
      assert.ok(!e.message.includes(ENV.DATAFORSEO_PASSWORD) && !e.message.includes(ENV.DATAFORSEO_LOGIN) && !/Basic /.test(e.message), e.message);
    }
  }

  // missing credentials fail before any network call
  calls = 0;
  await assert.rejects(request({ path: '/x', env: {}, fetchImpl: async () => { calls++; return res(200, {}); }, sleep: noSleep }), (e) => e.code === 'NO_CREDENTIALS');
  assert.equal(calls, 0);

  // --- stage 2: post one search task (the request body, the ID and the charge)
  const { postSerpTask, getSerpTask, waitForSerpTask } = require('./dataforseo');
  let sent;
  const posted = await postSerpTask(
    { keyword: 'walk in wine cabinets', locationName: 'Australia', languageCode: 'en', device: 'mobile', depth: 100, loadAiOverview: true, tag: 'k1' },
    { env: ENV, sleep: noSleep, fetchImpl: async (url, init) => { sent = { url, init }; return res(200, { status_code: 20000, cost: 0.0156, tasks: [{ id: 'task-1', status_code: 20100, cost: 0.0156 }] }); } },
  );
  assert.deepEqual(posted, { taskId: 'task-1', costUsd: 0.0156 });
  assert.equal(sent.url, 'https://api.dataforseo.com/v3/serp/google/organic/task_post');
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body), [{ keyword: 'walk in wine cabinets', location_name: 'Australia', language_code: 'en', device: 'mobile', depth: 100, priority: 1, load_async_ai_overview: true, tag: 'k1' }]);
  // AI Overview is only asked for when wanted (it can cost extra)
  await postSerpTask({ keyword: 'k', locationName: 'Australia', languageCode: 'en', device: 'desktop', depth: 10 }, { env: ENV, sleep: noSleep, fetchImpl: async (u, init) => { sent = JSON.parse(init.body)[0]; return res(200, { status_code: 20000, tasks: [{ id: 't', status_code: 20100, cost: 0 }] }); } });
  assert.equal('load_async_ai_overview' in sent, false);

  // a task DataForSEO refuses is an error with its reason, never an ID
  await assert.rejects(
    postSerpTask({ keyword: 'k', locationName: 'Nowhere', languageCode: 'en', device: 'desktop', depth: 10 }, { env: ENV, sleep: noSleep, fetchImpl: async () => res(200, { status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field: location_name.' }] }) }),
    (e) => e.code === 'TASK_REJECTED' && e.message.includes('40501'),
  );

  // --- reading a task: pending, ready, failed
  const taskAnswer = (code, extra = {}) => res(200, { status_code: 20000, cost: 0.0156, tasks: [{ id: 'task-1', status_code: code, result: [{ items: [] }], ...extra }] });
  let g = await getSerpTask('task-1', { env: ENV, sleep: noSleep, fetchImpl: async (url) => { assert.ok(url.endsWith('/v3/serp/google/organic/task_get/advanced/task-1')); return taskAnswer(40602); } });
  assert.deepEqual(g, { ready: false });
  g = await getSerpTask('task-1', { env: ENV, sleep: noSleep, fetchImpl: async () => taskAnswer(20000) });
  assert.equal(g.ready, true);
  assert.deepEqual(g.result, { items: [] });
  await assert.rejects(getSerpTask('task-1', { env: ENV, sleep: noSleep, fetchImpl: async () => taskAnswer(40501, { status_message: 'bad' }) }), (e) => e.code === 'TASK_FAILED');
  // a task id with odd characters cannot change the path
  await getSerpTask('a/../b', { env: ENV, sleep: noSleep, fetchImpl: async (url) => { assert.ok(url.endsWith('/task_get/advanced/a%2F..%2Fb'), url); return taskAnswer(20000); } });

  // --- waiting: ready on the third look; and a timeout reports "not ready", it does not throw or loop forever
  let looks = 0;
  const waited = [];
  g = await waitForSerpTask('task-1', { env: ENV, intervalMs: 5000, sleep: async (ms) => { waited.push(ms); }, fetchImpl: async () => { looks++; return taskAnswer(looks < 3 ? 40602 : 20000); } });
  assert.equal(g.ready, true);
  assert.equal(looks, 3);
  assert.deepEqual(waited, [5000, 5000]);
  let clock = 0;
  looks = 0;
  g = await waitForSerpTask('task-1', { env: ENV, intervalMs: 10, maxMs: 35, now: () => clock, sleep: async (ms) => { clock += ms; }, fetchImpl: async () => { looks++; return taskAnswer(40602); } });
  assert.deepEqual(g, { ready: false, timedOut: true });
  assert.ok(looks >= 2 && looks <= 5, `looks ${looks}`);

  console.log('dataforseo.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
