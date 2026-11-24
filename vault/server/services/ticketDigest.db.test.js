'use strict';
// DATABASE_URL=... node server/services/ticketDigest.db.test.js
// Real database; email and the list of people are stubbed. Proves the daily digest:
//   - lists a person's open tickets that are overdue, due today, and newly assigned to them by someone else (raised already assigned, or an
//     "Assigned" history line), each once; done tickets and other people's tickets are left out;
//   - sends nothing to someone with nothing to report;
//   - sends at most once a day per person, and a failed send is tried again on the next run;
//   - "today" is the workspace time zone's day; the email escapes ticket titles.
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL) { console.log('SKIP ticketDigest.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const { runDigest, dayIn, buildEmail } = require('./ticketDigest');

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;

  assert.equal(dayIn('Australia/Brisbane', new Date('2026-11-24T15:30:00Z')), '2026-11-25', 'Brisbane is already tomorrow');
  assert.equal(dayIn('UTC', new Date('2026-11-24T15:30:00Z')), '2026-11-24');
  assert.match(buildEmail({ digest: { overdue: [{ id: 1, title: '<b>x</b>', type: 'bug', priority: 'high', dueDate: '2026-11-01' }], dueToday: [], assigned: [] }, appUrl: 'https://v.test/', today: '2026-11-24' }).html, /&lt;b&gt;x&lt;\/b&gt;/);

  const tag = `digest-test-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id, email`, [`${tag}-${n}@example.test`])).rows[0];
  const A = await mk('a');
  const B = await mk('b');
  const C = await mk('c'); // nothing assigned
  const today = '2026-11-24';
  const now = new Date('2026-11-23T21:00:00Z'); // 07:00 in Brisbane on the 24th
  const t = async (title, extra) => {
    const cols = Object.keys(extra); const vals = Object.values(extra);
    const { rows } = await pool.query(`INSERT INTO tickets (title, ${cols.map((c) => `"${c}"`).join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`, [title, ...vals]);
    return rows[0].id;
  };
  const overdue = await t(`${tag} overdue`, { assigneeId: A.id, createdBy: A.id, dueDate: '2026-11-20', createdAt: '2026-11-01' });
  const dueToday = await t(`${tag} today`, { assigneeId: A.id, createdBy: B.id, dueDate: today });
  await t(`${tag} done`, { assigneeId: A.id, createdBy: A.id, dueDate: '2026-11-20', status: 'done' });
  const raisedForA = await t(`${tag} raised for A`, { assigneeId: A.id, createdBy: B.id, createdAt: '2026-11-23T10:00:00Z' });
  const ownNew = await t(`${tag} A raised for self`, { assigneeId: A.id, createdBy: A.id, createdAt: '2026-11-23T10:00:00Z' });
  const reassigned = await t(`${tag} reassigned`, { assigneeId: A.id, createdBy: B.id, createdAt: '2026-10-01' });
  await pool.query(`INSERT INTO ticket_events ("ticketId","userId",kind,body,"createdAt") VALUES ($1,$2,'change',$3,'2026-11-23T12:00:00Z')`, [reassigned, B.id, `Assigned: none → ${A.email}`]);
  const oldAssigned = await t(`${tag} old`, { assigneeId: A.id, createdBy: B.id, createdAt: '2026-10-01' });
  await t(`${tag} B's`, { assigneeId: B.id, createdBy: A.id, dueDate: '2026-11-20', createdAt: '2026-11-01' });

  const sent = [];
  let failNext = false;
  const deps = {
    pool, now, timeZone: 'Australia/Brisbane', appUrl: 'https://vault.test',
    people: async () => [A, B, C].map(({ id, email }) => ({ id, email })),
    sendEmail: async (m) => { if (failNext) { failNext = false; throw new Error('smtp down'); } sent.push(m); return { ok: true }; },
  };

  try {
    let r = await runDigest(deps);
    assert.equal(r.day, today);
    assert.deepEqual([r.sent, r.empty, r.failed], [2, 1, 0], JSON.stringify(r));
    const toA = sent.find((m) => m.to === A.email);
    assert.match(toA.subject, /^Tickets: 1 overdue, 1 due today, 2 newly assigned$/);
    for (const id of [overdue, dueToday, raisedForA, reassigned]) assert.ok(toA.html.includes(`https://vault.test/tickets/${id}`), `T-${id} listed`);
    for (const id of [ownNew, oldAssigned]) assert.ok(!toA.html.includes(`/tickets/${id}"`), `T-${id} not listed`);
    assert.ok(!toA.html.includes(`${tag} done`));
    assert.match(sent.find((m) => m.to === B.email).subject, /1 overdue/);

    // the same day again: nothing more
    sent.length = 0;
    r = await runDigest(deps);
    assert.equal(r.sent, 0);
    assert.equal(r.already, 2);

    // the next day: a failed send is tried again on the next run
    const tomorrow = { ...deps, now: new Date('2026-11-24T21:00:00Z') };
    failNext = true;
    r = await runDigest(tomorrow);
    assert.equal(r.failed, 1);
    r = await runDigest(tomorrow);
    assert.equal(r.sent, 1, 'the one that failed is sent now; the other already had its digest');
  } finally {
    await pool.query('DELETE FROM tickets WHERE title LIKE $1', [`${tag}%`]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A.id, B.id, C.id]]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log('ticketDigest: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
