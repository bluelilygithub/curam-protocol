#!/usr/bin/env node
/**
 * Cellar Planner LITE settings: what counts as a valid setting, that the public endpoint can be read from the business's own website but never
 * leaks unpublished prices, and that the admin routes store, validate and reset. Uses an in-memory stand-in for the database.
 * Run: node server/routes/cellarLiteConfig.test.js   (or npm run test:cellar-lite-config)
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { validateConfig, publicView, DEFAULTS, KEY } = require('../config/cellarLiteConfig');
const { createCellarLiteConfigRouters } = require('./cellarLiteConfigRouter');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; } };

/** A one-table stand-in for pg: just the three statements the router runs. */
function fakePool() {
  const rows = new Map();
  const calls = { select: 0 };
  return {
    rows, calls,
    async query(sql, params) {
      if (/^\s*SELECT/i.test(sql)) { calls.select++; return { rows: rows.has(params[0]) ? [{ value: rows.get(params[0]), updatedAt: new Date('2026-01-02T03:04:05Z') }] : [] }; }
      if (/^\s*INSERT/i.test(sql)) { rows.set(params[0], params[1]); return { rows: [] }; }
      if (/^\s*DELETE/i.test(sql)) { rows.delete(params[0]); return { rows: [] }; }
      throw new Error('unexpected sql ' + sql);
    },
  };
}
function serve(pool, now) {
  const { publicRouter, adminRouter } = createCellarLiteConfigRouters({ pool, now });
  const app = express();
  app.use(express.json());
  app.use('/api/cellar-lite/config', publicRouter);
  app.use('/api/admin/cellar-lite/config', adminRouter); // the real mount adds requireAdmin; the test checks that mount separately below
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
const call = (s, method, path, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ port: s.address().port, path, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, body: b }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});

(async () => {
  await t('no stored settings gives the defaults, with no complaints', () => {
    const { config, errors } = validateConfig(undefined);
    assert.deepStrictEqual(config, JSON.parse(JSON.stringify(DEFAULTS)));
    assert.deepStrictEqual(errors, []);
  });

  await t('out-of-range sizes fall back to the default and say so in plain words', () => {
    const { config, errors } = validateConfig({ rack: { unitWidthMm: 50 }, doors: { singleMm: 'wide' } });
    assert.strictEqual(config.rack.unitWidthMm, 600);
    assert.strictEqual(config.doors.singleMm, 970);
    assert.ok(errors.some((e) => /rack unit width must be between 400 and 1200/i.test(e)), errors.join(' | '));
    assert.ok(errors.some((e) => /single door width/i.test(e)));
  });

  await t('valid sizes are kept (and rounded to whole millimetres)', () => {
    const { config, errors } = validateConfig({ rack: { unitWidthMm: 750.4, unitHeightMm: 2200 }, doors: { singleMm: 900, doubleMm: 1600 } });
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(config.rack.unitWidthMm, 750);
    assert.strictEqual(config.rack.unitHeightMm, 2200);
    assert.strictEqual(config.doors.doubleMm, 1600);
  });

  await t('prices: blank means not set, numbers are kept, junk and negatives are refused', () => {
    const ok = validateConfig({ pricing: { show: true, perUnit: '1250.5', fixed: '', doorSingle: null } });
    assert.deepStrictEqual(ok.errors, []);
    assert.strictEqual(ok.config.pricing.perUnit, 1250.5);
    assert.strictEqual(ok.config.pricing.fixed, null);
    assert.strictEqual(ok.config.pricing.show, true);
    const bad = validateConfig({ pricing: { perUnit: -5, fixed: 'lots' } });
    assert.strictEqual(bad.config.pricing.perUnit, null);
    assert.strictEqual(bad.config.pricing.fixed, null);
    assert.strictEqual(bad.errors.length, 2);
  });

  await t('"show the price" with no amounts entered is refused and stays off', () => {
    const { config, errors } = validateConfig({ pricing: { show: true } });
    assert.strictEqual(config.pricing.show, false);
    assert.ok(errors.some((e) => /at least one amount/i.test(e)));
  });

  await t('range % and rounding are limited to sensible values', () => {
    assert.strictEqual(validateConfig({ pricing: { rangePct: 80 } }).config.pricing.rangePct, 15);
    assert.strictEqual(validateConfig({ pricing: { roundTo: 7 } }).config.pricing.roundTo, 100);
    assert.strictEqual(validateConfig({ pricing: { rangePct: 0, roundTo: 500 } }).config.pricing.roundTo, 500);
  });

  await t('starting rooms: names and sizes checked, at most six, ids made safe and unique', () => {
    const { config, errors } = validateConfig({ presets: [
      { name: 'A', widthMm: 2000, depthMm: 2000, heightMm: 2400, id: 'Same Id!' },
      { name: 'B', widthMm: 2000, depthMm: 2000, heightMm: 2400, id: 'same-id' },
      { name: '', widthMm: 2000, depthMm: 2000, heightMm: 2400 },
      { name: 'Tall', widthMm: 2000, depthMm: 2000, heightMm: 9000 },
    ] });
    assert.deepStrictEqual(config.presets.map((p) => p.name), ['A', 'B']);
    assert.strictEqual(new Set(config.presets.map((p) => p.id)).size, 2);
    assert.ok(errors.some((e) => /needs a name/i.test(e)));
    assert.ok(errors.some((e) => /Tall: height must be between 2000 and 3200/i.test(e)), errors.join(' | '));
    assert.ok(validateConfig({ presets: new Array(9).fill({ name: 'x', widthMm: 2000, depthMm: 2000, heightMm: 2400 }) }).config.presets.length <= 6);
    assert.deepStrictEqual(validateConfig({ presets: [] }).config.presets, []); // an empty list is allowed: no starting rooms shown
  });

  await t('text is cleaned: control characters and long text cut, never an object', () => {
    const { config } = validateConfig({ promise: 'Hello\u0000\n  world ' + 'x'.repeat(500), pricing: { note: 'ok\u0007' } });
    assert.ok(config.promise.startsWith('Hello world'));
    assert.ok(config.promise.length <= 200);
    assert.strictEqual(config.pricing.note, 'ok');
    assert.ok(typeof validateConfig({ promise: { a: 1 } }).config.promise === 'string');
  });

  await t('garbage in gives the defaults back, not a crash', () => {
    for (const junk of ['text', 42, [], null, { rack: 'x', doors: [], pricing: 7, presets: 'no' }]) {
      const { config } = validateConfig(junk);
      assert.strictEqual(config.rack.unitWidthMm, 600);
      assert.ok(Array.isArray(config.presets));
    }
  });

  await t('publicView hides every amount unless showing prices is switched on', () => {
    const priced = validateConfig({ pricing: { show: false, perUnit: 900, fixed: 5000 } }).config;
    assert.strictEqual(priced.pricing.perUnit, 900);
    const shown = publicView(priced);
    assert.strictEqual(shown.pricing.perUnit, null);
    assert.strictEqual(shown.pricing.fixed, null);
    assert.strictEqual(publicView(validateConfig({ pricing: { show: true, perUnit: 900 } }).config).pricing.perUnit, 900);
  });

  const pool = fakePool();
  let clock = 1000;
  const s = await serve(pool, () => clock);

  await t('public endpoint: readable from any website, short cache, JSON, defaults when nothing is saved', async () => {
    const r = await call(s, 'GET', '/api/cellar-lite/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    assert.match(r.headers['cache-control'], /max-age=60/);
    assert.match(r.headers['content-type'], /json/);
    assert.strictEqual(r.json.rack.unitWidthMm, 600);
  });

  await t('public endpoint: answers the browser\'s preflight, refuses everything but reading', async () => {
    assert.strictEqual((await call(s, 'OPTIONS', '/api/cellar-lite/config')).status, 204);
    assert.strictEqual((await call(s, 'POST', '/api/cellar-lite/config', {})).status, 405);
    assert.strictEqual((await call(s, 'DELETE', '/api/cellar-lite/config')).status, 405);
  });

  await t('admin save: stores the settings, the public endpoint then serves them', async () => {
    const put = await call(s, 'PUT', '/api/admin/cellar-lite/config', { config: { rack: { unitWidthMm: 800 }, pricing: { show: true, perUnit: 1500, fixed: 4000, rangePct: 10 } } });
    assert.strictEqual(put.status, 200, put.body);
    assert.ok(pool.rows.has(KEY));
    clock += 31 * 1000; // past the 30 s cache, in case
    const r = await call(s, 'GET', '/api/cellar-lite/config');
    assert.strictEqual(r.json.rack.unitWidthMm, 800);
    assert.strictEqual(r.json.pricing.perUnit, 1500);
    assert.strictEqual(r.json.pricing.rangePct, 10);
  });

  await t('admin save clears the cache straight away (no 30 s wait to see a change)', async () => {
    await call(s, 'GET', '/api/cellar-lite/config');
    await call(s, 'PUT', '/api/admin/cellar-lite/config', { config: { rack: { unitWidthMm: 900 } } });
    assert.strictEqual((await call(s, 'GET', '/api/cellar-lite/config')).json.rack.unitWidthMm, 900);
  });

  await t('public endpoint reads the database once per 30 seconds, not per visitor', async () => {
    const before = pool.calls.select;
    for (let i = 0; i < 5; i++) await call(s, 'GET', '/api/cellar-lite/config');
    assert.ok(pool.calls.select - before <= 1, `selects: ${pool.calls.select - before}`);
  });

  await t('admin save refuses bad values with the reasons, and stores nothing', async () => {
    const before = pool.rows.get(KEY);
    const r = await call(s, 'PUT', '/api/admin/cellar-lite/config', { config: { rack: { unitWidthMm: 5 }, pricing: { perUnit: -1 } } });
    assert.strictEqual(r.status, 400);
    assert.ok(r.json.errors.length >= 2);
    assert.strictEqual(pool.rows.get(KEY), before);
    assert.strictEqual((await call(s, 'PUT', '/api/admin/cellar-lite/config', {})).status, 400);
    assert.strictEqual((await call(s, 'PUT', '/api/admin/cellar-lite/config', { config: 'x' })).status, 400);
  });

  await t('admin read returns the settings, the defaults and any warnings about stored values', async () => {
    pool.rows.set(KEY, JSON.stringify({ rack: { unitWidthMm: 9999 } })); // damaged by hand
    const r = await call(s, 'GET', '/api/admin/cellar-lite/config');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.config.rack.unitWidthMm, 600);
    assert.strictEqual(r.json.defaults.rack.unitWidthMm, 600);
    assert.ok(r.json.warnings.length >= 1);
  });

  await t('admin reset removes the stored value and returns the defaults', async () => {
    const r = await call(s, 'DELETE', '/api/admin/cellar-lite/config');
    assert.strictEqual(r.status, 200);
    assert.ok(!pool.rows.has(KEY));
    assert.strictEqual(r.json.config.rack.unitWidthMm, 600);
  });

  await t('a database failure gives the public tool a plain 503 (it then uses its built-in defaults)', async () => {
    const broken = await serve({ query: async () => { throw new Error('db down'); } }, () => 1);
    const r = await call(broken, 'GET', '/api/cellar-lite/config');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.headers['access-control-allow-origin'], '*'); // so the browser can read the 503 too
    broken.close();
  });

  await t('the real mount: public route is before the login, the admin route is behind requireAdmin', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    const pub = src.indexOf("'/api/cellar-lite/config'"), auth = src.indexOf("app.use('/api', requireAuth)");
    const adm = src.indexOf("'/api/admin/cellar-lite/config'"), generic = src.indexOf("app.use('/api/admin', requireAdmin");
    assert.ok(pub > 0 && pub < auth, 'public config route must be mounted before requireAuth');
    assert.ok(adm > auth && adm < generic, 'admin config route must come after requireAuth and before the generic admin router');
    assert.match(src.slice(adm - 10, adm + 120), /requireAdmin/);
  });

  s.close();
  console.log(process.exitCode ? '\nSome checks FAILED' : `\nAll ${passed} checks passed`);
})();
