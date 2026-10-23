#!/usr/bin/env node
/**
 * Notes list: light rows, search, date range, paging, project/client names, ownership checks.
 * Integration test: needs a real Postgres. Uses two throwaway users, deleted afterwards (everything cascades from users).
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/notes.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
if (!process.env.DATABASE_URL) {
  console.log('SKIP notes.test.js: set DATABASE_URL to a local Postgres (see docs/local-dev-windows.md)');
  process.exit(0);
}

const assert = require('assert');
const http = require('http');
const express = require('express');
const { pool } = require('../db');

let userA; let userB;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.headers['x-user'] === 'B' ? userB : userA, isAdmin: true }; next(); });
app.use('/api/notes', require('./notes'));
app.use('/api/recycle-bin', require('./recycleBin'));

let base;
async function call(method, url, body, as) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as === 'B' ? { 'x-user': 'B' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, more: res.headers.get('x-has-more') };
}

let clientA; let clientB; let projectA; let projectB;
const ids = {};
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const day = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();

test('the list sends a short preview, never the whole text', async () => {
  const long = 'x'.repeat(5000);
  const made = await call('POST', '/api/notes', { title: 'Long one', body: long });
  assert.strictEqual(made.status, 201);
  ids.long = made.json.id;
  const r = await call('GET', '/api/notes');
  const row = r.json.find((n) => n.id === ids.long);
  assert.ok(row, 'listed');
  assert.strictEqual(row.body, undefined, 'no body in the list');
  assert.strictEqual(row.preview.length, 240, 'preview is cut');
  assert.strictEqual((await call('GET', `/api/notes/${ids.long}`)).json.body.length, 5000, 'the open note still has everything');
});

test('seed notes with known dates, a project and a client', async () => {
  const mk = async (title, body, created, updated, extra = {}) => {
    const r = await pool.query(
      'INSERT INTO notes (user_id, title, body, created_at, updated_at, project_id, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [userA, title, body, created, updated, extra.project || null, extra.client || null]);
    ids[title] = r.rows[0].id;
  };
  await mk('Old budget', 'tax and budget', day(2026, 1, 5), day(2026, 1, 6), { project: projectA });
  await mk('March call', 'call with Acme', day(2026, 3, 10), day(2026, 3, 11), { client: clientA });
  await mk('October plan', '100% sure_thing', day(2026, 10, 1), day(2026, 10, 20));
  await mk('Edited late', 'made in feb, edited in oct', day(2026, 2, 1), day(2026, 10, 22));
});

test('newest first by last edited; names for project and client come with each row', async () => {
  const r = await call('GET', '/api/notes');
  const order = r.json.map((n) => n.title).filter((t) => ['Old budget', 'March call', 'October plan', 'Edited late'].includes(t));
  assert.deepStrictEqual(order, ['Edited late', 'October plan', 'March call', 'Old budget']);
  assert.strictEqual(r.json.find((n) => n.title === 'Old budget').project_name, 'Project A');
  assert.strictEqual(r.json.find((n) => n.title === 'March call').client_name, 'Client A');
});

test('date range: from is included, to is excluded; the field picks created or edited', async () => {
  const titles = async (qs) => (await call('GET', `/api/notes?${qs}`)).json.map((n) => n.title).filter((t) => ids[t]);
  const q = (o) => new URLSearchParams(o).toString();
  assert.deepStrictEqual(await titles(q({ from: day(2026, 10, 1), to: day(2026, 11, 1) })), ['Edited late', 'October plan']);
  assert.deepStrictEqual(await titles(q({ from: day(2026, 2, 1), to: day(2026, 3, 1), field: 'created' })), ['Edited late']);
  assert.deepStrictEqual(await titles(q({ from: day(2026, 3, 11), to: day(2026, 3, 12) })), ['March call'], 'edge of the range');
  assert.deepStrictEqual(await titles(q({ to: day(2026, 3, 11) })), ['Old budget'], 'to excludes that instant');
  assert.strictEqual((await call('GET', '/api/notes?from=not-a-date')).status, 400);
});

test('search: title, text, project and client names; % and _ are plain characters', async () => {
  const titles = async (q) => (await call('GET', `/api/notes?q=${encodeURIComponent(q)}`)).json.map((n) => n.title);
  assert.deepStrictEqual(await titles('budget'), ['Old budget']);
  assert.ok((await titles('Project A')).includes('Old budget'), 'project name');
  assert.ok((await titles('Client A')).includes('March call'), 'client name');
  assert.deepStrictEqual((await titles('100%')).filter((t) => ids[t]), ['October plan']);
  assert.deepStrictEqual((await titles('%')).filter((t) => ids[t]), ['October plan'], 'a lone % is not "match everything"');
  assert.deepStrictEqual((await titles('sure_thing')).filter((t) => ids[t]), ['October plan']);
  assert.deepStrictEqual((await titles('sureXthing')), [], '_ is not "any one character"');
});

test('filter by project, client and unfiled', async () => {
  const titles = async (qs) => (await call('GET', `/api/notes?${qs}`)).json.map((n) => n.title).filter((t) => ids[t]);
  assert.deepStrictEqual(await titles(`project_id=${projectA}`), ['Old budget']);
  assert.deepStrictEqual(await titles(`client_id=${clientA}`), ['March call']);
  assert.ok(!(await titles('unfiled=1')).includes('Old budget'));
  assert.ok((await titles('unfiled=1')).includes('October plan'));
});

test('paging: limit, offset and the X-Has-More header', async () => {
  const total = (await call('GET', '/api/notes?limit=300')).json.length;
  assert.ok(total >= 5);
  const p1 = await call('GET', '/api/notes?limit=2');
  assert.strictEqual(p1.json.length, 2);
  assert.strictEqual(p1.more, '1');
  const p2 = await call('GET', '/api/notes?limit=2&offset=2');
  assert.ok(!p1.json.some((a) => p2.json.some((b) => b.id === a.id)), 'pages do not overlap');
  const last = await call('GET', `/api/notes?limit=2&offset=${total - 1}`);
  assert.strictEqual(last.more, '0');
});

test('a note can only be filed under your own project and client', async () => {
  assert.strictEqual((await call('POST', '/api/notes', { title: 'x', project_id: projectB })).status, 400);
  assert.strictEqual((await call('POST', '/api/notes', { title: 'x', project_id: 999999999 })).status, 400);
  assert.strictEqual((await call('PUT', `/api/notes/${ids.long}`, { project_id: projectB })).status, 400);
  assert.strictEqual((await call('PUT', `/api/notes/${ids.long}`, { client_id: clientB })).status, 400);
  const ok = await call('PUT', `/api/notes/${ids.long}`, { project_id: projectA });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.project_id, projectA);
  assert.strictEqual((await call('POST', '/api/notes', { title: 5 })).status, 400, 'a title that is not text is refused, not a 500');
});

test('GET /:id carries the project and client names; /options lists only your clients', async () => {
  const one = await call('GET', `/api/notes/${ids['March call']}`);
  assert.strictEqual(one.json.client_name, 'Client A');
  const opts = await call('GET', '/api/notes/options');
  assert.deepStrictEqual(opts.json.clients.map((c) => c.name), ['Client A']);
});

test("other people's notes are invisible", async () => {
  assert.strictEqual((await call('GET', `/api/notes/${ids['March call']}`, undefined, 'B')).status, 404);
  assert.strictEqual((await call('PUT', `/api/notes/${ids['March call']}`, { title: 'hax' }, 'B')).status, 404);
  assert.strictEqual((await call('DELETE', `/api/notes/${ids['March call']}`, undefined, 'B')).status, 404);
  assert.deepStrictEqual((await call('GET', '/api/notes', undefined, 'B')).json, []);
  assert.deepStrictEqual((await call('GET', '/api/notes/options', undefined, 'B')).json.clients.map((c) => c.name), ['Client B']);
});

test('pinning: pinned notes lead the list, pin leaves the edited date alone, only the owner can pin', async () => {
  const before = (await call('GET', `/api/notes/${ids['Old budget']}`)).json.updated_at;
  const pin = await call('PATCH', `/api/notes/${ids['Old budget']}/pin`, { pinned: true });
  assert.strictEqual(pin.status, 200);
  assert.ok(pin.json.pinned_at);
  const list = (await call('GET', '/api/notes')).json;
  assert.strictEqual(list[0].title, 'Old budget', 'pinned note is first even though it is the oldest');
  assert.ok(list[0].pinned_at);
  assert.strictEqual((await call('GET', `/api/notes/${ids['Old budget']}`)).json.updated_at, before, 'pinning does not count as an edit');
  // a later pin sorts above an earlier one
  await call('PATCH', `/api/notes/${ids['March call']}/pin`, { pinned: true });
  assert.deepStrictEqual((await call('GET', '/api/notes')).json.slice(0, 2).map((n) => n.title), ['March call', 'Old budget']);
  // editing a pinned note keeps it pinned
  await call('PUT', `/api/notes/${ids['Old budget']}`, { body: 'tax and budget, edited' });
  assert.ok((await call('GET', `/api/notes/${ids['Old budget']}`)).json.pinned_at);
  // unpin
  assert.strictEqual((await call('PATCH', `/api/notes/${ids['March call']}/pin`, { pinned: false })).json.pinned_at, null);
  assert.strictEqual((await call('PATCH', `/api/notes/${ids['Old budget']}/pin`, { pinned: 'yes' })).status, 400);
  assert.strictEqual((await call('PATCH', `/api/notes/${ids['Old budget']}/pin`, { pinned: false }, 'B')).status, 404, "not someone else's note");
  assert.strictEqual((await call('GET', '/api/notes')).json.find((n) => n.title === 'Old budget').pinned_at, (await call('GET', `/api/notes/${ids['Old budget']}`)).json.pinned_at, 'B did not unpin it');
  await call('PATCH', `/api/notes/${ids['Old budget']}/pin`, { pinned: false });
});

test('AI actions: read the saved note, return the proposal, change nothing, refuse other people and empty notes', async () => {
  const noteAi = require('../services/noteAi');
  const real = noteAi.runNoteAction;
  let seen = null;
  noteAi.runNoteAction = async (userId, action, note) => { seen = { userId, action, note }; return { text: 'A summary.' }; };
  try {
    const before = (await call('GET', `/api/notes/${ids['March call']}`)).json;
    const r = await call('POST', `/api/notes/${ids['March call']}/ai`, { action: 'summary', today: '2026-10-23' });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual({ action: r.json.action, text: r.json.text }, { action: 'summary', text: 'A summary.' });
    assert.strictEqual(seen.userId, userA);
    assert.strictEqual(seen.note.body, 'call with Acme', 'the server reads the saved text, not text sent by the browser');
    assert.strictEqual(seen.note.today, '2026-10-23');
    const after = (await call('GET', `/api/notes/${ids['March call']}`)).json;
    assert.deepStrictEqual({ t: after.title, b: after.body, u: after.updated_at }, { t: before.title, b: before.body, u: before.updated_at }, 'the note is untouched');
    seen = null;
    assert.strictEqual((await call('POST', `/api/notes/${ids['March call']}/ai`, { action: 'summary' }, 'B')).status, 404);
    assert.strictEqual(seen, null, "another person's note never reaches the model");
    noteAi.runNoteAction = async () => { throw Object.assign(new Error('This note is empty. Write something first.'), { status: 400 }); };
    const empty = await call('POST', `/api/notes/${ids['March call']}/ai`, { action: 'summary' });
    assert.deepStrictEqual({ s: empty.status, e: empty.json.error }, { s: 400, e: 'This note is empty. Write something first.' });
    noteAi.runNoteAction = async () => { throw new Error('secret internals'); };
    const boom = await call('POST', `/api/notes/${ids['March call']}/ai`, { action: 'summary' });
    assert.strictEqual(boom.status, 500);
    assert.ok(!/secret/.test(boom.json.error), 'internal errors are not shown');
  } finally { noteAi.runNoteAction = real; }
});

test('tags: set, normalise, list, filter (all of them), untagged, search, edit date untouched', async () => {
  const before = (await call('GET', `/api/notes/${ids['Old budget']}`)).json.updated_at;
  const set = await call('PUT', `/api/notes/${ids['Old budget']}/tags`, { tags: ['#Budget', 'budget', ' Tax  Time ', '', 'Q3'] });
  assert.strictEqual(set.status, 200);
  assert.deepStrictEqual(set.json.tags, ['budget', 'tax time', 'q3'], 'normalised, repeats and blanks dropped, order kept');
  await call('PUT', `/api/notes/${ids['March call']}/tags`, { tags: ['budget', 'meeting'] });
  await call('PUT', `/api/notes/${ids['October plan']}/tags`, { tags: ['ideas'] });

  const one = (await call('GET', `/api/notes/${ids['Old budget']}`)).json;
  assert.deepStrictEqual(one.tags, ['budget', 'q3', 'tax time'], 'the open note carries its tags (sorted)');
  assert.strictEqual(one.updated_at, before, 'tagging is filing, not editing');
  const list = (await call('GET', '/api/notes')).json;
  assert.deepStrictEqual(list.find((n) => n.title === 'Old budget').tags, ['budget', 'q3', 'tax time']);
  assert.deepStrictEqual(list.find((n) => n.title === 'Edited late').tags, [], 'no tags is an empty list, not null');

  const titles = async (qs) => (await call('GET', `/api/notes?${qs}`)).json.map((n) => n.title).filter((t) => ids[t]);
  assert.deepStrictEqual((await titles('tags=budget')).sort(), ['March call', 'Old budget']);
  assert.deepStrictEqual(await titles('tags=budget,meeting'), ['March call'], 'two tags means both');
  assert.deepStrictEqual(await titles(`tags=${encodeURIComponent('#Budget')},ideas`), [], 'no note has both');
  assert.deepStrictEqual(await titles('untagged=1'), ['Edited late']);
  assert.deepStrictEqual((await titles('q=meeting')), ['March call'], 'search finds a note by its tag');
  assert.deepStrictEqual((await titles(`tags=budget&project_id=${projectA}`)), ['Old budget'], 'tags combine with other filters');

  const bad = await call('PUT', `/api/notes/${ids['Old budget']}/tags`, { tags: 'budget' });
  assert.strictEqual(bad.status, 400);
  const many = await call('PUT', `/api/notes/${ids['Old budget']}/tags`, { tags: Array.from({ length: 40 }, (_, i) => `t${i}`) });
  assert.strictEqual(many.json.tags.length, 20, 'capped at 20 per note');
  await call('PUT', `/api/notes/${ids['Old budget']}/tags`, { tags: ['budget', 'tax time', 'q3'] });
  assert.strictEqual((await call('PUT', `/api/notes/${ids['Old budget']}/tags`, { tags: ['x'] }, 'B')).status, 404, "not someone else's note");
  assert.deepStrictEqual((await call('GET', `/api/notes/${ids['Old budget']}`)).json.tags, ['budget', 'q3', 'tax time'], "B changed nothing");
});

test('tag list with counts; rename (and merge) and delete across all notes; isolated per person', async () => {
  const all = (await call('GET', '/api/notes/tags')).json;
  assert.deepStrictEqual(all.find((t) => t.tag === 'budget'), { tag: 'budget', count: 2 });
  assert.strictEqual(all[0].tag, 'budget', 'most used first');
  assert.deepStrictEqual((await call('GET', '/api/notes/tags', undefined, 'B')).json, [], "B sees none of A's tags");

  // rename to a new name moves every note
  assert.strictEqual((await call('POST', '/api/notes/tags/rename', { from: 'Q3', to: 'quarter three' })).status, 200);
  assert.deepStrictEqual((await call('GET', `/api/notes/${ids['Old budget']}`)).json.tags, ['budget', 'quarter three', 'tax time']);
  // rename onto an existing tag merges, and a note that had both keeps one
  await call('PUT', `/api/notes/${ids['March call']}/tags`, { tags: ['budget', 'meeting', 'quarter three'] });
  assert.strictEqual((await call('POST', '/api/notes/tags/rename', { from: 'quarter three', to: 'budget' })).status, 200);
  assert.deepStrictEqual((await call('GET', `/api/notes/${ids['March call']}`)).json.tags, ['budget', 'meeting']);
  assert.deepStrictEqual((await call('GET', `/api/notes/${ids['Old budget']}`)).json.tags, ['budget', 'tax time']);
  assert.strictEqual((await call('POST', '/api/notes/tags/rename', { from: '', to: 'x' })).status, 400);
  // B renaming A's tag name does nothing to A
  await call('POST', '/api/notes/tags/rename', { from: 'budget', to: 'hax' }, 'B');
  assert.deepStrictEqual((await call('GET', `/api/notes/${ids['Old budget']}`)).json.tags, ['budget', 'tax time']);

  // delete takes the tag off the notes and leaves the notes
  const del = await call('DELETE', '/api/notes/tags/Meeting');
  assert.deepStrictEqual(del.json, { tag: 'meeting', removedFrom: 1 });
  assert.deepStrictEqual((await call('GET', `/api/notes/${ids['March call']}`)).json.tags, ['budget']);
  assert.strictEqual((await call('GET', `/api/notes/${ids['March call']}`)).status, 200, 'the note is still there');
  await call('DELETE', '/api/notes/tags/ideas');
  await call('DELETE', '/api/notes/tags/tax%20time');
  assert.deepStrictEqual((await call('GET', '/api/notes/tags')).json, [{ tag: 'budget', count: 2 }]);
});

test('deleting a note removes its tags; the AI tag action is given the existing tags', async () => {
  const made = await call('POST', '/api/notes', { title: 'Temp', body: 'temp body' });
  await call('PUT', `/api/notes/${made.json.id}/tags`, { tags: ['gone soon'] });
  assert.ok((await call('GET', '/api/notes/tags')).json.some((t) => t.tag === 'gone soon'));
  await call('DELETE', `/api/notes/${made.json.id}`);
  assert.ok(!(await call('GET', '/api/notes/tags')).json.some((t) => t.tag === 'gone soon'), 'tags go with the note');

  const noteAi = require('../services/noteAi');
  const real = noteAi.runNoteAction;
  let seen = null;
  noteAi.runNoteAction = async (_u, action, note) => { seen = { action, note }; return { tags: ['budget'] }; };
  try {
    const r = await call('POST', `/api/notes/${ids['March call']}/ai`, { action: 'tags' });
    assert.deepStrictEqual(r.json.tags, ['budget']);
    assert.deepStrictEqual(seen.note.existingTags, ['budget'], "the person's own tags, nobody else's");
    seen = null;
    await call('POST', `/api/notes/${ids['March call']}/ai`, { action: 'summary' });
    assert.deepStrictEqual(seen.note.existingTags, [], 'other actions do not look the tags up');
  } finally { noteAi.runNoteAction = real; }
});

test('deleting a note keeps it for 30 days; restoring brings back text, tags, pin, dates and the same id', async () => {
  const made = await call('POST', '/api/notes', { title: 'Keep me', body: '# Plan\n- [ ] one', project_id: projectA, client_id: clientA });
  const id = made.json.id;
  await call('PUT', `/api/notes/${id}/tags`, { tags: ['alpha', 'beta'] });
  await call('PATCH', `/api/notes/${id}/pin`, { pinned: true });
  const before = (await call('GET', `/api/notes/${id}`)).json;

  const del = await call('DELETE', `/api/notes/${id}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.retentionDays, 30);
  assert.ok(del.json.binId);
  assert.strictEqual((await call('GET', `/api/notes/${id}`)).status, 404, 'gone from Notes');
  assert.ok(!(await call('GET', '/api/notes')).json.some((n) => n.id === id));
  assert.ok(!(await call('GET', '/api/notes/tags')).json.some((t) => t.tag === 'alpha'), 'its tags left the tag list too');

  const inBin = (await call('GET', '/api/recycle-bin?types=note')).json.items.find((i) => i.id === del.json.binId);
  assert.deepStrictEqual({ type: inBin.entityType, label: inBin.label, title: inBin.title, daysLeft: inBin.daysLeft }, { type: 'note', label: 'Note', title: 'Keep me', daysLeft: 30 });
  assert.match(inBin.detail, /Plan/);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`, undefined, 'B')).status, 404, "B cannot restore A's note");

  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  assert.strictEqual(Number(back.json.entityId), id, 'the same note number, so anything that pointed at it still does');
  const after = (await call('GET', `/api/notes/${id}`)).json;
  for (const k of ['title', 'body', 'project_id', 'client_id', 'pinned_at', 'created_at', 'updated_at', 'source']) assert.deepStrictEqual(after[k], before[k], `${k} came back as it was`);
  assert.deepStrictEqual(after.tags, ['alpha', 'beta']);
  assert.ok((await call('GET', '/api/notes/tags')).json.some((t) => t.tag === 'alpha'));
  await call('DELETE', `/api/notes/${id}`);
});

test('restoring a note whose project was deleted since brings it back without the project', async () => {
  const proj = (await pool.query("INSERT INTO projects (name, \"userId\", model, \"projectType\") VALUES ('Short lived',$1,'m','writing') RETURNING id", [userA])).rows[0].id;
  const made = await call('POST', '/api/notes', { title: 'Orphan', body: 'x', project_id: proj });
  const del = await call('DELETE', `/api/notes/${made.json.id}`);
  await pool.query('DELETE FROM projects WHERE id=$1', [proj]);
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200);
  assert.strictEqual((await call('GET', `/api/notes/${made.json.id}`)).json.project_id, null);
  await call('DELETE', `/api/notes/${made.json.id}`);
});

test('templates: make, list, change, delete to the bin, restore; limits and ownership', async () => {
  const made = await call('POST', '/api/notes/templates', { name: ' Weekly review ', title: 'Review, {{date}}', body: '- [ ] one\n- [ ] two', tags: ['#Review', 'review', 'weekly'] });
  assert.strictEqual(made.status, 201);
  assert.deepStrictEqual({ name: made.json.name, title: made.json.title, tags: made.json.tags }, { name: 'Weekly review', title: 'Review, {{date}}', tags: ['review', 'weekly'] });
  const tid = made.json.id;
  assert.deepStrictEqual((await call('GET', '/api/notes/templates')).json.map((t) => t.name), ['Weekly review']);
  assert.deepStrictEqual((await call('GET', '/api/notes/templates', undefined, 'B')).json, [], "B sees none of A's templates");

  const put = await call('PUT', `/api/notes/templates/${tid}`, { name: 'Weekly reset' });
  assert.deepStrictEqual({ name: put.json.name, body: put.json.body }, { name: 'Weekly reset', body: '- [ ] one\n- [ ] two' }, 'only the named field changed');
  assert.strictEqual((await call('PUT', `/api/notes/templates/${tid}`, { name: 'hax' }, 'B')).status, 404);
  assert.strictEqual((await call('PUT', `/api/notes/templates/${tid}`, { body: 5 })).status, 400);
  assert.strictEqual((await call('POST', '/api/notes/templates', { name: '  ' })).status, 400, 'a name is needed');
  assert.strictEqual((await call('POST', '/api/notes/templates', { name: 'x', tags: 'nope' })).status, 400);

  const del = await call('DELETE', `/api/notes/templates/${tid}`);
  assert.strictEqual(del.status, 200);
  assert.deepStrictEqual((await call('GET', '/api/notes/templates')).json, []);
  const item = (await call('GET', '/api/recycle-bin?types=note-template')).json.items[0];
  assert.deepStrictEqual({ label: item.label, title: item.title }, { label: 'Note template', title: 'Weekly reset' });
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200);
  const restored = (await call('GET', '/api/notes/templates')).json[0];
  assert.deepStrictEqual({ id: restored.id, name: restored.name, tags: restored.tags }, { id: tid, name: 'Weekly reset', tags: ['review', 'weekly'] });

  await pool.query("INSERT INTO note_templates (user_id, name) SELECT $1, 'filler ' || g FROM generate_series(1, 49) g", [userA]);
  assert.strictEqual((await call('POST', '/api/notes/templates', { name: 'one too many' })).status, 400, 'at most 50');
  await pool.query('DELETE FROM note_templates WHERE user_id=$1', [userA]);
});

test("daily note: one per day, from the template, with the last day's open to-dos carried over", async () => {
  const day1 = await call('POST', '/api/notes/daily', { date: '2026-10-22', title: 'Daily note, Thu 22 Oct', body: '# Thu 22 Oct\n\nTop 3:\n- [ ] \n' });
  assert.strictEqual(day1.status, 201);
  assert.deepStrictEqual({ created: day1.json.created, carried: day1.json.carried, tags: day1.json.note.tags, daily: day1.json.note.daily_date }, { created: true, carried: 0, tags: ['daily'], daily: '2026-10-22' });

  // the person writes some to-dos during the day
  await call('PUT', `/api/notes/${day1.json.note.id}`, { body: '# Thu 22 Oct\n- [ ] Call Sam\n- [x] Send quote\n- [ ] Book flights\n' });

  const again = await call('POST', '/api/notes/daily', { date: '2026-10-22', title: 'ignored', body: 'ignored' });
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual({ created: again.json.created, id: again.json.note.id }, { created: false, id: day1.json.note.id }, 'asking again opens the same note');
  assert.match(again.json.note.body, /Call Sam/, 'and does not overwrite it');

  const day2 = await call('POST', '/api/notes/daily', { date: '2026-10-23', title: 'Daily note, Fri 23 Oct', body: '# Fri 23 Oct\n' });
  assert.strictEqual(day2.status, 201);
  assert.strictEqual(day2.json.carried, 2);
  assert.strictEqual(day2.json.note.body, '# Fri 23 Oct\n\nCarried over from 2026-10-22:\n- [ ] Call Sam\n- [ ] Book flights\n');
  assert.match((await call('GET', `/api/notes/${day1.json.note.id}`)).json.body, /Call Sam/, 'yesterday is left exactly as it was');

  // two devices opening the same new day at once still make one note
  const [x, y] = await Promise.all([1, 2].map(() => call('POST', '/api/notes/daily', { date: '2026-10-24', title: 'Daily note', body: 'x' })));
  assert.strictEqual(x.json.note.id, y.json.note.id);
  assert.strictEqual(Number((await pool.query("SELECT COUNT(*) FROM notes WHERE user_id=$1 AND daily_date='2026-10-24'", [userA])).rows[0].count), 1);

  // bad input, and each person has their own days
  assert.strictEqual((await call('POST', '/api/notes/daily', { date: '2026-02-30', title: 'x', body: '' })).status, 400);
  assert.strictEqual((await call('POST', '/api/notes/daily', { date: '2026-10-23', title: 5, body: '' })).status, 400);
  const other = await call('POST', '/api/notes/daily', { date: '2026-10-23', title: 'B day', body: 'b' }, 'B');
  assert.strictEqual(other.json.created, true);
  assert.notStrictEqual(other.json.note.id, day2.json.note.id);

  // delete today's note, make it again, then restore the old one: it comes back as an ordinary note, not a second daily note
  const del = await call('DELETE', `/api/notes/${day2.json.note.id}`);
  const remade = await call('POST', '/api/notes/daily', { date: '2026-10-23', title: 'Daily note, Fri 23 Oct', body: '# new' });
  assert.strictEqual(remade.json.created, true);
  assert.notStrictEqual(remade.json.note.id, day2.json.note.id);
  assert.strictEqual((await call('POST', `/api/recycle-bin/${del.json.binId}/restore`)).status, 200);
  const old = (await call('GET', `/api/notes/${day2.json.note.id}`)).json;
  assert.strictEqual(old.daily_date, null);
  assert.strictEqual(Number((await pool.query("SELECT COUNT(*) FROM notes WHERE user_id=$1 AND daily_date='2026-10-23'", [userA])).rows[0].count), 1);
});

test('saved views: save, list, rename, replace filters, delete to the bin and restore; names, limits and ownership', async () => {
  const filters = { search: ' quote ', preset: '30d', field: 'created', projectId: String(projectA), clientId: String(clientA), tags: ['#Budget', 'budget'], groupMode: 'tag', evil: '<script>' };
  const made = await call('POST', '/api/notes/views', { name: '  Acme   last month ', filters });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.name, 'Acme last month');
  assert.deepStrictEqual(made.json.filters, { search: 'quote', preset: '30d', custom: { from: '', to: '' }, field: 'created', projectId: String(projectA), clientId: String(clientA), tags: ['budget'], groupMode: 'tag' }, 'cut down to the known fields');
  const vid = made.json.id;

  assert.deepStrictEqual((await call('GET', '/api/notes/views')).json.map((v) => v.name), ['Acme last month']);
  assert.deepStrictEqual((await call('GET', '/api/notes/views', undefined, 'B')).json, [], "B sees none of A's views");

  // names: needed, unique ignoring case, per person
  assert.strictEqual((await call('POST', '/api/notes/views', { name: '  ', filters })).status, 400);
  assert.strictEqual((await call('POST', '/api/notes/views', { name: 'x', filters: 'nope' })).status, 400);
  const dup = await call('POST', '/api/notes/views', { name: 'ACME LAST MONTH', filters });
  assert.deepStrictEqual({ s: dup.status, e: dup.json.error }, { s: 409, e: 'You already have a view with that name.' });
  assert.strictEqual((await call('POST', '/api/notes/views', { name: 'Acme last month', filters }, 'B')).status, 201, "B can use the same name");

  // rename, and replace the filters with new ones
  const renamed = await call('PUT', `/api/notes/views/${vid}`, { name: 'Acme recent' });
  assert.deepStrictEqual({ name: renamed.json.name, preset: renamed.json.filters.preset }, { name: 'Acme recent', preset: '30d' }, 'only the name changed');
  const refiled = await call('PUT', `/api/notes/views/${vid}`, { filters: { preset: '7d', groupMode: 'date' } });
  assert.deepStrictEqual({ name: refiled.json.name, preset: refiled.json.filters.preset, tags: refiled.json.filters.tags }, { name: 'Acme recent', preset: '7d', tags: [] });
  assert.strictEqual((await call('PUT', `/api/notes/views/${vid}`, {})).status, 400);
  assert.strictEqual((await call('PUT', `/api/notes/views/${vid}`, { name: '' })).status, 400);
  assert.strictEqual((await call('PUT', `/api/notes/views/${vid}`, { name: 'hax' }, 'B')).status, 404);
  await call('POST', '/api/notes/views', { name: 'Other', filters: {} });
  assert.strictEqual((await call('PUT', `/api/notes/views/${vid}`, { name: 'other' })).status, 409, 'renaming onto another name is refused too');

  // delete -> recycle bin -> restore
  const del = await call('DELETE', `/api/notes/views/${vid}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await call('DELETE', `/api/notes/views/${vid}`)).status, 404);
  assert.deepStrictEqual((await call('GET', '/api/notes/views')).json.map((v) => v.name), ['Other']);
  const item = (await call('GET', '/api/recycle-bin?types=note-view')).json.items[0];
  assert.deepStrictEqual({ label: item.label, title: item.title }, { label: 'Notes view', title: 'Acme recent' });
  // the name gets used again meanwhile: the restored view is renamed rather than refused
  await call('POST', '/api/notes/views', { name: 'Acme recent', filters: {} });
  const back = await call('POST', `/api/recycle-bin/${del.json.binId}/restore`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.json));
  const names = (await call('GET', '/api/notes/views')).json.map((v) => v.name);
  assert.ok(names.includes('Acme recent') && names.includes('Acme recent (restored)'), names.join(' | '));
  assert.strictEqual(Number(back.json.entityId), vid, 'same id');

  // at most 30
  await pool.query('DELETE FROM note_views WHERE user_id=$1', [userA]);
  await pool.query("INSERT INTO note_views (user_id, name) SELECT $1, 'filler ' || g FROM generate_series(1, 30) g", [userA]);
  assert.strictEqual((await call('POST', '/api/notes/views', { name: 'one too many', filters: {} })).status, 400);
  await pool.query('DELETE FROM note_views WHERE user_id=$1', [userA]);
});

async function cleanup(userIds) {
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
}

(async () => {
  await new Promise((r) => setTimeout(r, 4000)); // db.js runs its own schema init on load
  const mk = async (tag) => (await pool.query('INSERT INTO users (email, "passwordHash") VALUES ($1,\'x\') RETURNING id', [`notes-test-${tag}-${Date.now()}@example.test`])).rows[0].id;
  userA = await mk('a'); userB = await mk('b');
  const proj = async (name, uid) => (await pool.query('INSERT INTO projects (name, "userId", model, "projectType") VALUES ($1,$2,\'m\',\'writing\') RETURNING id', [name, uid])).rows[0].id;
  projectA = await proj('Project A', userA); projectB = await proj('Project B', userB);
  clientA = (await pool.query('INSERT INTO clients ("userId", name) VALUES ($1,\'Client A\') RETURNING id', [userA])).rows[0].id;
  clientB = (await pool.query('INSERT INTO clients ("userId", name) VALUES ($1,\'Client B\') RETURNING id', [userB])).rows[0].id;
  const server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    for (const t of tests) {
      try { await t.fn(); console.log(`  ok   ${t.name}`); }
      catch (e) { failed++; console.log(`  FAIL ${t.name}\n       ${e.message}`); }
    }
  } finally {
    server.close();
    await cleanup([userA, userB]);
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : `\nall ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
