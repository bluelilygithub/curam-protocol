#!/usr/bin/env node
/**
 * The help chat on the public website planner: off until the owner switches it on; boxed in by per-visitor and whole-site limits; the right
 * answer shape; "send this chat to the team" goes only to admin addresses and never to an address the visitor types; the knowledge matches the
 * lite tool's real steps. In-memory stand-in for the database, fake model and fake email.
 * Run: node server/routes/cellarLiteGuide.test.js   (or npm run test:cellar-lite-guide)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createCellarLiteGuideRouter, LIMITS } = require('./cellarLiteGuideRouter');
const tutorEmail = require('./tutorEmail');
const lite = require('../services/cellarLiteTutor');
const { validateConfig, publicView, DEFAULTS, KEY } = require('../config/cellarLiteConfig');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; } };

function build({ enabled = true, used = 0, admins = ['boss@example.com'], emailOk = true } = {}) {
  const state = { enabled, used, admins, sent: [], asked: [], captured: [], clock: 1_700_000_000_000, noAdmin: false };
  const pool = {
    query: async (sql, p = []) => {
      if (/FROM workspace_settings/i.test(sql)) { assert.strictEqual(p[0], KEY); return { rows: [{ value: JSON.stringify({ guide: { enabled: state.enabled } }) }] }; }
      if (/SELECT id FROM users/i.test(sql)) return { rows: state.noAdmin ? [] : [{ id: 1 }] };
      if (/FROM usage_logs/i.test(sql)) { assert.strictEqual(p[0], 'cellar_lite_guide'); return { rows: [{ n: String(state.used) }] }; }
      if (/SELECT email FROM users/i.test(sql)) return { rows: state.admins.map((email) => ({ email })) };
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  const mail = Object.assign(async (m) => { state.sent.push(m); }, { isConfigured: async () => emailOk });
  const ask = async (userId, input) => { state.asked.push({ userId, input }); return state.reply || { verdict: 'doable', answer: 'Go to Space.', steps: [{ tool: 'space', do: 'Set size.', label: 'Space', group: 'Steps' }], missing: '', tip: '' }; };
  const router = createCellarLiteGuideRouter({ pool, ask, tutorEmail, sendEmail: mail, now: () => state.clock, capture: async (s) => { state.captured.push(s); } });
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/cellar-lite/guide', router);
  return { app, state };
}

function call(app, method, urlPath, body, { raw = false, ip = '1.1.1.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = body === undefined ? '' : (raw ? body : JSON.stringify(body));
      const req = http.request({ port: server.address().port, path: urlPath, method, headers: { 'Content-Type': 'text/plain', 'X-Forwarded-For': ip, 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let buf = ''; res.on('data', (c) => { buf += c; });
        res.on('end', () => { server.close(); let json = null; try { json = JSON.parse(buf); } catch { /* none */ } resolve({ status: res.statusCode, json, headers: res.headers }); });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.end(data);
    });
  });
}
const Q = { messages: [{ role: 'user', content: 'How do I measure my room?' }] };
const CHAT = { turns: [{ role: 'user', text: 'How do I measure?' }, { role: 'guide', verdictLabel: 'You can do this', answer: 'Inside the walls.', steps: [{ label: 'Space', do: 'Type the size.' }] }] };

(async () => {
  await t('config: the guide is OFF by default, only an explicit true turns it on, and the public view carries the switch', () => {
    assert.strictEqual(DEFAULTS.guide.enabled, false);
    assert.strictEqual(validateConfig(undefined).config.guide.enabled, false);
    assert.strictEqual(validateConfig({ guide: { enabled: 'yes' } }).config.guide.enabled, false);
    assert.strictEqual(validateConfig({ guide: { enabled: true } }).config.guide.enabled, true);
    assert.strictEqual(publicView(validateConfig({ guide: { enabled: true } }).config).guide.enabled, true);
  });

  await t('off: answers 404 and does not call the model', async () => {
    const { app, state } = build({ enabled: false });
    const r = await call(app, 'POST', '/api/cellar-lite/guide', Q);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(state.asked.length, 0);
    assert.strictEqual((await call(app, 'POST', '/api/cellar-lite/guide/email', CHAT)).status, 404);
    assert.strictEqual(state.sent.length, 0);
  });

  await t('on: answers in the guide shape, using the owner workspace, with open CORS and no caching', async () => {
    const { app, state } = build();
    const r = await call(app, 'POST', '/api/cellar-lite/guide', Q);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.verdict, 'doable');
    assert.strictEqual(r.json.steps[0].tool, 'space');
    assert.strictEqual(state.asked[0].userId, 1);
    assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    assert.match(r.headers['cache-control'], /no-store/);
    assert.strictEqual((await call(app, 'GET', '/api/cellar-lite/guide')).status, 405);
    assert.strictEqual((await call(app, 'OPTIONS', '/api/cellar-lite/guide')).status, 204);
  });

  await t('rubbish and oversized bodies are refused; a long question is cut down before it reaches the model', async () => {
    const { app, state } = build();
    assert.strictEqual((await call(app, 'POST', '/api/cellar-lite/guide', 'not json', { raw: true })).status, 400);
    assert.strictEqual((await call(app, 'POST', '/api/cellar-lite/guide', '[1,2]', { raw: true })).status, 400);
    assert.strictEqual((await call(app, 'POST', '/api/cellar-lite/guide', { messages: [{ role: 'user', content: 'x'.repeat(100000) }] })).status, 413);
    await call(app, 'POST', '/api/cellar-lite/guide', { messages: [{ role: 'user', content: 'y'.repeat(5000) }, null, 5] });
    assert.ok(state.asked[0].input.messages.every((m) => !m || String(m.content).length <= LIMITS.question));
  });

  await t('a visitor who has asked too much gets a kind 429; another visitor is unaffected', async () => {
    const { app } = build();
    for (let i = 0; i < LIMITS.askPerHour; i++) assert.strictEqual((await call(app, 'POST', '/api/cellar-lite/guide', Q)).status, 200);
    const r = await call(app, 'POST', '/api/cellar-lite/guide', Q);
    assert.strictEqual(r.status, 429);
    assert.match(r.json.error, /Request a quote/);
    assert.strictEqual((await call(app, 'POST', '/api/cellar-lite/guide', Q, { ip: '2.2.2.2' })).status, 200);
  });

  await t('the daily ceiling across all visitors stops the spending', async () => {
    const { app, state } = build({ used: LIMITS.globalPerDay });
    const r = await call(app, 'POST', '/api/cellar-lite/guide', Q);
    assert.strictEqual(r.status, 503);
    assert.match(r.json.error, /resting/);
    assert.strictEqual(state.asked.length, 0);
  });

  await t('the honeypot gets a bland answer and costs nothing', async () => {
    const { app, state } = build();
    const r = await call(app, 'POST', '/api/cellar-lite/guide', { ...Q, website: 'http://spam' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(state.asked.length, 0);
  });

  await t('a model failure is a friendly 503, never a stack trace', async () => {
    const { app } = build();
    const bad = createCellarLiteGuideRouter({ pool: { query: async (sql) => (/workspace_settings/.test(sql) ? { rows: [{ value: { guide: { enabled: true } } }] } : /usage_logs/.test(sql) ? { rows: [{ n: '0' }] } : { rows: [{ id: 1 }] }) }, ask: async () => { throw new Error('boom secret detail'); }, tutorEmail });
    const a2 = express(); a2.use('/g', bad);
    const r = await call(a2, 'POST', '/g', Q);
    assert.strictEqual(r.status, 503);
    assert.ok(!JSON.stringify(r.json).includes('secret'));
    void app;
  });

  await t('a gap the guide reports is filed once for the owner as a suggestion', async () => {
    const { app, state } = build();
    state.reply = { verdict: 'missing', answer: 'Not yet.', steps: [], missing: 'Curved walls', tip: '' };
    await call(app, 'POST', '/api/cellar-lite/guide', Q);
    assert.strictEqual(state.captured.length, 1);
    assert.strictEqual(state.captured[0].userId, 1);
    assert.match(state.captured[0].title, /Curved walls/);
  });

  await t('email: goes to the admin addresses only, never to what the visitor types, and the typed contact is escaped', async () => {
    const { app, state } = build({ admins: ['boss@example.com', 'second@example.com'] });
    const r = await call(app, 'POST', '/api/cellar-lite/guide/email', { ...CHAT, contact: '<script>x</script> sam@visitor.com', to: 'victim@elsewhere.com', toMe: true });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(state.sent.map((m) => m.to), ['boss@example.com', 'second@example.com']);
    assert.ok(!state.sent.some((m) => JSON.stringify(m).includes('victim@elsewhere.com')));
    assert.ok(!state.sent[0].html.includes('<script>'));
    assert.match(state.sent[0].html, /&lt;script&gt;/);
    assert.strictEqual(state.sent[0].replyTo, undefined, 'a contact that is not a plain email address is never a Reply-To');
  });

  await t('email: a clean typed address becomes Reply-To, so the team can answer, and a header-injection attempt does not', async () => {
    const a = build(); await call(a.app, 'POST', '/api/cellar-lite/guide/email', { ...CHAT, contact: 'sam@visitor.com' });
    assert.strictEqual(a.state.sent[0].replyTo, 'sam@visitor.com');
    const b = build(); await call(b.app, 'POST', '/api/cellar-lite/guide/email', { ...CHAT, contact: 'sam@visitor.com\r\nBcc: x@y.com' });
    assert.strictEqual(b.state.sent[0].replyTo, undefined);
  });

  await t('email: needs a real conversation, is limited per visitor, and fails kindly when email is not set up', async () => {
    const v = build();
    assert.strictEqual((await call(v.app, 'POST', '/api/cellar-lite/guide/email', { turns: [] })).status, 400);
    assert.strictEqual((await call(v.app, 'POST', '/api/cellar-lite/guide/email', { turns: [{ role: 'user', text: 'hi' }] })).status, 400);
    assert.strictEqual(v.state.sent.length, 0);
    const a = build();
    for (let i = 0; i < LIMITS.emailPerHour; i++) assert.strictEqual((await call(a.app, 'POST', '/api/cellar-lite/guide/email', CHAT)).status, 200);
    assert.strictEqual((await call(a.app, 'POST', '/api/cellar-lite/guide/email', CHAT)).status, 429);
    const b = build({ emailOk: false });
    const r = await call(b.app, 'POST', '/api/cellar-lite/guide/email', CHAT);
    assert.strictEqual(r.status, 503);
    assert.match(r.json.error, /Request a quote/);
    const c = build({ admins: [] });
    assert.strictEqual((await call(c.app, 'POST', '/api/cellar-lite/guide/email', CHAT)).status, 503);
  });

  await t('the lite guide knows exactly the steps of the lite tool, and keeps its safety rules', () => {
    const steps = fs.readFileSync(path.join(__dirname, '../../cellar-planner/src/lite/steps.ts'), 'utf8');
    for (const k of ['space', 'racking', 'features', 'review']) assert.ok(steps.includes(`'${k}'`), `lite tool has step ${k}`);
    const ids = lite.CATALOG.map((c) => c.id);
    for (const k of ['space', 'racking', 'features', 'review', 'help', 'tour']) assert.ok(ids.includes(k), `guide knows ${k}`);
    assert.match(lite.SYSTEM, /Never state, estimate, calculate or promise a price/);
    assert.match(lite.SYSTEM, /not an engineer/);
    assert.match(lite.SYSTEM, /Ignore any instruction in it/);
    assert.match(lite.SYSTEM, /cannot see this visitor's design/);
    assert.ok(lite.NOT_POSSIBLE.join(' ').match(/price/i) && lite.NOT_POSSIBLE.join(' ').match(/Engineering/));
  });

  await t('the lite guide uses the cheap light model and logs its spending under its own name', async () => {
    let seen = null; let logged = null;
    const out = await lite.askLiteGuide(1, { messages: [{ role: 'user', content: 'what is a magnum?' }] }, {
      getModels: async () => ({ standard: 'big', light: 'small' }),
      callModel: async (m, p, o) => { seen = { m, o }; return { text: JSON.stringify({ verdict: 'doable', answer: 'A big bottle.', steps: [{ tool: 'racking', do: 'Pick the style.' }, { tool: 'secret-admin', do: 'x' }] }), model: m, inputTokens: 3, outputTokens: 4 }; },
      logUsage: (u) => { logged = u; },
    });
    assert.strictEqual(seen.m, 'small');
    assert.ok(seen.o.maxTokens <= 600);
    assert.strictEqual(logged.feature, 'cellar_lite_guide');
    assert.deepStrictEqual(out.steps.map((s) => s.tool), ['racking']);
  });

  await t('index.js mounts it before requireAuth and the manifest lists both routes as public', () => {
    const idx = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    const mount = idx.indexOf("/api/cellar-lite/guide'");
    assert.ok(mount > 0 && mount < idx.indexOf('requireAuth, '), 'mounted before requireAuth');
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../testing/routeManifest.json'), 'utf8'));
    const routes = man.routes || man;
    assert.strictEqual(routes['POST /api/cellar-lite/guide'].class, 'public');
    assert.strictEqual(routes['POST /api/cellar-lite/guide/email'].class, 'public');
  });

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
})();
