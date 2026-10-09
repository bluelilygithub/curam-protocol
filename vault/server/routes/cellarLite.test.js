#!/usr/bin/env node
/**
 * Cellar Planner LITE static hosting: the headers that let the business's own site embed it (and nobody else), no caching of the page itself,
 * long caching of hashed files, GET only, a plain 404 (never Vault's app), and that it can be reached without logging in.
 * Needs no database. Run: node server/routes/cellarLite.test.js   (or npm run test:cellar-lite)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const { createCellarLiteRouter, parseFrameAncestors, cellarLiteAvailable } = require('./cellarLiteRouter');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cellar-lite-'));
fs.mkdirSync(path.join(dir, 'assets'));
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>lite</title>');
fs.writeFileSync(path.join(dir, 'assets', 'lite-abc123.js'), 'console.log(1)');

function serve(opts) {
  const app = express();
  // stands in for the rest of Vault: anything the lite router does not handle is "Vault", behind a login
  app.use('/cellar-lite', createCellarLiteRouter({ dir, log: () => {}, ...opts }));
  app.use((req, res) => res.status(401).type('text/plain').send('VAULT LOGIN REQUIRED'));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
const get = (s, p, method = 'GET') => new Promise((resolve, reject) => {
  http.request({ port: s.address().port, path: p, method }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', reject).end();
});

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; } };

(async () => {
  await t('parses the allow-list: valid origins kept, wildcards, paths and header tricks rejected', () => {
    const r = parseFrameAncestors('https://www.example.com.au, http://localhost:8080  *  https://a.com/path https://b.com;script-src https://ok.org');
    assert.deepStrictEqual(r.valid, ['https://www.example.com.au', 'http://localhost:8080', 'https://ok.org']);
    assert.deepStrictEqual(r.rejected, ['*', 'https://a.com/path', 'https://b.com;script-src']);
    assert.deepStrictEqual(parseFrameAncestors('').valid, []);
    assert.deepStrictEqual(parseFrameAncestors(undefined).valid, []);
  });

  const closed = await serve({ frameAncestors: '' });
  const open = await serve({ frameAncestors: 'https://www.example.com.au' });

  await t('serves the page without logging in', async () => {
    const r = await get(closed, '/cellar-lite/');
    assert.strictEqual(r.status, 200);
    assert.match(r.body, /<title>lite<\/title>/);
    assert.match(r.headers['content-type'], /text\/html/);
  });
  await t('/cellar-lite redirects to /cellar-lite/ so the relative asset paths resolve', async () => {
    const r = await get(closed, '/cellar-lite');
    assert.ok([301, 302, 308].includes(r.status), String(r.status));
    assert.match(r.headers.location, /\/cellar-lite\/$/);
  });
  await t('by default only Vault itself may frame it', async () => {
    const r = await get(closed, '/cellar-lite/');
    assert.match(r.headers['content-security-policy'], /frame-ancestors 'self'(;|$)/);
    assert.strictEqual(r.headers['x-frame-options'], undefined);
  });
  await t('the configured site may frame it, and only that site', async () => {
    const csp = (await get(open, '/cellar-lite/')).headers['content-security-policy'];
    assert.match(csp, /frame-ancestors 'self' https:\/\/www\.example\.com\.au(;|$)/);
    assert.ok(!/\*/.test(csp), 'no wildcard anywhere');
  });
  await t('the page may load only its own files, run only its own scripts, and call nothing else', async () => {
    const csp = (await get(closed, '/cellar-lite/')).headers['content-security-policy'];
    for (const d of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "object-src 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
    assert.ok(!/script-src[^;]*unsafe-eval/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));
  });
  await t('the page itself is never cached; hashed files are cached for a year', async () => {
    assert.strictEqual((await get(closed, '/cellar-lite/')).headers['cache-control'], 'no-cache');
    assert.match((await get(closed, '/cellar-lite/assets/lite-abc123.js')).headers['cache-control'], /max-age=31536000, immutable/);
  });
  await t('sends no cookies and sets nosniff', async () => {
    const r = await get(closed, '/cellar-lite/');
    assert.strictEqual(r.headers['set-cookie'], undefined);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  });
  await t('serves the script with a JavaScript type', async () => {
    assert.match((await get(closed, '/cellar-lite/assets/lite-abc123.js')).headers['content-type'], /javascript/);
  });
  await t('a missing file is a plain 404, not Vault\'s app and not the page again', async () => {
    const r = await get(closed, '/cellar-lite/assets/nope.js');
    assert.strictEqual(r.status, 404);
    assert.ok(!/VAULT LOGIN/.test(r.body) && !/<title>lite/.test(r.body));
  });
  await t('path traversal does not leave the folder', async () => {
    const r = await get(closed, '/cellar-lite/..%2f..%2fpackage.json');
    assert.ok([400, 403, 404].includes(r.status), String(r.status));
  });
  await t('only GET and HEAD are allowed', async () => {
    assert.strictEqual((await get(closed, '/cellar-lite/', 'POST')).status, 405);
    assert.strictEqual((await get(closed, '/cellar-lite/', 'DELETE')).status, 405);
    assert.strictEqual((await get(closed, '/cellar-lite/', 'HEAD')).status, 200);
  });
  await t('the rest of Vault stays behind its login', async () => {
    assert.strictEqual((await get(closed, '/api/anything')).status, 401);
  });
  await t('reports whether the bundle has been built', () => {
    assert.strictEqual(cellarLiteAvailable(dir), true);
    assert.strictEqual(cellarLiteAvailable(path.join(dir, 'nowhere')), false);
  });

  closed.close(); open.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(process.exitCode ? 'FAILED' : `All ${passed} checks passed`);
})();
