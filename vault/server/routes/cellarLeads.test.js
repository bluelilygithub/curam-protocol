#!/usr/bin/env node
/**
 * Cellar Planner enquiries: what the public endpoint accepts and refuses, that it puts the person and a deal into the CRM (new or existing client),
 * the spam guards (honeypot, per-visitor limit, daily ceiling, duplicates), that a failure part-way leaves nothing half-written, and that the staff
 * routes only ever show a user their own enquiries. Uses an in-memory stand-in for the database.
 * Run: node server/routes/cellarLeads.test.js   (or npm run test:cellar-leads)
 */
'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const { createCellarLeadsRouters, validateEnquiry, LIMITS } = require('./cellarLeadsRouter');

let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e) { console.log('FAIL ', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; } };

const CODE = 'CL1.WzI3NTAsMTU2NSwyMTUwLDIsMCwwLDUwMCwwXQ';
const GOOD = { name: 'Sam Rivera', email: 'Sam@Example.com', phone: '0412 345 678', message: 'Hello\nthere', code: CODE, summary: '2750 x 1565 mm, single door', bottles: 840, priceText: '$7,100 to $8,700' };

/** An in-memory stand-in for pg: just the statements the routers run, found by their text. `fail` = a table name whose INSERT should throw. */
function fakePool({ admin = 1 } = {}) {
  const db = { leads: [], clients: [], contacts: [], deals: [], interactions: [] };
  const log = { begin: 0, commit: 0, rollback: 0, released: 0 };
  let nextId = 1;
  const state = { fail: null, clock: () => Date.now() };
  const q = async (sql, p = []) => {
    if (state.fail && new RegExp(`INSERT INTO ${state.fail}\\b`, 'i').test(sql)) throw new Error(`simulated failure on ${state.fail}`);
    if (/^\s*BEGIN/i.test(sql)) { log.begin++; db._snapshot = JSON.stringify(db); return { rows: [] }; }
    if (/^\s*COMMIT/i.test(sql)) { log.commit++; return { rows: [] }; }
    if (/^\s*ROLLBACK/i.test(sql)) { log.rollback++; const s = JSON.parse(db._snapshot); for (const k of Object.keys(s)) if (k !== '_snapshot') db[k] = s[k]; return { rows: [] }; }
    if (/FROM users WHERE "isAdmin"/i.test(sql)) return { rows: admin ? [{ id: admin }] : [] };
    if (/FROM cellar_leads WHERE "userId"=\$1 AND lower\(email\)=\$2/i.test(sql)) {
      const cutoff = state.clock() - Number(p[3]) * 3600e3;
      return { rows: db.leads.filter((l) => l.userId === p[0] && l.email.toLowerCase() === p[1] && l.designCode === p[2] && l.createdAt > cutoff).map((l) => ({ id: l.id })) };
    }
    if (/SELECT COUNT\(\*\) AS n FROM cellar_leads/i.test(sql)) return { rows: [{ n: String(db.leads.filter((l) => l.createdAt > state.clock() - 24 * 3600e3).length) }] };
    if (/INSERT INTO cellar_leads/i.test(sql)) {
      const l = { id: nextId++, userId: p[0], name: p[1], email: p[2], phone: p[3], message: p[4], designCode: p[5], summary: p[6], priceText: p[7], bottles: p[8], ipHash: p[9], status: 'new', clientId: null, dealId: null, createdAt: state.clock() };
      db.leads.push(l); return { rows: [{ id: l.id }] };
    }
    if (/FROM client_contacts cc JOIN clients c/i.test(sql)) {
      const hit = db.contacts.find((c) => c.email && c.email.toLowerCase() === p[1] && db.clients.find((x) => x.id === c.clientId && x.userId === p[0]));
      return { rows: hit ? [{ clientId: hit.clientId }] : [] };
    }
    if (/INSERT INTO clients/i.test(sql)) { const c = { id: nextId++, userId: p[0], name: p[1], status: 'prospect', tags: p[2], notes: p[3] }; db.clients.push(c); return { rows: [{ id: c.id }] }; }
    if (/INSERT INTO client_contacts/i.test(sql)) { db.contacts.push({ id: nextId++, clientId: p[0], name: p[1], email: p[2], phone: p[3] }); return { rows: [] }; }
    if (/INSERT INTO client_deals/i.test(sql)) { const d = { id: nextId++, userId: p[0], clientId: p[1], title: p[2], stage: 'lead', notes: p[3], value: null }; db.deals.push(d); return { rows: [{ id: d.id }] }; }
    if (/INSERT INTO client_interactions/i.test(sql)) { db.interactions.push({ clientId: p[0], userId: p[1], title: p[2], note: p[3], dealId: p[4] }); return { rows: [] }; }
    if (/UPDATE cellar_leads SET "clientId"/i.test(sql)) { const l = db.leads.find((x) => x.id === p[2]); l.clientId = p[0]; l.dealId = p[1]; return { rows: [] }; }
    // ---- staff
    if (/SELECT id, name, email, phone, summary.*FROM cellar_leads WHERE "userId"=\$1/is.test(sql)) return { rows: db.leads.filter((l) => l.userId === p[0]).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).slice(0, 50) };
    if (/SELECT \* FROM cellar_leads WHERE id=\$1 AND "userId"=\$2/i.test(sql)) return { rows: db.leads.filter((l) => l.id === p[0] && l.userId === p[1]) };
    if (/UPDATE cellar_leads SET status = CASE/i.test(sql)) { const l = db.leads.find((x) => x.id === p[0] && x.userId === p[1]); if (!l) return { rows: [] }; if (l.status === 'new') l.status = 'opened'; return { rows: [{ status: l.status }] }; }
    if (/SELECT id, "clientId", "dealId" FROM cellar_leads WHERE id=\$1 AND "userId"=\$2/i.test(sql)) return { rows: db.leads.filter((l) => l.id === p[0] && l.userId === p[1]) };
    if (/UPDATE cellar_leads SET status='quoted'/i.test(sql)) { db.leads.find((x) => x.id === p[0]).status = 'quoted'; return { rows: [] }; }
    if (/UPDATE client_deals SET value=\$1/i.test(sql)) { const d = db.deals.find((x) => x.id === p[1] && x.userId === p[2] && x.value === null); if (d) d.value = p[0]; return { rows: [], rowCount: d ? 1 : 0 }; }
    throw new Error('unexpected sql ' + sql.replace(/\s+/g, ' ').slice(0, 120));
  };
  return { db, log, state, query: q, async connect() { return { query: q, release() { log.released++; } }; } };
}

function serve(pool, { now, capture } = {}) {
  const { publicRouter, staffRouter } = createCellarLeadsRouters({ pool, now, capture, appUrl: () => 'https://vault.test' });
  const app = express();
  app.use('/api/cellar-lite/enquiry', publicRouter); // public: before the JSON parser, like the real mount
  app.use(express.json());
  app.use('/api/cellar-planner/leads', (req, res, next) => { req.user = { id: Number(req.headers['x-test-user'] || 1) }; next(); }, staffRouter);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
const call = (s, method, path, body, headers = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const r = http.request({ port: s.address().port, path, method, headers: { ...(data ? { 'content-type': typeof body === 'string' ? 'text/plain;charset=UTF-8' : 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, text: b }); });
  });
  r.on('error', reject); if (data) r.write(data); r.end();
});
const post = (s, body, headers) => call(s, 'POST', '/api/cellar-lite/enquiry', body, headers);

(async () => {
  // ------------------------------------------------------------ validation
  await t('a good enquiry is accepted and tidied (email lower-cased, control characters removed)', () => {
    const r = validateEnquiry({ ...GOOD, name: '  Sam\u0000 Rivera ', message: 'a\u0007b' });
    assert.ok(r.ok);
    assert.deepStrictEqual({ n: r.value.name, e: r.value.email, p: r.value.phone, m: r.value.message, b: r.value.bottles }, { n: 'Sam Rivera', e: 'sam@example.com', p: '0412 345 678', m: 'a b', b: 840 });
  });
  await t('refusals say why in plain words: name, email, design code', () => {
    const bad = (over) => validateEnquiry({ ...GOOD, ...over });
    assert.match(bad({ name: '  ' }).error, /name/i);
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', '<x>@c.com', 'a@b.c']) assert.match(bad({ email }).error, /email/i, email);
    for (const code of ['', 'x', 'CL1.', 'CL1.a b', 5, null, 'CL1.' + 'a'.repeat(300)]) assert.match(bad({ code }).error, /design code/i, String(code));
    for (const raw of [null, undefined, 'x', 7, [], [GOOD]]) assert.strictEqual(validateEnquiry(raw).ok, false);
  });
  await t('optional fields: a bad phone is dropped (not an error), bottles must be a sane count, lengths are capped', () => {
    assert.strictEqual(validateEnquiry({ ...GOOD, phone: 'call me' }).value.phone, '');
    assert.strictEqual(validateEnquiry({ ...GOOD, phone: '123' }).value.phone, '');
    assert.strictEqual(validateEnquiry({ ...GOOD, phone: '+61 3 9123 4567' }).value.phone, '+61 3 9123 4567');
    for (const bottles of [-1, 'x', 1e9, null, undefined]) assert.strictEqual(validateEnquiry({ ...GOOD, bottles }).value.bottles, null, String(bottles));
    const long = validateEnquiry({ ...GOOD, name: 'n'.repeat(500), message: 'm'.repeat(9000), summary: 's'.repeat(900), priceText: 'p'.repeat(500) }).value;
    assert.deepStrictEqual([long.name.length, long.message.length, long.summary.length, long.priceText.length], [LIMITS.name, LIMITS.message, LIMITS.summary, LIMITS.priceText]);
  });

  // ------------------------------------------------------------ the public endpoint
  await t('a new person: a prospect client with a primary contact, a lead deal carrying the design and the staff link, a timeline note', async () => {
    const pool = fakePool(); const s = await serve(pool);
    const r = await post(s, GOOD);
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json, { ok: true });
    const { db, log } = pool;
    assert.strictEqual(db.leads.length, 1); assert.strictEqual(db.clients.length, 1); assert.strictEqual(db.contacts.length, 1); assert.strictEqual(db.deals.length, 1);
    assert.deepStrictEqual({ status: db.clients[0].status, user: db.clients[0].userId, tags: db.clients[0].tags }, { status: 'prospect', user: 1, tags: '["cellar-enquiry"]' });
    assert.deepStrictEqual({ email: db.contacts[0].email, phone: db.contacts[0].phone }, { email: 'sam@example.com', phone: '0412 345 678' });
    assert.strictEqual(db.deals[0].stage, 'lead'); assert.strictEqual(db.deals[0].title, 'Cellar enquiry: 840 bottles'); assert.strictEqual(db.deals[0].value, null);
    assert.match(db.deals[0].notes, /Design: 2750 x 1565 mm, single door \| 840 bottles \| guide price \$7,100 to \$8,700/);
    assert.match(db.deals[0].notes, /Their message:\nHello\nthere/);
    assert.match(db.deals[0].notes, new RegExp(`https://vault.test/cellar-planner\\?lead=${db.leads[0].id}`));
    assert.deepStrictEqual([db.leads[0].clientId, db.leads[0].dealId], [db.clients[0].id, db.deals[0].id]);
    assert.strictEqual(db.interactions.length, 1); assert.strictEqual(db.interactions[0].dealId, db.deals[0].id);
    assert.deepStrictEqual([log.begin, log.commit, log.rollback, log.released], [1, 1, 0, 1]);
    s.close();
  });
  await t('the design code is stored with the lead but never put in the CRM note (only the staff link)', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD);
    assert.strictEqual(pool.db.leads[0].designCode, CODE);
    assert.ok(!pool.db.deals[0].notes.includes(CODE));
    s.close();
  });
  await t('the same email already in the CRM: the deal goes on that client, no duplicate client', async () => {
    const pool = fakePool(); const s = await serve(pool);
    pool.db.clients.push({ id: 900, userId: 1, name: 'Sam R' }); pool.db.contacts.push({ id: 901, clientId: 900, email: 'SAM@example.com' });
    await post(s, GOOD);
    assert.strictEqual(pool.db.clients.length, 1); assert.strictEqual(pool.db.deals[0].clientId, 900); assert.strictEqual(pool.db.leads[0].clientId, 900);
    s.close();
  });
  await t('a contact with that email belonging to someone else\'s CRM is not matched', async () => {
    const pool = fakePool(); const s = await serve(pool);
    pool.db.clients.push({ id: 900, userId: 2, name: 'Other' }); pool.db.contacts.push({ id: 901, clientId: 900, email: 'sam@example.com' });
    await post(s, GOOD);
    assert.strictEqual(pool.db.clients.length, 2); assert.strictEqual(pool.db.deals[0].userId, 1); assert.notStrictEqual(pool.db.deals[0].clientId, 900);
    s.close();
  });
  await t('the page script\'s text/plain body works (no preflight), and so does JSON', async () => {
    const pool = fakePool(); const s = await serve(pool);
    assert.strictEqual((await post(s, JSON.stringify(GOOD))).status, 200);
    assert.strictEqual((await post(s, { ...GOOD, email: 'j@example.com' })).status, 200);
    assert.strictEqual(pool.db.leads.length, 2);
    s.close();
  });
  await t('garbage is a plain 400 and writes nothing', async () => {
    const pool = fakePool(); const s = await serve(pool);
    assert.strictEqual((await post(s, 'not json at all')).status, 400);
    assert.strictEqual((await post(s, JSON.stringify({ ...GOOD, email: 'bad' }))).status, 400);
    assert.strictEqual((await post(s, JSON.stringify([1, 2]))).status, 400);
    assert.strictEqual(pool.db.leads.length + pool.db.clients.length, 0);
    s.close();
  });
  await t('CORS: any website may post; preflight is answered; other methods are refused', async () => {
    const pool = fakePool(); const s = await serve(pool);
    const r = await post(s, GOOD);
    assert.strictEqual(r.headers['access-control-allow-origin'], '*'); assert.strictEqual(r.headers['cache-control'], 'no-store');
    const pre = await call(s, 'OPTIONS', '/api/cellar-lite/enquiry');
    assert.strictEqual(pre.status, 204); assert.match(pre.headers['access-control-allow-methods'], /POST/);
    const get = await call(s, 'GET', '/api/cellar-lite/enquiry');
    assert.strictEqual(get.status, 405); assert.match(get.headers.allow, /POST/);
    s.close();
  });
  await t('the honeypot: a robot that fills the hidden field is told "ok" and nothing is recorded', async () => {
    const pool = fakePool(); const s = await serve(pool);
    const r = await post(s, { ...GOOD, website: 'http://spam.example' });
    assert.deepStrictEqual([r.status, r.json], [200, { ok: true }]);
    assert.strictEqual(pool.db.leads.length, 0);
    s.close();
  });
  await t('the same person sending the same design again is one enquiry; a different design is another', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD); const again = await post(s, { ...GOOD, email: 'SAM@EXAMPLE.COM' });
    assert.strictEqual(again.status, 200); assert.strictEqual(pool.db.leads.length, 1); assert.strictEqual(pool.db.deals.length, 1);
    await post(s, { ...GOOD, code: 'CL1.WzI3NTAsMTU2NSwyMTUwLDMsMCwwLDUwMCwwXQ' });
    assert.strictEqual(pool.db.leads.length, 2);
    s.close();
  });
  await t('per-visitor limit: the sixth enquiry from one connection in an hour is refused (429 + Retry-After); others and later are fine', async () => {
    let clock = Date.parse('2026-10-10T00:00:00Z');
    const pool = fakePool(); pool.state.clock = () => clock; const s = await serve(pool, { now: () => clock });
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < LIMITS.perIpPerHour; i++) assert.strictEqual((await post(s, { ...GOOD, email: `p${i}@example.com` }, ip)).status, 200, `enquiry ${i}`);
    const over = await post(s, { ...GOOD, email: 'p9@example.com' }, ip);
    assert.strictEqual(over.status, 429); assert.ok(over.headers['retry-after']); assert.match(over.json.error, /Too many/);
    assert.strictEqual((await post(s, { ...GOOD, email: 'other@example.com' }, { 'x-forwarded-for': '198.51.100.7' })).status, 200);
    clock += 61 * 60 * 1000;
    assert.strictEqual((await post(s, { ...GOOD, email: 'later@example.com' }, ip)).status, 200);
    s.close();
  });
  await t('daily ceiling: at the limit new enquiries are refused and the Suggestions inbox is told (once per day)', async () => {
    const pool = fakePool(); const captured = []; const s = await serve(pool, { capture: async (x) => { captured.push(x); } });
    for (let i = 0; i < LIMITS.perDay; i++) pool.db.leads.push({ id: 5000 + i, userId: 1, email: `x${i}@e.com`, designCode: 'CL1.x', createdAt: Date.now(), status: 'new' });
    const r = await post(s, { ...GOOD, email: 'new@example.com' }, { 'x-forwarded-for': '192.0.2.1' });
    assert.strictEqual(r.status, 429); assert.match(r.json.error, /paused/i);
    assert.strictEqual(pool.db.clients.length, 0);
    assert.strictEqual(captured.length, 1); assert.strictEqual(captured[0].category, 'alert'); assert.match(captured[0].fingerprint, /^cellarLeads:daily-cap:\d{4}-\d\d-\d\d$/);
    s.close();
  });
  await t('a failure part-way rolls everything back and answers 503 (the website\'s own email still reaches the business)', async () => {
    const pool = fakePool(); const s = await serve(pool);
    pool.state.fail = 'client_deals';
    const r = await post(s, GOOD);
    assert.strictEqual(r.status, 503); assert.match(r.json.error, /not available/);
    assert.deepStrictEqual([pool.db.leads.length, pool.db.clients.length, pool.db.contacts.length, pool.db.deals.length], [0, 0, 0, 0]);
    assert.deepStrictEqual([pool.log.rollback, pool.log.released], [1, 1]);
    s.close();
  });
  await t('no admin user to own the enquiry: 503, nothing written', async () => {
    const pool = fakePool({ admin: 0 }); const s = await serve(pool);
    assert.strictEqual((await post(s, GOOD)).status, 503);
    assert.strictEqual(pool.db.leads.length, 0);
    s.close();
  });
  await t('the response never echoes anything back (no ids, no CRM details)', async () => {
    const pool = fakePool(); const s = await serve(pool);
    assert.strictEqual((await post(s, GOOD)).text, '{"ok":true}');
    s.close();
  });

  // ------------------------------------------------------------ staff routes
  await t('staff list: newest first, only the signed-in user\'s, without the design code or message', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD, { 'x-forwarded-for': '1.1.1.1' }); await post(s, { ...GOOD, email: 'b@example.com', name: 'Bea' }, { 'x-forwarded-for': '1.1.1.2' });
    pool.db.leads.push({ id: 777, userId: 2, name: 'Not yours', email: 'z@z.com', designCode: CODE, createdAt: Date.now(), status: 'new' });
    const r = await call(s, 'GET', '/api/cellar-planner/leads', undefined, { 'x-test-user': '1' });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.leads.map((l) => l.name), ['Bea', 'Sam Rivera']);
    assert.ok(!('code' in r.json.leads[0]) && !('message' in r.json.leads[0]));
    assert.deepStrictEqual((await call(s, 'GET', '/api/cellar-planner/leads', undefined, { 'x-test-user': '3' })).json.leads, []);
    s.close();
  });
  await t('staff read one: includes the design code and message; someone else\'s or a bad id is a 404', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD); const id = pool.db.leads[0].id;
    const r = await call(s, 'GET', `/api/cellar-planner/leads/${id}`, undefined, { 'x-test-user': '1' });
    assert.strictEqual(r.json.lead.code, CODE); assert.strictEqual(r.json.lead.message, 'Hello\nthere'); assert.strictEqual(r.json.lead.status, 'new');
    for (const [path, user] of [[`/api/cellar-planner/leads/${id}`, '2'], ['/api/cellar-planner/leads/99999', '1'], ['/api/cellar-planner/leads/abc', '1'], ['/api/cellar-planner/leads/0', '1'], ['/api/cellar-planner/leads/-3', '1'], ['/api/cellar-planner/leads/1e3', '1']]) {
      assert.strictEqual((await call(s, 'GET', path, undefined, { 'x-test-user': user })).status, 404, path);
    }
    s.close();
  });
  await t('opened: new becomes opened, never moves a quoted enquiry back, and is owner-only', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD); const id = pool.db.leads[0].id;
    assert.strictEqual((await call(s, 'POST', `/api/cellar-planner/leads/${id}/opened`, {}, { 'x-test-user': '2' })).status, 404);
    assert.strictEqual((await call(s, 'POST', `/api/cellar-planner/leads/${id}/opened`, {})).json.status, 'opened');
    pool.db.leads[0].status = 'quoted';
    assert.strictEqual((await call(s, 'POST', `/api/cellar-planner/leads/${id}/opened`, {})).json.status, 'quoted');
    s.close();
  });
  await t('quote made: status quoted, a timeline note, and the deal value is filled in only when it was empty', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD); const id = pool.db.leads[0].id;
    const body = { total: 7900.456, text: '$7,100 to $8,700', reference: '20261010-1' };
    const r = await call(s, 'POST', `/api/cellar-planner/leads/${id}/quote`, body);
    assert.deepStrictEqual(r.json, { ok: true, valueSet: true });
    assert.strictEqual(pool.db.leads[0].status, 'quoted'); assert.strictEqual(pool.db.deals[0].value, 7900.46);
    const last = pool.db.interactions.at(-1);
    assert.match(last.title, /quote prepared/i); assert.match(last.note, /7,900\.46.*\$7,100 to \$8,700.*20261010-1.*Deal value set/s);
    const second = await call(s, 'POST', `/api/cellar-planner/leads/${id}/quote`, { total: 9500 });
    assert.strictEqual(second.json.valueSet, false); assert.strictEqual(pool.db.deals[0].value, 7900.46); // a value someone already had is not overwritten
    s.close();
  });
  await t('quote made: needs a sensible total; someone else\'s enquiry is a 404', async () => {
    const pool = fakePool(); const s = await serve(pool);
    await post(s, GOOD); const id = pool.db.leads[0].id;
    for (const total of [undefined, 0, -5, 'x', 1e12, null]) assert.strictEqual((await call(s, 'POST', `/api/cellar-planner/leads/${id}/quote`, { total })).status, 400, String(total));
    assert.strictEqual((await call(s, 'POST', `/api/cellar-planner/leads/${id}/quote`, { total: 100 }, { 'x-test-user': '2' })).status, 404);
    assert.strictEqual(pool.db.leads[0].status, 'new');
    s.close();
  });
  await t('the real mounts: the enquiry route is public and before the login; the staff route is behind login and the cellarPlanner flag', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
    const auth = src.indexOf("app.use('/api', requireAuth)");
    const pub = src.indexOf("app.use('/api/cellar-lite/enquiry'"), staff = src.indexOf("app.use('/api/cellar-planner/leads'");
    assert.ok(pub > 0 && pub < auth, 'public enquiry route is before requireAuth');
    assert.ok(staff > auth, 'staff leads route is after requireAuth');
    assert.match(src.slice(staff, staff + 120), /requireFeature\('cellarPlanner'\)/);
  });

  console.log(`\n${process.exitCode ? 'Some checks FAILED' : `All ${passed} checks passed`}`);
})();
