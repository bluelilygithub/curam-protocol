#!/usr/bin/env node
/**
 * Cellar Planner LITE "Photo" service. It spends money per photo, so the point of these checks is what it REFUSES and that the AI service is never
 * called when it should not be: off, bad input, repeats, per-visitor limit, daily cap, too many at once, a wrong host in the answer.
 * In-memory stand-ins for the database and the AI service. Run: node server/routes/cellarLitePhoto.test.js   (or npm run test:cellar-lite-photo)
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createCellarLitePhotoRouter, buildPrompt, parseImage, MAX_INFLIGHT } = require('./cellarLitePhotoRouter');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.message); process.exitCode = 1; } };

// a tiny but valid-looking JPEG and PNG: the right first bytes, padded past the minimum size
const pad = (head, n = 6000, seed = 1) => Buffer.concat([Buffer.from(head), Buffer.alloc(n, seed)]);
const jpeg = (seed = 1) => `data:image/jpeg;base64,${pad([0xff, 0xd8, 0xff, 0xe0], 6000, seed).toString('base64')}`;
const png = `data:image/png;base64,${pad([0x89, 0x50, 0x4e, 0x47], 6000).toString('base64')}`;
const goodBody = (over = {}) => ({ design: 'CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ', finish: 'oak', door: 'single', image: jpeg(), ...over });

function fakePool() {
  const photos = new Map(); // key -> { mime, data, createdAt }
  return {
    photos,
    async query(sql, p = []) {
      if (/SELECT mime, data FROM cellar_lite_photos/.test(sql)) return { rows: photos.has(p[0]) ? [{ mime: photos.get(p[0]).mime, data: photos.get(p[0]).data }] : [] };
      if (/SELECT 1 FROM cellar_lite_photos/.test(sql)) return { rows: photos.has(p[0]) ? [{ '?column?': 1 }] : [] };
      if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: photos.size }] };
      if (/^\s*INSERT INTO cellar_lite_photos/.test(sql)) { if (!photos.has(p[0])) photos.set(p[0], { mime: p[1], data: p[2], createdAt: Date.now() }); return { rows: [] }; }
      if (/^\s*DELETE FROM cellar_lite_photos/.test(sql)) return { rows: [] };
      throw new Error('unexpected sql: ' + sql);
    },
  };
}

/** A stand-in for FAL: records every call, answers with a picture the router will download. */
function fakeFal(opts = {}) {
  const calls = [];
  const picture = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5000, 7)]);
  const fetchFn = async (url, init = {}) => {
    if (String(url).startsWith('https://fal.run/')) {
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) return { ok: false, status: 500, json: async () => ({ detail: 'boom' }) };
      if (opts.noImage) return { ok: true, status: 200, json: async () => ({ images: [] }) };
      return { ok: true, status: 200, json: async () => ({ images: [{ url: opts.imageUrl || 'https://v3.fal.media/files/abc/result.jpg' }] }) };
    }
    calls.push({ download: String(url) });
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => picture.buffer.slice(picture.byteOffset, picture.byteOffset + picture.length) };
  };
  return { fetchFn, calls, picture };
}

function serve({ cfg, fal, pool = fakePool(), key = 'test-key', clock = { t: 1_000_000 }, reports = [] }) {
  const router = createCellarLitePhotoRouter({
    pool, loadConfig: async () => ({ photo: cfg }), fetchFn: fal.fetchFn, falKey: () => key, now: () => clock.t,
    report: async (title, body) => { reports.push({ title, body }); },
  });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/photo', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve({ s, pool, clock, reports })); });
}
const send = (s, method, path, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = http.request({ port: s.address().port, path, method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString()); } catch { /* binary */ } resolve({ status: res.statusCode, headers: res.headers, json, raw }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const ON = { enabled: true, dailyLimit: 50, perVisitorPerHour: 3 };

(async () => {
  await t('the prompt is built only from fixed words: a finish and a door, never visitor text', () => {
    const p = buildPrompt('walnut', 'double');
    assert.match(p, /dark walnut timber racking/); assert.match(p, /a pair of clear glass doors/);
    assert.match(p, /same layout/); assert.match(p, /No people, no text/);
    assert.notStrictEqual(buildPrompt('oak', 'single'), buildPrompt('black', 'single'));
  });

  await t('the picture check: a real JPEG or PNG of a sensible size passes; everything else is refused', () => {
    assert.ok(parseImage(jpeg()).bytes); assert.ok(parseImage(png).bytes);
    for (const bad of [undefined, null, 42, '', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,AAAA', 'data:image/jpeg;base64,!!!', jpeg().replace('image/jpeg', 'image/png'), png.replace('image/png', 'image/jpeg'),
      `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString('base64')}`, // far too small
      `data:image/jpeg;base64,${pad([0xff, 0xd8, 0xff], 700 * 1024).toString('base64')}`]) { // too big
      assert.ok(parseImage(bad).error, String(bad).slice(0, 40));
    }
  });

  let ctx;
  await t('OFF: refuses, and the AI service is never called', async () => {
    const fal = fakeFal(); ctx = await serve({ cfg: { ...ON, enabled: false }, fal });
    const r = await send(ctx.s, 'POST', '/photo', goodBody());
    assert.strictEqual(r.status, 403); assert.strictEqual(r.json.code, 'off');
    assert.strictEqual(fal.calls.length, 0); ctx.s.close();
  });

  await t('bad requests are refused before any spend: odd design codes, unknown finish or door, bad pictures', async () => {
    const fal = fakeFal(); ctx = await serve({ cfg: ON, fal });
    for (const over of [{ design: 'hello' }, { design: 'CL1.abc def' }, { design: 'CL1.' + 'a'.repeat(300) }, { design: 5 }, { finish: 'gold' }, { finish: undefined }, { door: 'triple' }, { door: '__proto__' }, { image: undefined }, { image: 'data:image/jpeg;base64,AAAA' }, { finish: 'constructor' }]) {
      const r = await send(ctx.s, 'POST', '/photo', goodBody(over));
      assert.strictEqual(r.status, 400, JSON.stringify(over).slice(0, 60));
    }
    assert.strictEqual((await send(ctx.s, 'POST', '/photo', undefined)).status, 400);
    assert.strictEqual(fal.calls.length, 0); ctx.s.close();
  });

  await t('a good request makes one photo: calls the service once, with our prompt, stores it, answers with its address', async () => {
    const fal = fakeFal(); ctx = await serve({ cfg: ON, fal });
    const r = await send(ctx.s, 'POST', '/photo', goodBody({ finish: 'walnut', door: 'double' }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.key, /^[a-f0-9]{40}$/); assert.strictEqual(r.json.cached, false); assert.strictEqual(r.json.url, `/api/cellar-lite/photo/${r.json.key}`);
    const call = fal.calls.find((c) => c.body);
    assert.strictEqual(call.url, 'https://fal.run/fal-ai/flux-pro/kontext');
    assert.strictEqual(call.headers.Authorization, 'Key test-key');
    assert.strictEqual(call.body.prompt, buildPrompt('walnut', 'double'));
    assert.match(call.body.image_url, /^data:image\/jpeg;base64,/);
    assert.strictEqual(ctx.pool.photos.size, 1);
    ctx.last = r.json;
  });

  await t('the stored picture is served to anyone: right type, kept for a year, embeddable from the business\'s site', async () => {
    const g = await send(ctx.s, 'GET', ctx.last.url.replace('/api/cellar-lite', ''));
    assert.strictEqual(g.status, 200); assert.strictEqual(g.headers['content-type'], 'image/jpeg');
    assert.match(g.headers['cache-control'], /max-age=31536000.*immutable/); assert.strictEqual(g.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.strictEqual(g.raw[0], 0xff); assert.ok(g.raw.length > 5000);
  });

  await t('the same design and picture again: remembered, no new call, no limit used', async () => {
    const before = ctx.pool.photos.size;
    // use up the visitor's limit first would be unfair: a repeat must still work even when they are at their limit
    const r = await send(ctx.s, 'POST', '/photo', goodBody({ finish: 'walnut', door: 'double' }));
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.cached, true); assert.strictEqual(r.json.key, ctx.last.key);
    assert.strictEqual(ctx.pool.photos.size, before);
    ctx.s.close();
  });

  await t('a different picture or finish for the same design is a different photo', async () => {
    const fal = fakeFal(); ctx = await serve({ cfg: ON, fal });
    const a = await send(ctx.s, 'POST', '/photo', goodBody());
    const b = await send(ctx.s, 'POST', '/photo', goodBody({ finish: 'black' }));
    const c = await send(ctx.s, 'POST', '/photo', goodBody({ image: jpeg(2) }));
    assert.strictEqual(new Set([a.json.key, b.json.key, c.json.key]).size, 3);
    assert.strictEqual(fal.calls.filter((x) => x.body).length, 3); ctx.s.close();
  });

  await t('per-visitor limit: the next photo is refused politely, another visitor is unaffected, and it frees up after an hour', async () => {
    const fal = fakeFal(); const clock = { t: 5_000_000 }; ctx = await serve({ cfg: { ...ON, perVisitorPerHour: 2 }, fal, clock });
    const as = (ip, seed) => send(ctx.s, 'POST', '/photo', goodBody({ image: jpeg(seed) }), { 'x-forwarded-for': ip });
    assert.strictEqual((await as('1.1.1.1', 1)).status, 200);
    assert.strictEqual((await as('1.1.1.1', 2)).status, 200);
    const third = await as('1.1.1.1', 3);
    assert.strictEqual(third.status, 429); assert.strictEqual(third.json.code, 'limit-visitor'); assert.match(third.json.error, /try again in a little while/i);
    assert.strictEqual((await as('2.2.2.2', 4)).status, 200);
    clock.t += 61 * 60 * 1000;
    assert.strictEqual((await as('1.1.1.1', 5)).status, 200);
    assert.strictEqual(fal.calls.filter((x) => x.body).length, 4, 'the refused one never reached the AI service'); ctx.s.close();
  });

  await t('daily cap: when it is reached, visitors are told tomorrow, the owner is told, and nothing more is spent', async () => {
    const fal = fakeFal(); const reports = []; ctx = await serve({ cfg: { ...ON, dailyLimit: 2, perVisitorPerHour: 30 }, fal, reports });
    const go = (seed) => send(ctx.s, 'POST', '/photo', goodBody({ image: jpeg(seed) }), { 'x-forwarded-for': `9.9.9.${seed}` });
    assert.strictEqual((await go(1)).status, 200); assert.strictEqual((await go(2)).status, 200);
    const r = await go(3);
    assert.strictEqual(r.status, 429); assert.strictEqual(r.json.code, 'limit-day'); assert.match(r.json.error, /try again tomorrow/i);
    assert.strictEqual(fal.calls.filter((x) => x.body).length, 2);
    assert.ok(reports.some((x) => /daily limit reached/i.test(x.title)), 'the owner is told');
    // a repeat of an existing photo still works at the cap
    assert.strictEqual((await go(1)).json.cached, true);
    ctx.s.close();
  });

  await t('a daily cap of 0 refuses everything new (a quick way to pause spending)', async () => {
    const fal = fakeFal(); ctx = await serve({ cfg: { ...ON, dailyLimit: 0 }, fal });
    assert.strictEqual((await send(ctx.s, 'POST', '/photo', goodBody())).status, 429);
    assert.strictEqual(fal.calls.length, 0); ctx.s.close();
  });

  await t('the service failing: a plain 503, the owner is told, and the visitor\'s slot is given back', async () => {
    const fal = fakeFal({ fail: true }); const reports = []; ctx = await serve({ cfg: { ...ON, perVisitorPerHour: 1 }, fal, reports });
    const r = await send(ctx.s, 'POST', '/photo', goodBody(), { 'x-forwarded-for': '3.3.3.3' });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.code, 'failed'); assert.match(r.json.error, /try again/i);
    assert.ok(reports.some((x) => /could not be made/i.test(x.title)));
    assert.strictEqual(ctx.pool.photos.size, 0);
    // the failed attempt did not use up their one photo
    const fal2 = fakeFal(); ctx.s.close();
    ctx = await serve({ cfg: { ...ON, perVisitorPerHour: 1 }, fal: fal2 });
    assert.strictEqual((await send(ctx.s, 'POST', '/photo', goodBody(), { 'x-forwarded-for': '3.3.3.3' })).status, 200); ctx.s.close();
  });

  await t('the service sending no picture (its safety check refused) is a plain failure, nothing stored', async () => {
    ctx = await serve({ cfg: ON, fal: fakeFal({ noImage: true }) });
    assert.strictEqual((await send(ctx.s, 'POST', '/photo', goodBody())).status, 503); assert.strictEqual(ctx.pool.photos.size, 0); ctx.s.close();
  });

  await t('the picture is only ever fetched from the image service\'s own hosts, over https', async () => {
    for (const imageUrl of ['https://evil.example.com/x.jpg', 'http://v3.fal.media/x.jpg', 'https://fal.media.evil.com/x.jpg', 'file:///etc/passwd', 'https://169.254.169.254/latest/meta-data']) {
      const fal = fakeFal({ imageUrl }); ctx = await serve({ cfg: ON, fal });
      const r = await send(ctx.s, 'POST', '/photo', goodBody());
      assert.strictEqual(r.status, 503, imageUrl); assert.strictEqual(fal.calls.filter((c) => c.download).length, 0, 'never downloaded ' + imageUrl); assert.strictEqual(ctx.pool.photos.size, 0); ctx.s.close();
    }
  });

  await t('the service may answer with the picture inline (a data address): accepted', async () => {
    const fal = fakeFal({ imageUrl: 'data:image/jpeg;base64,/9j/AAAA' }); ctx = await serve({ cfg: ON, fal });
    assert.strictEqual((await send(ctx.s, 'POST', '/photo', goodBody())).status, 200); ctx.s.close();
  });

  await t('no AI key on the server: a plain refusal, and the owner is told why', async () => {
    const reports = []; ctx = await serve({ cfg: ON, fal: fakeFal(), key: '', reports });
    const r = await send(ctx.s, 'POST', '/photo', goodBody());
    assert.strictEqual(r.status, 503); assert.ok(reports.some((x) => /no image key/i.test(x.title))); ctx.s.close();
  });

  await t(`at most ${MAX_INFLIGHT} photos are made at once: the next is told to wait, and the others finish`, async () => {
    const fal = fakeFal({ delayMs: 250 }); ctx = await serve({ cfg: { ...ON, perVisitorPerHour: 30, dailyLimit: 500 }, fal });
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => send(ctx.s, 'POST', '/photo', goodBody({ image: jpeg(i + 10) }), { 'x-forwarded-for': `7.7.7.${i}` })));
    const ok = rs.filter((r) => r.status === 200).length, busy = rs.filter((r) => r.json && r.json.code === 'busy').length;
    assert.strictEqual(ok, MAX_INFLIGHT); assert.strictEqual(busy, 5 - MAX_INFLIGHT); ctx.s.close();
  });

  await t('it can be called from another website (CORS), answers the preflight, and never caches an answer', async () => {
    ctx = await serve({ cfg: ON, fal: fakeFal() });
    const pre = await send(ctx.s, 'OPTIONS', '/photo');
    assert.strictEqual(pre.status, 204); assert.strictEqual(pre.headers['access-control-allow-origin'], '*'); assert.match(pre.headers['access-control-allow-headers'], /content-type/);
    const r = await send(ctx.s, 'POST', '/photo', goodBody());
    assert.strictEqual(r.headers['access-control-allow-origin'], '*'); assert.strictEqual(r.headers['cache-control'], 'no-store');
    ctx.s.close();
  });

  await t('asking for an image: unknown or malformed keys are a plain 404', async () => {
    ctx = await serve({ cfg: ON, fal: fakeFal() });
    for (const k of ['abc', 'a'.repeat(40), '../../etc/passwd', 'A'.repeat(40), '%00']) assert.strictEqual((await send(ctx.s, 'GET', '/photo/' + k)).status, 404, k);
    ctx.s.close();
  });

  await t('the real mount: the public photo route is mounted before the login, and the table is created on boot', () => {
    const fs = require('fs'); const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const photo = src.indexOf("'/api/cellar-lite/photo'"), auth = src.indexOf("app.use('/api', requireAuth)"), json = src.indexOf('express.json(');
    assert.ok(photo > json && photo < auth, 'photo route after the body parser and before requireAuth');
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8'), /CREATE TABLE IF NOT EXISTS cellar_lite_photos/);
  });

  console.log(process.exitCode ? '\nSome checks FAILED' : `\nAll ${passed} checks passed`);
  process.exit(process.exitCode || 0); // a failed check can leave a test server open: do not hang
})();
