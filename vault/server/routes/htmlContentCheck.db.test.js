'use strict';
// DATABASE_URL=... node server/routes/htmlContentCheck.db.test.js
// Real database, fake sign-in. Proves, for milestone 1 of HTML Content Check:
//   - a change-request job is made with its request split into R1, R2 ...; a comparison job keeps no request; bad input is refused;
//   - a client must be in the caller's CRM; a ticket needs Tickets switched on for the caller (admins always);
//   - another member cannot list, read, change, re-line or delete someone else's job, nor use its line ids;
//   - request lines: edit, reorder, add, remove renumber R1.. before a report; after refs are locked a line keeps its ref, a new line
//     gets the next number never issued, and splitting again is refused;
//   - the address cannot change once a round exists; search by name and address;
//   - delete goes to the recycle bin, and restore brings back the job, its lines (same ids and refs), its rounds and client notes.
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP htmlContentCheck.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const router = require('./htmlContentCheck');

function serve(users) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const id = Number(req.headers['x-test-user']); req.user = { id, isAdmin: users[id] === 'admin' }; next(); });
  app.use('/api/html-content-check', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;

  const tag = `hcc-test-${Date.now()}`;
  const mk = async (n, admin) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',$2) RETURNING id`, [`${tag}-${n}@example.test`, admin])).rows[0].id;
  const A = await mk('a', true);
  const B = await mk('b', false);
  const prevTickets = (await pool.query(`SELECT value FROM workspace_settings WHERE key = 'feature_tickets'`)).rows[0]?.value;
  await pool.query(`INSERT INTO workspace_settings (key,value) VALUES ('feature_tickets','false') ON CONFLICT (key) DO UPDATE SET value='false'`);
  const clientA = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, $2) RETURNING id`, [A, `${tag} Acme`])).rows[0].id;
  const clientB = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, $2) RETURNING id`, [B, `${tag} Beta`])).rows[0].id;
  const ticket = (await pool.query(`INSERT INTO tickets (title, "createdBy") VALUES ($1, $2) RETURNING id`, [`${tag} ticket`, A])).rows[0].id;

  require('../services/recycleBin/adapters');
  const bin = require('../services/recycleBin');
  const server = await serve({ [A]: 'admin', [B]: 'member' });
  const base = `http://127.0.0.1:${server.address().port}/api/html-content-check`;
  const call = async (user, method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const refs = (job) => job.items.map((i) => `${i.ref}:${i.lineText}`);

  try {
    // ---- create ----
    let r = await call(A, 'POST', '/jobs', { url: 'example.com/artists/dorothy', requestText: 'Please make these changes:\n- Fix the heading\n- Remove the 1998 show', clientId: clientA, ticketId: ticket, fetchMode: 'browser' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const job = r.body;
    assert.equal(job.url, 'https://example.com/artists/dorothy', 'an address without a scheme gets https');
    assert.equal(job.name, 'example.com/artists/dorothy', 'no name: the address is used');
    assert.equal(job.kind, 'request');
    assert.equal(job.fetchMode, 'browser');
    assert.equal(job.clientName, `${tag} Acme`);
    assert.equal(job.ticketTitle, `${tag} ticket`);
    assert.deepEqual(refs(job), ['R1:Please make these changes:', 'R2:Fix the heading', 'R3:Remove the 1998 show']);
    assert.equal(job.refCounter, 3);
    assert.deepEqual(job.rounds, []);

    r = await call(A, 'POST', '/jobs', { kind: 'compare', url: 'https://example.com/', name: `${tag} compare`, requestText: 'ignored' });
    assert.equal(r.status, 201);
    assert.equal(r.body.requestText, null, 'a comparison keeps no request');
    assert.deepEqual(r.body.items, []);
    const compareId = r.body.id;

    for (const [body, why] of [
      [{ url: 'ftp://example.com', requestText: 'x' }, 'not http'],
      [{ url: '', requestText: 'x' }, 'no address'],
      [{ url: 'example.com', requestText: '   ' }, 'empty request'],
      [{ url: 'example.com', requestText: 'x', kind: 'checklist' }, 'unknown kind'],
      [{ url: 'example.com', requestText: 'x', fetchMode: 'magic' }, 'unknown fetch mode'],
      [{ url: 'example.com', requestText: 'x'.repeat(50001) }, 'request too long'],
      [{ url: 'example.com', requestText: Array.from({ length: 201 }, (_, i) => `- line ${i}`).join('\n') }, 'too many lines'],
    ]) assert.equal((await call(A, 'POST', '/jobs', body)).status, 400, why);
    assert.equal((await call(A, 'POST', '/jobs', { url: 'example.com', requestText: 'x', clientId: clientB })).status, 404, "someone else's client");
    assert.equal((await call(B, 'POST', '/jobs', { url: 'example.com', requestText: 'x', ticketId: ticket })).status, 403, 'a member without Tickets cannot link a ticket');

    // ---- another member sees nothing of A's ----
    const bJob = (await call(B, 'POST', '/jobs', { url: 'example.org', requestText: '- B line' })).body;
    assert.ok(!(await call(B, 'GET', '/jobs')).body.jobs.some((j) => j.id === job.id));
    assert.equal((await call(B, 'GET', `/jobs/${job.id}`)).status, 404);
    assert.equal((await call(B, 'PATCH', `/jobs/${job.id}`, { name: 'taken' })).status, 404);
    assert.equal((await call(B, 'PUT', `/jobs/${job.id}/items`, { items: [{ lineText: 'x' }] })).status, 404);
    assert.equal((await call(B, 'DELETE', `/jobs/${job.id}`)).status, 404);
    assert.equal((await call(B, 'PUT', `/jobs/${bJob.id}/items`, { items: [{ id: job.items[0].id, lineText: 'stolen' }] })).status, 400, "A's line id on B's job");
    assert.equal((await call(A, 'GET', `/jobs/${job.id}`)).body.items[0].lineText, 'Please make these changes:', "A's job unchanged");
    assert.equal((await call(A, 'GET', '/jobs/abc')).status, 404);

    // ---- request lines before a report: renumbered in list order ----
    const [i1, i2, i3] = job.items;
    r = await call(A, 'PUT', `/jobs/${job.id}/items`, { items: [{ id: i3.id, lineText: 'Remove the 1998 show' }, { id: i2.id, lineText: 'Fix the heading to "Dorothy Stoner"' }, { lineText: 'Add the 2024 award' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(refs(r.body), ['R1:Remove the 1998 show', 'R2:Fix the heading to "Dorothy Stoner"', 'R3:Add the 2024 award']);
    assert.equal(r.body.items[0].id, i3.id, 'a kept line keeps its id');
    assert.ok(!r.body.items.some((i) => i.id === i1.id), 'a removed line is gone');
    assert.equal(r.body.items[2].source, 'manual');
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/items`, { items: [{ lineText: '  ' }] })).status, 400, 'an empty line');
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/items`, { items: [{ id: i3.id, lineText: 'a' }, { id: i3.id, lineText: 'b' }] })).status, 400, 'the same line twice');
    assert.equal((await call(A, 'PUT', `/jobs/${compareId}/items`, { items: [{ lineText: 'x' }] })).status, 400, 'a comparison has no lines');

    // ---- after a report: refs fixed, never reused; no re-split ----
    await pool.query('UPDATE content_check_jobs SET "refsLockedAt" = NOW() WHERE id = $1', [job.id]);
    const before = (await call(A, 'GET', `/jobs/${job.id}`)).body.items; // R1, R2, R3
    r = await call(A, 'PUT', `/jobs/${job.id}/items`, { items: [{ id: before[2].id, lineText: before[2].lineText }, { id: before[0].id, lineText: before[0].lineText }, { lineText: 'A new request from the client' }] });
    assert.deepEqual(r.body.items.map((i) => i.ref), ['R3', 'R1', 'R4'], 'kept refs stay, the new line is R4, R2 is not reused');
    r = await call(A, 'PUT', `/jobs/${job.id}/items`, { items: [...r.body.items.map((i) => ({ id: i.id, lineText: i.lineText })), { lineText: 'Another' }] });
    assert.equal(r.body.items[3].ref, 'R5');
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/items`, { resplit: true })).status, 409);

    // ---- update ----
    r = await call(A, 'PATCH', `/jobs/${job.id}`, { name: `${tag} Dorothy`, status: 'with_client', previousText: 'old copy', clientId: null, settings: { ignore: [] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'with_client');
    assert.equal(r.body.clientId, null);
    assert.deepEqual(r.body.settings, { ignore: [] });
    for (const body of [{ status: 'done' }, { name: '' }, { settings: [] }, { url: 'javascript:alert(1)' }, { requestText: '' }]) {
      assert.equal((await call(A, 'PATCH', `/jobs/${job.id}`, body)).status, 400, JSON.stringify(body));
    }
    await pool.query(`INSERT INTO content_check_rounds ("jobId", "userId", number, "fetchedVia", snapshot) VALUES ($1, $2, 0, 'plain', $3)`, [job.id, A, JSON.stringify({ v: 1, blocks: [] })]);
    assert.equal((await call(A, 'PATCH', `/jobs/${job.id}`, { url: 'https://example.com/other' })).status, 409, 'address fixed once fetched');
    assert.equal((await call(A, 'PATCH', `/jobs/${job.id}`, { url: job.url })).status, 200, 'the same address is fine');

    // ---- list and search ----
    const listed = (await call(A, 'GET', `/jobs?q=${encodeURIComponent('Dorothy')}`)).body.jobs;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].roundCount, 1);
    assert.equal(listed[0].itemCount, 4);
    assert.ok((await call(A, 'GET', '/jobs?q=artists%2Fdorothy')).body.jobs.some((j) => j.id === job.id), 'search by address');
    assert.equal((await call(A, 'GET', '/jobs?q=%25')).body.jobs.length, 0, 'a % is searched as itself');

    // ---- delete and restore ----
    const lines = (await call(A, 'GET', `/jobs/${job.id}`)).body.items;
    await pool.query(`INSERT INTO content_check_client_notes ("jobId", "userId", "roundNumber", "itemId", ref, text, source) VALUES ($1, $2, 0, $3, $4, 'Client says: also fix the date', 'form')`, [job.id, A, lines[1].id, lines[1].ref]);
    r = await call(A, 'DELETE', `/jobs/${job.id}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.binId);
    assert.equal((await call(A, 'GET', `/jobs/${job.id}`)).status, 404);
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM content_check_items WHERE "jobId" = $1', [job.id])).rows[0].n), 0, 'lines went with it');
    assert.ok(!(await bin.list(B)).some((x) => x.id === r.body.binId), "not in another member's bin");
    await bin.restoreItem(A, r.body.binId);
    const back = (await call(A, 'GET', `/jobs/${job.id}`)).body;
    assert.equal(back.id, job.id, 'same id');
    assert.deepEqual(back.items.map((i) => [i.id, i.ref, i.lineText]), lines.map((i) => [i.id, i.ref, i.lineText]), 'lines back with ids and refs');
    assert.equal(back.refCounter, 5);
    assert.ok(back.refsLockedAt, 'refs stay locked');
    assert.equal(back.rounds.length, 1, 'the round is back');
    assert.deepEqual((await pool.query('SELECT snapshot FROM content_check_rounds WHERE "jobId" = $1', [job.id])).rows[0].snapshot, { v: 1, blocks: [] });
    assert.equal(back.openNotes, 1, 'the client note is back');
    assert.equal((await pool.query('SELECT "itemId" FROM content_check_client_notes WHERE "jobId" = $1', [job.id])).rows[0].itemId, lines[1].id, 'and still points at its line');

    console.log('htmlContentCheck.db.test.js: all checks passed');
  } finally {
    server.close();
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1::int[])', [[A, B]]);
    await pool.query('DELETE FROM tickets WHERE id = $1', [ticket]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A, B]]);
    if (prevTickets === undefined) await pool.query(`DELETE FROM workspace_settings WHERE key = 'feature_tickets'`);
    else await pool.query(`UPDATE workspace_settings SET value = $1 WHERE key = 'feature_tickets'`, [prevTickets]);
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
