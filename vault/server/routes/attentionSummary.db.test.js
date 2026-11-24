'use strict';
// DATABASE_URL=... node server/routes/attentionSummary.db.test.js
// Real database, fake sign-in. Proves GET /api/attention/summary (the Home page sidebar) runs every source's query without error and counts
// what is waiting for one admin: an overdue task, a plan step past its end, a ticket of theirs overdue, an urgent email, a follow-up draft.
// A query that fails is quietly left out by the route (so a page never breaks), which is why this test fails on any "[attention]" error.
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP attentionSummary.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const failures = [];
const realErr = console.error;
console.error = (...a) => { if (String(a[0]).includes('[attention]')) failures.push(a.join(' ')); else realErr(...a); };
const { pool } = require('../db');
const router = require('./attention');

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;
  const tag = `attn-test-${Date.now()}`;
  const A = (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',TRUE) RETURNING id`, [`${tag}@example.test`])).rows[0].id;
  const app = express();
  app.use((req, _res, next) => { req.user = { id: A, isAdmin: true }; next(); });
  app.use('/api/attention', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const get = async () => (await fetch(`http://127.0.0.1:${server.address().port}/api/attention/summary`)).json();

  try {
    // nothing yet: every area is there (an admin has every feature), each with nothing waiting
    let { areas } = await get();
    assert.deepEqual(failures, [], 'no source query failed');
    assert.deepEqual(areas.map((a) => a.id), ['tasks', 'notes', 'plans', 'invoices', 'tickets', 'emails']);
    assert.ok(areas.every((a) => a.total === 0 && a.lines.length === 0), JSON.stringify(areas));

    await pool.query(`INSERT INTO tasks (title, "userId", status, "dueDate") VALUES ('Old task', $1, 'todo', '2020-01-01')`, [A]);
    const plan = (await pool.query(`INSERT INTO plans ("userId", title, status) VALUES ($1, 'Site move', 'active') RETURNING id`, [A])).rows[0].id;
    await pool.query(`INSERT INTO plan_steps ("planId", "userId", title, "startDate", "durationDays") VALUES ($1, $2, 'Book movers', '2020-01-01', 3)`, [plan, A]);
    await pool.query(`INSERT INTO tickets (title, type, status, priority, "dueDate", "createdBy", "assigneeId") VALUES ('Fix login', 'bug', 'open', 'high', '2020-01-01', $1, $1)`, [A]);
    await pool.query(`INSERT INTO gmail_classifications ("userId", "threadId", "lastMessageId", category, "oneLine") VALUES ($1, $2, 'm1', 'urgent', 'Contract needs signing today')`, [String(A), `${tag}-t1`]);
    const kase = (await pool.query(`INSERT INTO ef_cases ("userId", title, obligation, status) VALUES ($1, 'Refund', 'They owe a refund', 'active') RETURNING id`, [A])).rows[0].id;
    await pool.query(`INSERT INTO ef_drafts ("caseId", "userId", "rowId", content, hash, verdict) VALUES ($1, $2, 'r1', '{}', 'h', '{}')`, [kase, A]);

    ({ areas } = await get());
    assert.deepEqual(failures, [], 'no source query failed');
    const by = Object.fromEntries(areas.map((a) => [a.id, a]));
    assert.equal(by.tasks.lines[0].text, '1 task overdue');
    assert.equal(by.plans.lines[0].text, '1 step past its end date');
    assert.match(by.plans.lines[0].detail, /Book movers \(Site move\)/);
    assert.deepEqual(by.tickets.lines.map((l) => l.text), ['1 ticket of yours overdue', '1 ticket assigned to you']);
    assert.equal(by.emails.lines[0].detail, 'Contract needs signing today');
    assert.equal(by.emails.lines[1].text, '1 follow-up draft to approve');
    assert.equal(by.notes.total, 0, 'no reminders');
    console.log('attentionSummary.db: all passed');
  } finally {
    server.close();
    await pool.query(`DELETE FROM gmail_classifications WHERE "userId" = $1`, [String(A)]);
    await pool.query(`DELETE FROM tickets WHERE "createdBy" = $1`, [A]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [A]);
    await pool.end();
  }
})().catch((e) => { console.error = realErr; console.error(e); process.exit(1); });
