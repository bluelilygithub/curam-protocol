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

  console.log('dataforseo.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
