'use strict';
// DATABASE_URL=... node server/services/ticketEmails.db.test.js
// Real database, fake Gmail. Proves:
//   - emails saved from the New ticket form, and found by a regrab, are only ever shown to the person they belong to;
//   - a dismissed thread is not suggested again by a regrab, an attached one stays attached, untouched suggestions are replaced;
//   - each regrab records its time; a status change on someone else's row (or a missing one) is refused;
//   - a person without Gmail connected gets a plain message.
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL) { console.log('SKIP ticketEmails.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const te = require('./ticketEmails');

// a fake Gmail that returns whichever threads `inbox` holds at the time
let inbox = [];
const fakeGmail = {
  users: {
    threads: {
      list: async () => ({ data: { threads: inbox.map((t) => ({ id: t.id })) } }),
      get: async ({ id }) => {
        const t = inbox.find((x) => x.id === id);
        return { data: { id, messages: [{ internalDate: String(Date.parse('2026-11-20')), snippet: t.snippet, payload: { headers: [{ name: 'Subject', value: t.subject }, { name: 'From', value: 'jo@acme.test' }] } }] } };
      },
    },
  },
};
const deps = { gmailFor: async () => ({ gmail: fakeGmail, ownEmail: 'me@vault.test' }) };

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;
  const tag = `ticket-emails-test-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  const ticket = (await pool.query(`INSERT INTO tickets (title, "createdBy") VALUES ('Invoice totals wrong', $1) RETURNING id`, [A])).rows[0].id;

  try {
    // ---- saved from the New ticket form: private to A ----
    await te.saveFromCreate(pool, A, ticket, [
      { threadId: 'aaaa0001', subject: 'Invoice totals', status: 'attached' },
      { threadId: 'aaaa0002', subject: 'Invoice spam', status: 'excluded' },
      { threadId: 'aaaa0003', subject: 'Invoice maybe', status: 'suggested' },
      { threadId: 'not a thread!', subject: 'bad' },
    ], new Date().toISOString());
    let a = await te.list(pool, A, ticket);
    assert.deepEqual(a.emails.map((e) => [e.threadId, e.status]), [['aaaa0001', 'attached'], ['aaaa0003', 'suggested']]);
    assert.deepEqual(a.excluded.map((e) => e.threadId), ['aaaa0002']);
    assert.ok(a.lastRunAt);
    let b = await te.list(pool, B, ticket);
    assert.deepEqual(b, { lastRunAt: null, emails: [], excluded: [] }, 'B sees none of A\'s emails');
    await assert.rejects(te.setStatus(pool, B, ticket, 'aaaa0001', 'excluded'), /not found/, 'B cannot change A\'s row');

    // ---- regrab: dismissed stays dismissed, attached stays attached, old suggestion replaced ----
    inbox = [
      { id: 'aaaa0001', subject: 'Invoice totals', snippet: 'wrong again' },
      { id: 'aaaa0002', subject: 'Invoice spam', snippet: 'totals' },
      { id: 'aaaa0004', subject: 'Re: invoice totals', snippet: 'fixed?' },
    ];
    const before = a.lastRunAt;
    await new Promise((r) => setTimeout(r, 20));
    a = await te.regrab(pool, A, ticket, deps);
    assert.deepEqual(a.emails.map((e) => [e.threadId, e.status]).sort(), [['aaaa0001', 'attached'], ['aaaa0004', 'suggested']]);
    assert.deepEqual(a.excluded.map((e) => e.threadId), ['aaaa0002'], 'dismissed thread is not suggested again');
    assert.ok(new Date(a.lastRunAt) > new Date(before), 'regrab records its time');

    // ---- B regrabs the same ticket: B's own rows only ----
    b = await te.regrab(pool, B, ticket, deps);
    assert.equal(b.emails.length, 3);
    assert.ok(b.emails.every((e) => e.status === 'suggested'), 'A\'s attach and dismiss do not carry over to B');
    assert.equal((await te.list(pool, A, ticket)).emails.length, 2, 'B\'s regrab leaves A\'s rows alone');

    // ---- restore and bad input ----
    a = await te.setStatus(pool, A, ticket, 'aaaa0002', 'suggested');
    assert.equal(a.excluded.length, 0);
    await assert.rejects(te.setStatus(pool, A, ticket, 'aaaa0002', 'deleted'), /not something/);
    await assert.rejects(te.list(pool, A, 999999999), /not found/);

    // ---- no Gmail ----
    await assert.rejects(te.find(pool, A, { title: 'Invoice' }, { gmailFor: async () => null }), /Connect your Gmail/);

    console.log('ticketEmails.db.test.js: all passed');
  } finally {
    await pool.query('DELETE FROM tickets WHERE id = $1', [ticket]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]]);
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
