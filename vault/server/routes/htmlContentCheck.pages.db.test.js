'use strict';
// DATABASE_URL=... node server/routes/htmlContentCheck.pages.db.test.js
// Real database, fake sign-in, stand-in fetchers and a stand-in model (no live site or model). Proves, for milestone 4b (several pages):
//   - a job holds several pages; "Under …" labels put request lines on the page of that name; a line with no label has no page;
//   - a round reads every page (one row each, one number); changes are per page;
//   - matching is one model call per page, with that page's lines and the lines with no page only; Held over and Keep lines are never sent;
//   - line states across pages: linked, held, kept, and a Keep line whose text changed;
//   - the pages list: rename, a read page's address is fixed, add and remove (its lines lose their page), limits;
//   - an uploaded saved copy fills a page's failed place in the latest round;
//   - another member cannot touch the pages or links; the recycle bin brings pages, lines and rounds back together.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP htmlContentCheck.pages.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const router = require('./htmlContentCheck');

const FIX = path.join(__dirname, '../services/htmlContentCheck/fixtures');
const ARTIST_BEFORE = fs.readFileSync(path.join(FIX, 'artist-before.html'), 'utf8');
const ARTIST_AFTER = fs.readFileSync(path.join(FIX, 'artist-after.html'), 'utf8');
const events = (extra) => `<html><body><h1>Events</h1><p>Come and see her work at the Tasmanian Museum and Art Gallery in Hobart, in the exhibition Becoming Modern.</p>
  <ul><li>2026 - Exhibition opening, Hobart</li>${extra}</ul><p>Bookings are essential for every event listed on this page.</p></body></html>`;
const EVENTS_BEFORE = events('');
const EVENTS_AFTER = events('<li>2027 - Thursday 4 February, Fuller\'s Book Shop launch, Hobart</li>');
const ARTIST = 'https://dorothy.example/the-artist';
const EVENTS = 'https://dorothy.example/events';

const net = { pages: {}, calls: [] };
router._setPageDeps({
  plainFetch: async (url) => { net.calls.push(url); const v = net.pages[url]; if (v instanceof Error) throw v; return { html: v, finalUrl: url }; },
  browserFetch: async () => { throw new Error('no browser in this test'); },
  browserAvailable: () => false,
});
// A stand-in model that reads the prompt's data blocks and links lines to changes by a key word, as a model might.
const KEYS = { 'Change the footer phone number': 'Phone', 'Add her dates to the heading': '1921–2008', 'Add the 2027 Hobart launch': '2027' };
const prompts = [];
router._setMatchDeps({
  getModels: async () => ({ standard: 'model-under-test' }),
  callModel: async (_m, prompt) => {
    const block = (tag) => JSON.parse(prompt.split(`<${tag}>\n`)[1].split(`\n</${tag}>`)[0]);
    const lines = block('request_lines');
    const changes = block('page_changes');
    prompts.push({ refs: lines.map((l) => l.ref), changes: changes.length });
    const reply = lines.map((l) => ({ ref: l.ref, changeIds: changes.filter((c) => KEYS[l.text] && String(c.after || '').includes(KEYS[l.text])).map((c) => c.id), reason: 'stand-in' }));
    return { text: JSON.stringify({ lines: reply }), inputTokens: 500, outputTokens: 50 };
  },
  logUsage: () => {},
});

const REQUEST = `Change the footer phone number
Under The Artist.
Add her dates to the heading
Keep: Dorothy Stoner was born in Melbourne in 1921 and studied at the National Gallery School.

Under Events
Add the 2027 Hobart launch
Think about the reading list (hold over)`;

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
  const tag = `hcc-pages-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/api/html-content-check`;
  const call = async (user, method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const status = (body) => Object.fromEntries(body.lines.map((l) => [l.ref, l.status]));
  try {
    // ---- a job with two pages; lines placed by their labels ----
    net.pages = { [ARTIST]: ARTIST_BEFORE, [EVENTS]: EVENTS_BEFORE };
    let r = await call(A, 'POST', '/jobs', { name: `${tag} Dorothy`, requestText: REQUEST, pages: [{ url: ARTIST, label: 'The Artist' }, { url: EVENTS, label: 'Events' }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const job = r.body;
    const [artist, evts] = job.pages;
    assert.deepEqual(job.pages.map((p) => [p.label, p.url]), [['The Artist', ARTIST], ['Events', EVENTS]]);
    assert.equal(job.url, ARTIST, 'the job keeps page 1 as its address');
    assert.deepEqual(job.items.map((i) => [i.ref, i.kind, i.pageId, i.section]), [
      ['R1', 'request_line', null, null],
      ['R2', 'request_line', artist.id, 'The Artist'],
      ['R3', 'keep', artist.id, 'The Artist'],
      ['R4', 'request_line', evts.id, 'Events'],
      ['R5', 'held_over', evts.id, 'Events'],
    ]);
    assert.deepEqual(net.calls.sort(), [ARTIST, EVENTS].sort(), 'round 0 read both pages');
    assert.deepEqual(job.rounds.map((x) => [x.number, x.pageId, x.status]), [[0, artist.id, 'ready'], [0, evts.id, 'ready']]);

    // ---- round 1: both pages changed; changes per page ----
    net.pages = { [ARTIST]: ARTIST_AFTER, [EVENTS]: EVENTS_AFTER };
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.equal(r.body.round.number, 1); assert.equal(r.body.round.pages.length, 2);
    const byPage = Object.fromEntries(r.body.job.rounds.filter((x) => x.number === 1).map((x) => [x.pageId, x.sincePrevious.total]));
    assert.equal(byPage[artist.id], 7); assert.equal(byPage[evts.id], 1, 'each page has its own changes');
    let round = (await call(A, 'GET', `/jobs/${job.id}/rounds/1`)).body;
    assert.deepEqual(round.pages.map((p) => p.label), ['The Artist', 'Events']);
    assert.deepEqual(status(round), { R1: 'notMatched', R2: 'notMatched', R3: 'kept', R4: 'notMatched', R5: 'held' }, 'the Keep text is still on the page; R5 is held');

    // ---- matching: one call per page, that page's lines and the lines with no page only ----
    r = await call(A, 'POST', `/jobs/${job.id}/rounds/1/match`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(prompts.map((p) => p.refs), [['R1', 'R2'], ['R1', 'R4']], 'Keep and Held over lines are never sent');
    assert.equal(r.body.usage.pages, 2);
    assert.deepEqual(status(r.body), { R1: 'linked', R2: 'linked', R3: 'kept', R4: 'linked', R5: 'held' });
    const r1 = r.body.lines.find((l) => l.ref === 'R1');
    assert.deepEqual(r1.links.map((l) => l.pageId), [artist.id], 'the line with no page found its change on The Artist');
    assert.deepEqual(r.body.lines.find((l) => l.ref === 'R4').links.map((l) => l.pageId), [evts.id]);

    // ---- link by hand on one page; a line from another page cannot be linked there ----
    const evtChange = r.body.pages[1].results.diff.vsBaseline.changes[0].id;
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/rounds/1/pages/${artist.id}/matches/R4`, { changeIds: [] })).status, 400, 'R4 belongs to Events');
    r = await call(A, 'PUT', `/jobs/${job.id}/rounds/1/pages/${evts.id}/matches/R1`, { changeIds: [evtChange] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.lines.find((l) => l.ref === 'R1').links.map((l) => l.pageId).sort(), [artist.id, evts.id].sort(), 'R1 now linked on both pages');

    // ---- round 2: the Keep text was changed on The Artist ----
    net.pages = { [ARTIST]: ARTIST_AFTER.replace('studied at the National Gallery School', 'studied at the Gallery School'), [EVENTS]: EVENTS_AFTER };
    await call(A, 'POST', `/jobs/${job.id}/rounds`);
    round = (await call(A, 'GET', `/jobs/${job.id}/rounds/2`)).body;
    assert.equal(status(round).R3, 'keepChanged');
    assert.deepEqual(round.lines.find((l) => l.ref === 'R3').pageIds, [artist.id]);

    // ---- an upload fills a page's failed place in the latest round ----
    net.pages = { [ARTIST]: ARTIST_AFTER, [EVENTS]: Object.assign(new Error('Could not fetch the page (HTTP 500)'), { isPublic: true }) };
    r = await call(A, 'POST', `/jobs/${job.id}/rounds`);
    assert.deepEqual(r.body.round.pages.map((p) => p.status).sort(), ['failed', 'ready']);
    const form = new FormData();
    form.append('pageId', String(evts.id));
    form.append('file', new Blob([EVENTS_AFTER], { type: 'text/html' }), 'events.html');
    let res = await fetch(`${base}/jobs/${job.id}/rounds`, { method: 'POST', headers: { 'x-test-user': String(A) }, body: form });
    r = { status: res.status, body: await res.json() };
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.round.number, 3, 'the same round, not a new one');
    assert.deepEqual(r.body.job.rounds.filter((x) => x.number === 3).map((x) => [x.pageId, x.status, x.fetchedVia]).sort(), [[artist.id, 'ready', 'plain'], [evts.id, 'ready', 'upload']].sort());

    // ---- the pages list ----
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/pages`, { pages: [{ id: artist.id, url: 'https://dorothy.example/elsewhere', label: 'The Artist' }, { id: evts.id, url: EVENTS }] })).status, 409, 'a read page keeps its address');
    r = await call(A, 'PUT', `/jobs/${job.id}/pages`, { pages: [{ id: artist.id, url: ARTIST, label: 'The Artist' }, { url: 'https://dorothy.example/read-a-chapter', label: 'Read a Chapter' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.pages.map((p) => p.label), ['The Artist', 'Read a Chapter']);
    assert.deepEqual(r.body.items.filter((i) => i.section === 'Events').map((i) => i.pageId), [null, null], 'Events removed: its lines stay, with no page');
    assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM content_check_rounds WHERE "pageId" = $1', [evts.id])).rows[0].n), 0, "and its reads went with it");
    for (const pages of [[], Array.from({ length: 13 }, (_, i) => ({ url: `https://dorothy.example/p${i}` })), [{ url: ARTIST }, { url: ARTIST }]]) {
      assert.equal((await call(A, 'PUT', `/jobs/${job.id}/pages`, { pages })).status, 400);
    }

    // ---- lines: assign to a page and change kinds ----
    const items = r.body.items.map((i) => ({ id: i.id, lineText: i.lineText, kind: i.kind, pageId: i.pageId, section: i.section }));
    items[4].kind = 'request_line'; items[4].pageId = r.body.pages[1].id;
    r = await call(A, 'PUT', `/jobs/${job.id}/items`, { items });
    assert.equal(r.status, 200); assert.equal(r.body.items[4].kind, 'request_line'); assert.equal(r.body.items[4].pageId, r.body.pages[1].id);
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/items`, { items: [{ lineText: 'x', kind: 'maybe' }] })).status, 400);

    // ---- another member ----
    const bJob = (await call(B, 'POST', '/jobs', { kind: 'compare', url: 'https://b.example/', fetch: false })).body;
    assert.equal((await call(B, 'PUT', `/jobs/${job.id}/pages`, { pages: [{ url: 'https://b.example/' }] })).status, 404);
    assert.equal((await call(B, 'GET', `/jobs/${job.id}/rounds/1`)).status, 404);
    assert.equal((await call(B, 'PUT', `/jobs/${bJob.id}/pages`, { pages: [{ id: artist.id, url: ARTIST }] })).status, 400, "A's page id on B's job");
    assert.equal((await call(B, 'PUT', `/jobs/${bJob.id}/items`, { items: [] })).status, 400, 'a comparison has no lines');

    // ---- the recycle bin keeps pages, lines and rounds together ----
    require('../services/recycleBin/adapters');
    const bin = require('../services/recycleBin');
    const before = (await call(A, 'GET', `/jobs/${job.id}`)).body;
    r = await call(A, 'DELETE', `/jobs/${job.id}`);
    assert.equal(r.status, 200);
    await bin.restoreItem(A, r.body.binId);
    const back = (await call(A, 'GET', `/jobs/${job.id}`)).body;
    assert.deepEqual(back.pages.map((p) => [p.id, p.label]), before.pages.map((p) => [p.id, p.label]));
    assert.deepEqual(back.items.map((i) => [i.ref, i.kind, i.pageId]), before.items.map((i) => [i.ref, i.kind, i.pageId]));
    assert.deepEqual(back.rounds.map((x) => [x.number, x.pageId, x.status]), before.rounds.map((x) => [x.number, x.pageId, x.status]));

    console.log('htmlContentCheck.pages.db.test.js: all checks passed');
  } finally {
    server.close();
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1::int[])', [[A, B]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A, B]]);
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
