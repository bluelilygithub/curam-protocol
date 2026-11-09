'use strict';
// node server/services/clientEmailSync.test.js            (the matching rules: no database)
// DATABASE_URL=... node server/services/clientEmailSync.test.js   (also runs a sync against a real database with a fake Gmail)
const assert = require('node:assert/strict');
const {
  SEED_EPOCH, normaliseDomains, parseAddresses, buildQuery, involvesClient, threadEntry, readMessage,
} = require('./clientEmailSync');

// ---- pure rules ----
assert.equal(SEED_EPOCH, Math.floor(Date.parse('2026-06-30T14:00:00Z') / 1000), '1 July 2026 starts at 14:00 UTC the day before (Brisbane)');

assert.deepEqual(normaliseDomains(['@WIWC.com.au', 'https://www.wiwc.com.au/about', 'acme.io', ' ']), { domains: ['wiwc.com.au', 'acme.io'], rejected: [] });
assert.deepEqual(normaliseDomains(['gmail.com', 'not a domain', 'wiwc.com.au']), { domains: ['wiwc.com.au'], rejected: ['gmail.com', 'not a domain'] }, 'free mail and nonsense are refused');
assert.deepEqual(normaliseDomains(undefined), { domains: [], rejected: [] });

assert.deepEqual(parseAddresses('Brett <Brett@WIWC.com.au>, "Q, A" <q@x.io>; brett@wiwc.com.au'), ['brett@wiwc.com.au', 'q@x.io']);
assert.deepEqual(parseAddresses(''), []);

assert.equal(buildQuery({}), null, 'nothing to match, no search');
const q = buildQuery({ addresses: ['brett@gmail.com'], domains: ['wiwc.com.au'], sinceEpoch: 1000 });
assert.match(q, /from:brett@gmail\.com/);
assert.match(q, /to:brett@gmail\.com/);
assert.match(q, /cc:@wiwc\.com\.au/);
assert.match(q, /from:@wiwc\.com\.au/);
assert.ok(q.endsWith(' after:1000'));

const addressSet = new Set(['brett@gmail.com']);
assert.equal(involvesClient('brett@gmail.com', addressSet, []), true);
assert.equal(involvesClient('someone@wiwc.com.au', addressSet, ['wiwc.com.au']), true, 'anyone on the domain');
assert.equal(involvesClient('someone@mail.wiwc.com.au', addressSet, ['wiwc.com.au']), true, 'a sub-domain counts');
assert.equal(involvesClient('someone@notwiwc.com.au', addressSet, ['wiwc.com.au']), false, 'a look-alike domain does not');
assert.equal(involvesClient('other@gmail.com', addressSet, ['wiwc.com.au']), false, 'gmail is matched by address only');

const D = (s) => new Date(s);
const ctx = { ownEmail: 'me@bluelily.com.au', addressSet, domains: ['wiwc.com.au'], contactByEmail: new Map([['brett@gmail.com', 11]]) };
const msg = (o) => ({ threadId: 't1', date: D('2026-08-01T01:00:00Z'), sent: false, subject: 'WIWC application', from: 'brett@gmail.com', to: 'me@bluelily.com.au', cc: '', bulk: false, ...o });

let e = threadEntry([msg({}), msg({ date: D('2026-08-03T01:00:00Z'), sent: true, from: 'me@bluelily.com.au', to: 'Brett <brett@gmail.com>' })], ctx);
assert.equal(e.externalId, 'thread:t1');
assert.equal(e.date.toISOString(), '2026-08-03T01:00:00.000Z', 'dated by the latest message');
assert.equal(e.contactId, 11);
assert.equal(e.note, 'WIWC application\n1 sent, 1 received (2 emails)');
e = threadEntry([msg({ sent: true, from: 'me@bluelily.com.au', to: 'x@wiwc.com.au' })], ctx);
assert.equal(e.note, 'WIWC application\nSent');
assert.equal(e.contactId, null, 'a domain match with no contact leaves the person blank');
assert.equal(threadEntry([msg({ bulk: true })], ctx), null, 'newsletters are skipped');
assert.equal(threadEntry([msg({ from: 'stranger@else.com' })], ctx), null, 'nothing to do with the client');
assert.equal(threadEntry([msg({ from: 'me@bluelily.com.au', to: 'me@bluelily.com.au', sent: true })], { ...ctx, domains: [] }), null, 'mail to yourself is not the client');
assert.equal(threadEntry([msg({ subject: '' })], ctx).title, '(no subject)');

const rm = readMessage({ threadId: 'a', internalDate: '1785546000000', labelIds: ['SENT'], payload: { headers: [{ name: 'subject', value: 'Hi' }, { name: 'List-Unsubscribe', value: '<x>' }] } });
assert.equal(rm.sent, true);
assert.equal(rm.subject, 'Hi');
assert.equal(rm.bulk, true);

console.log('clientEmailSync rules passed');

// ---- a real sync with a fake Gmail ----
if (!process.env.DATABASE_URL) { console.log('SKIP database part: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const { syncClient, syncClientEmails } = require('./clientEmailSync');

function fakeGmail(messages) {
  const calls = [];
  return {
    calls,
    users: { messages: {
      list: async ({ q }) => { calls.push(q); return { data: { messages: messages.map((m) => ({ id: m.id })) } }; },
      get: async ({ id }) => {
        const m = messages.find((x) => x.id === id);
        return { data: { threadId: m.threadId, internalDate: String(Date.parse(m.date)), labelIds: m.sent ? ['SENT'] : ['INBOX'], payload: { headers: [
          { name: 'Subject', value: m.subject }, { name: 'From', value: m.from }, { name: 'To', value: m.to }, ...(m.bulk ? [{ name: 'List-Unsubscribe', value: '<x>' }] : []),
        ] } } };
      },
    } },
  };
}

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;
  const tag = `email-sync-${Date.now()}`;
  const uid = (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}@example.test`])).rows[0].id;
  const cid = (await pool.query(`INSERT INTO clients ("userId", name, status, "emailDomains") VALUES ($1,'WIWC','active','["wiwc.com.au"]') RETURNING id`, [uid])).rows[0].id;
  const contact = (await pool.query(`INSERT INTO client_contacts ("clientId", name, email) VALUES ($1,'Brett','brett@gmail.com') RETURNING id`, [cid])).rows[0].id;
  const rows = () => pool.query(`SELECT * FROM client_interactions WHERE "clientId"=$1 AND source='gmail_sync' ORDER BY date`, [cid]).then((r) => r.rows);
  try {
    const mails = [
      { id: 'm1', threadId: 't1', date: '2026-08-01T01:00:00Z', subject: 'WIWC application', from: 'brett@gmail.com', to: 'me@bluelily.com.au' },
      { id: 'm2', threadId: 't1', date: '2026-08-02T01:00:00Z', subject: 'Re: WIWC application', from: 'me@bluelily.com.au', to: 'brett@gmail.com', sent: true },
      { id: 'm3', threadId: 't2', date: '2026-09-01T01:00:00Z', subject: 'Domain only', from: 'accounts@wiwc.com.au', to: 'me@bluelily.com.au' },
      { id: 'm4', threadId: 't3', date: '2026-09-02T01:00:00Z', subject: 'Newsletter', from: 'news@wiwc.com.au', to: 'me@bluelily.com.au', bulk: true },
      { id: 'm5', threadId: 't4', date: '2026-09-03T01:00:00Z', subject: 'Not theirs', from: 'x@elsewhere.com', to: 'me@bluelily.com.au' },
    ];
    const gmail = fakeGmail(mails);
    const getGmail = async () => ({ gmail, ownEmail: 'me@bluelily.com.au' });

    // the first read goes back to 1 July 2026
    let r = await syncClient({ pool, userId: uid, clientId: cid, getGmail });
    assert.equal(gmail.calls.length, 1);
    assert.ok(gmail.calls[0].endsWith(` after:${SEED_EPOCH}`), gmail.calls[0]);
    assert.match(gmail.calls[0], /from:@wiwc\.com\.au/);
    assert.match(gmail.calls[0], /to:brett@gmail\.com/);
    assert.deepEqual([r.threads, r.created, r.updated], [2, 2, 0], 'two threads: the exchange with Brett, and the domain-only one');
    let logged = await rows();
    assert.equal(logged.length, 2);
    assert.equal(logged[0].type, 'email');
    assert.equal(logged[0].source, 'gmail_sync');
    assert.equal(logged[0].contactId, contact);
    assert.equal(logged[0].note, 'WIWC application\n1 sent, 1 received (2 emails)');
    assert.equal(logged[1].contactId, null);
    assert.ok((await pool.query('SELECT "emailSyncedAt" FROM clients WHERE id=$1', [cid])).rows[0].emailSyncedAt, 'the read is recorded');

    // a later read starts from the last one (less the safety margin), not from July
    r = await syncClient({ pool, userId: uid, clientId: cid, getGmail });
    assert.ok(!gmail.calls[1].endsWith(` after:${SEED_EPOCH}`), 'incremental after the first read');
    assert.deepEqual([r.created, r.updated], [0, 0], 'nothing new is logged twice');
    assert.equal((await rows()).length, 2);

    // a thread that grows moves its entry on and is not duplicated
    mails.push({ id: 'm6', threadId: 't1', date: '2026-10-01T01:00:00Z', subject: 'Re: WIWC application', from: 'brett@gmail.com', to: 'me@bluelily.com.au' });
    r = await syncClient({ pool, userId: uid, clientId: cid, getGmail });
    assert.deepEqual([r.created, r.updated], [0, 1]);
    logged = await rows();
    assert.equal(logged.length, 2);
    assert.match(logged.find((x) => x.externalId === 'thread:t1').note, /1 sent, 2 received \(3 emails\)/);

    // an entry the person edited is left alone while its thread has not grown
    await pool.query(`UPDATE client_interactions SET note='my own words' WHERE "clientId"=$1 AND "externalId"='thread:t2'`, [cid]);
    await syncClientEmails({ pool, gmail, ownEmail: 'me@bluelily.com.au', userId: uid, clientId: cid });
    assert.equal((await rows()).find((x) => x.externalId === 'thread:t2').note, 'my own words');

    // another person's client is not read
    const other = (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-b@example.test`])).rows[0].id;
    try {
      const o = await syncClientEmails({ pool, gmail, userId: other, clientId: cid });
      assert.equal(o.skipped, 'no_client');
    } finally { await pool.query('DELETE FROM users WHERE id=$1', [other]); }

    // a client with nothing to match makes no Gmail call
    const empty = (await pool.query(`INSERT INTO clients ("userId", name, status) VALUES ($1,'Empty','active') RETURNING id`, [uid])).rows[0].id;
    const before = gmail.calls.length;
    r = await syncClient({ pool, userId: uid, clientId: empty, getGmail });
    assert.equal(r.skipped, 'nothing_to_match');
    assert.equal(gmail.calls.length, before);

    // Gmail not connected: skipped, nothing recorded
    assert.equal((await syncClient({ pool, userId: uid, clientId: cid, getGmail: async () => null })).skipped, 'gmail_not_connected');
  } finally {
    await pool.query('DELETE FROM clients WHERE "userId"=$1', [uid]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log('clientEmailSync: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
