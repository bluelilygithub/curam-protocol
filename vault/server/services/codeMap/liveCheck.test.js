#!/usr/bin/env node
// Code Map live site checks against a fake site (no network, no database). Run: node server/services/codeMap/liveCheck.test.js
'use strict';

const assert = require('assert');
const { runLiveChecks, sampleRoutes, createLiveChecks, FOREIGN_ORIGIN, PROBE_PATH } = require('./liveCheck');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };
const by = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

const GOOD_HEADERS = {
  'content-security-policy': "default-src 'self';script-src 'self' 'wasm-unsafe-eval' blob:;frame-ancestors 'self'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'no-referrer',
};
const manifest = {
  'GET /api/admin/users': { class: 'admin' }, 'GET /api/notes': { class: 'authed' }, 'GET /api/notes/:id': { class: 'authed' },
  'GET /api/health': { class: 'public' }, 'POST /api/auth/login': { class: 'public' }, 'GET /api/cellar-lite/config': { class: 'public' },
};

/** A fake site: `over` replaces answers by "METHOD url" or by url. */
function site(over = {}) {
  const calls = [];
  const fake = async (target, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ method, target, headers: opts.headers || {}, redirect: opts.redirect });
    const o = over[`${method} ${target}`] || over[target];
    if (o instanceof Error) throw o;
    let status = 200; let headers = {}; let body = '{}';
    if (target === 'https://vault.example.com/') headers = GOOD_HEADERS;
    else if (target === 'http://vault.example.com/') { status = 301; headers = { location: 'https://vault.example.com/' }; }
    else if (/\/api\/(notes|admin)/.test(target)) status = 401;
    else if (target.endsWith(PROBE_PATH)) { status = 400; body = '<pre>Bad Request</pre>'; }
    if (o) ({ status = status, headers = headers, body = body } = o);
    return { status, headers: new Map(Object.entries(headers)), text: async () => body };
  };
  return { fake, calls };
}

(async () => {
  await t('sampleRoutes: GET routes without a :param; protected and public split', () => {
    const s = sampleRoutes(manifest);
    assert.deepStrictEqual(s.protectedRoutes.map((r) => r.path), ['/api/admin/users', '/api/notes']);
    assert.deepStrictEqual(s.publicRoutes.map((r) => r.path), ['/api/health', '/api/cellar-lite/config']);
  });

  await t('a healthy https site passes every check, using only safe requests', async () => {
    const s = site();
    const r = await runLiveChecks({ base: 'https://vault.example.com', fetch: s.fake, certDays: async () => 60, manifest });
    const c = by(r);
    for (const id of ['reachable', 'https', 'cert', 'hsts', 'csp', 'nosniff', 'framing', 'referrer', 'poweredBy', 'cors', 'authRequired', 'publicRoutes', 'errorLeak']) {
      assert.strictEqual(c[id].status, 'pass', `${id}: ${c[id].note}`);
    }
    assert.ok(s.calls.every((x) => x.redirect === 'manual'), 'redirects are never followed');
    assert.ok(s.calls.filter((x) => x.method !== 'GET').every((x) => x.target.endsWith(PROBE_PATH)), 'the only non-GET is the probe');
    assert.ok(s.calls.some((x) => x.headers.Origin === FOREIGN_ORIGIN));
    assert.ok(s.calls.some((x) => /^Bearer 0{64}$/.test(x.headers.Authorization || '')), 'a made-up token is tried');
    assert.ok(!s.calls.some((x) => x.target.includes(':id')), 'routes with an id are not called');
  });

  await t('problems are reported: no headers, open CORS, an open protected route, a 500, a stack trace, no redirect, expiring cert', async () => {
    const s = site({
      'https://vault.example.com/': { headers: { 'x-powered-by': 'Express', 'content-security-policy': "script-src 'self' 'unsafe-inline'" } },
      'http://vault.example.com/': { status: 200, headers: {} },
      'https://vault.example.com/api/health': { headers: { 'access-control-allow-origin': FOREIGN_ORIGIN, 'access-control-allow-credentials': 'true' } },
      'https://vault.example.com/api/notes': { status: 200 },
      'https://vault.example.com/api/cellar-lite/config': { status: 500 },
      [`POST https://vault.example.com${PROBE_PATH}`]: { status: 400, body: 'SyntaxError: Unexpected end\n    at JSON.parse (<anonymous>)\n    at /app/node_modules/body-parser/x.js:1:2' },
    });
    const c = by(await runLiveChecks({ base: 'https://vault.example.com/', fetch: s.fake, certDays: async () => 5, manifest }));
    assert.strictEqual(c.https.status, 'fail');
    assert.strictEqual(c.cert.status, 'fail');
    assert.strictEqual(c.hsts.status, 'fail');
    assert.strictEqual(c.csp.status, 'warn');
    assert.ok(c.csp.note.includes("'unsafe-inline'"));
    assert.strictEqual(c.nosniff.status, 'fail');
    assert.strictEqual(c.framing.status, 'fail');
    assert.strictEqual(c.poweredBy.status, 'warn');
    assert.strictEqual(c.cors.status, 'fail');
    assert.ok(c.cors.note.includes('allows credentials'));
    assert.strictEqual(c.authRequired.status, 'fail');
    assert.ok(c.authRequired.items[0].text.startsWith('NOT REFUSED: GET /api/notes'), 'open routes listed first');
    assert.strictEqual(c.publicRoutes.status, 'warn');
    assert.strictEqual(c.errorLeak.status, 'fail');
  });

  await t('a local http address: HTTPS, certificate, HSTS and CSP are not applicable', async () => {
    const s = site({ 'http://localhost:3001/': { headers: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'no-referrer' } } });
    const c = by(await runLiveChecks({ base: 'http://localhost:3001', fetch: s.fake, certDays: async () => { throw new Error('not called'); }, manifest }));
    for (const id of ['https', 'cert', 'hsts', 'csp']) assert.strictEqual(c[id].status, 'na', id);
  });

  await t('the site not answering stops after one check', async () => {
    const r = await runLiveChecks({ base: 'https://vault.example.com', fetch: site({ 'https://vault.example.com/': new Error('ECONNREFUSED') }).fake, certDays: async () => 60, manifest });
    assert.deepStrictEqual(r.checks.map((c) => [c.id, c.status]), [['reachable', 'fail']]);
    assert.ok(r.checks[0].note.includes('ECONNREFUSED'));
  });

  await t('no access list: the auth check warns instead of passing', async () => {
    const c = by(await runLiveChecks({ base: 'https://vault.example.com', fetch: site().fake, certDays: async () => 60, manifest: null }));
    assert.strictEqual(c.authRequired.status, 'warn');
  });

  await t('service: stores the result, keeps the last 10, raises only failing high checks, one at a time', async () => {
    const sql = [];
    const pool = { async query(s, p) { sql.push([s, p]); if (/^INSERT/.test(s)) return { rows: [{ id: 4, createdAt: 'now' }] }; return { rows: [] }; } };
    const inbox = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const svc = createLiveChecks({
      pool, log: { error() {} }, makeFingerprint: (s, k) => `${s}:${k}`, captureIf: async (cond, p) => { if (cond) inbox.push(p); },
      run: async () => { await gate; return { checks: [{ id: 'cors', label: 'CORS', severity: 'high', status: 'fail', note: 'open', why: 'W', fix: 'F', items: [] }, { id: 'referrer', severity: 'low', status: 'fail', items: [] }, { id: 'csp', severity: 'medium', status: 'pass', items: [] }], counts: { fail: 2, pass: 1 } }; },
    });
    const p = svc.check(3, 'https://vault.example.com');
    await assert.rejects(svc.check(3, 'https://vault.example.com'), (e) => e.status === 409);
    release();
    const r = await p;
    assert.strictEqual(r.id, 4);
    assert.deepStrictEqual(sql[0][1].slice(0, 2), [3, 'https://vault.example.com']);
    assert.ok(/LIMIT \$1/.test(sql[1][0]) && sql[1][1][0] === 10);
    assert.deepStrictEqual(inbox.map((i) => i.fingerprint), ['codeMap:live:cors']);
  });

  console.log(`liveCheck tests: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
