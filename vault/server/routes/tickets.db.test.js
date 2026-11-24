'use strict';
// DATABASE_URL=... node server/routes/tickets.db.test.js
// Real database, fake sign-in. Proves:
//   - a ticket can be made, read, listed, filtered and changed; bad type, status, priority, date and an empty title are refused;
//   - tickets are shared: another person with access sees and changes the same ticket (by design, docs/tickets.md);
//   - only people with Tickets can be assigned (admins always; members when the feature is on and not switched off for them);
//   - each tracked change writes a plain history line; Done sets closedAt and reopening clears it;
//   - a client can only be linked by someone whose CRM holds it, but everyone sees its name, and others can still change other fields;
//   - comments: add, and only the writer (or an admin) can remove one;
//   - "Make a task" makes a task in the caller's own Tasks, linked back, with the client only when it is the caller's;
//   - the counts for the menu badge; T-number search; overdue;
//   - delete goes to the deleter's recycle bin and restore brings back the ticket, its number and its history.
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP tickets.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const router = require('./tickets');

function serve(users) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const id = Number(req.headers['x-test-user']); req.user = { id, isAdmin: users[id] === 'admin' }; next(); });
  app.use('/api/tickets', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;

  const tag = `tickets-test-${Date.now()}`;
  const mk = async (n, admin) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',$2) RETURNING id`, [`${tag}-${n}@example.test`, admin])).rows[0].id;
  const A = await mk('a', true);   // an admin
  const B = await mk('b', false);  // a member with Tickets
  const C = await mk('c', false);  // a member switched off
  await pool.query(`UPDATE users SET "featureOverrides" = '{"tickets": false}'::jsonb WHERE id = $1`, [C]);
  const prevFlag = (await pool.query(`SELECT value FROM workspace_settings WHERE key = 'feature_tickets'`)).rows[0]?.value;
  await pool.query(`INSERT INTO workspace_settings (key,value) VALUES ('feature_tickets','true') ON CONFLICT (key) DO UPDATE SET value='true'`);
  const clientA = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, $2) RETURNING id`, [A, `${tag} Acme`])).rows[0].id;
  const clientB = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1, $2) RETURNING id`, [B, `${tag} Beta`])).rows[0].id;

  require('../services/recycleBin/adapters');
  const bin = require('../services/recycleBin');
  const server = await serve({ [A]: 'admin', [B]: 'member', [C]: 'member' });
  const base = `http://127.0.0.1:${server.address().port}/api/tickets`;
  const call = async (user, method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const made = [];

  try {
    // ---- make, refuse the wrong things ----
    let r = await call(A, 'POST', '/', { title: '  Fix the invoice template  ', type: 'client', priority: 'high', dueDate: '2020-01-01', clientId: clientA, description: 'Totals wrong' });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    const t1 = r.body; made.push(t1.id);
    assert.equal(t1.title, 'Fix the invoice template');
    assert.equal(t1.status, 'open');
    assert.equal(t1.dueDate, '2020-01-01', 'a date stays a date');
    assert.equal(t1.clientName, `${tag} Acme`);
    assert.equal(t1.createdBy, A);
    assert.equal(t1.clientOwnerId, A, 'the ticket says whose CRM the client is in, so the owner gets the link to the client page');
    for (const bad of [{ title: '' }, { title: 'x', type: 'feature' }, { title: 'x', status: 'closed' }, { title: 'x', priority: 'urgent' }, { title: 'x', dueDate: '01/12/2026' }]) {
      assert.equal((await call(A, 'POST', '/', bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await call(A, 'POST', '/', { title: 'x', clientId: clientB })).status, 404, 'cannot link a client that is not in your CRM');
    assert.equal((await call(A, 'POST', '/', { title: 'x', sourceKind: 'email', sourceId: 1 })).status, 400);

    // ---- assignees: admins and members with access, not a member switched off ----
    const people = (await call(A, 'GET', '/people')).body.people.map((p) => p.id);
    assert.ok(people.includes(A) && people.includes(B) && !people.includes(C), JSON.stringify(people));
    assert.equal((await call(A, 'PUT', `/${t1.id}`, { assigneeId: C })).status, 400);

    // ---- shared: B sees A's ticket and works on it ----
    r = await call(B, 'GET', `/${t1.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.clientName, `${tag} Acme`, 'everyone sees the linked client name');
    r = await call(B, 'PUT', `/${t1.id}`, { status: 'in_progress', assigneeId: B, priority: 'medium', clientId: clientA });
    assert.equal(r.status, 200, 'a person without that client can still change other fields when the client is unchanged');
    assert.equal(r.body.status, 'in_progress');
    assert.equal(r.body.assigneeId, B);
    const change = r.body.events.find((e) => e.kind === 'change');
    assert.match(change.body, /Status: Open → In progress/);
    assert.match(change.body, /Priority: High → Medium/);
    assert.match(change.body, new RegExp(`Assigned: none → ${tag}-b@example.test`));
    assert.equal((await call(B, 'PUT', `/${t1.id}`, { clientId: clientA, clientProjectId: 999999 })).status, 404, 'but cannot re-link to something not theirs');

    // ---- done and reopen ----
    r = await call(A, 'PUT', `/${t1.id}`, { status: 'done' });
    assert.ok(r.body.closedAt);
    r = await call(A, 'PUT', `/${t1.id}`, { status: 'waiting' });
    assert.equal(r.body.closedAt, null);

    // ---- list, filters, search, counts ----
    const t2 = (await call(B, 'POST', '/', { title: 'Look at a new CRM idea', type: 'idea', priority: 'low' })).body; made.push(t2.id);
    const ids = async (q) => (await call(A, 'GET', `/?${q}`)).body.tickets.map((t) => t.id).filter((id) => made.includes(id));
    assert.deepEqual((await ids('type=idea')).sort(), [t2.id]);
    assert.deepEqual(await ids('status=active'), [t2.id, t1.id]);
    assert.deepEqual(await ids(`q=T-${t1.id}`), [t1.id]);
    assert.deepEqual(await ids('q=invoice%20template'), [t1.id]);
    assert.deepEqual(await ids('overdue=true'), [t1.id], 'due in 2020 and not done');
    assert.deepEqual((await call(B, 'GET', '/?assigneeId=me')).body.tickets.filter((t) => made.includes(t.id)).map((t) => t.id), [t1.id]);
    assert.deepEqual(await ids(`clientId=${clientA}`), [t1.id]);
    // the client page's Tickets tab asks for every status (ClientTickets.jsx), so done tickets are listed too
    await call(A, 'PUT', `/${t2.id}`, { clientId: clientA, status: 'done' });
    assert.deepEqual((await ids(`clientId=${clientA}&status=`)).sort(), [t1.id, t2.id].sort(), 'the client tab shows all its tickets, done included');
    await call(A, 'PUT', `/${t2.id}`, { clientId: null, status: 'open' });
    const counts = (await call(B, 'GET', '/counts')).body;
    assert.ok(counts.assigned >= 1 && counts.overdue >= 1);

    // ---- comments ----
    r = await call(B, 'POST', `/${t1.id}/comments`, { body: 'Checked with the accountant.' });
    assert.equal(r.status, 201);
    const comment = r.body.events.find((e) => e.kind === 'comment');
    assert.equal((await call(B, 'POST', `/${t1.id}/comments`, { body: '   ' })).status, 400);
    assert.equal((await call(C, 'DELETE', `/${t1.id}/comments/${comment.id}`)).status, 403, 'only the writer or an admin');
    const changeLine = r.body.events.find((e) => e.kind === 'change');
    assert.equal((await call(A, 'DELETE', `/${t1.id}/comments/${changeLine.id}`)).status, 404, 'history lines cannot be removed');

    // ---- make a task ----
    r = await call(B, 'POST', `/${t1.id}/task`, {});
    assert.equal(r.status, 201);
    let task = (await pool.query('SELECT * FROM tasks WHERE id = $1', [r.body.taskId])).rows[0];
    assert.equal(task.userId, B);
    assert.equal(task.ticketId, t1.id);
    assert.equal(task.clientId, null, 'A\'s client is not put on B\'s task');
    r = await call(A, 'POST', `/${t1.id}/task`, { title: 'Email the accountant' });
    task = (await pool.query('SELECT * FROM tasks WHERE id = $1', [r.body.taskId])).rows[0];
    assert.equal(task.clientId, clientA);
    assert.equal(task.title, 'Email the accountant');
    assert.equal(r.body.ticket.tasks.length, 2);

    // ---- delete and restore ----
    const before = (await call(A, 'GET', `/${t1.id}`)).body;
    r = await call(B, 'DELETE', `/${t1.id}`);
    assert.equal(r.status, 200);
    assert.equal((await call(A, 'GET', `/${t1.id}`)).status, 404);
    assert.equal((await pool.query('SELECT "ticketId" FROM tasks WHERE id = $1', [task.id])).rows[0].ticketId, null, 'tasks stay, unlinked');
    await bin.restoreItem(B, r.body.binId);
    const after = (await call(A, 'GET', `/${t1.id}`)).body;
    assert.equal(after.id, t1.id, 'the same T-number');
    assert.equal(after.title, before.title);
    assert.equal(after.dueDate, before.dueDate);
    assert.equal(after.clientId, clientA);
    assert.deepEqual(after.events.map((e) => [e.kind, e.body]), before.events.map((e) => [e.kind, e.body]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM tickets WHERE id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM tasks WHERE "userId" = ANY($1)', [[A, B, C]]).catch(() => {});
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1)', [[A, B, C]]).catch(() => {});
    await pool.query('DELETE FROM clients WHERE "userId" = ANY($1)', [[A, B, C]]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B, C]]).catch(() => {});
    if (prevFlag == null) await pool.query(`DELETE FROM workspace_settings WHERE key = 'feature_tickets'`).catch(() => {});
    else await pool.query(`UPDATE workspace_settings SET value = $1 WHERE key = 'feature_tickets'`, [prevFlag]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log('tickets: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
