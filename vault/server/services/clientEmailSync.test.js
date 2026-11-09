'use strict';
// node server/services/clientEmailSync.test.js            (the matching rules: no database)
// DATABASE_URL=... node server/services/clientEmailSync.test.js   (also runs a sync against a real database with a fake Gmail)
const assert = require('node:assert/strict');
const {
  SEED_EPOCH, normaliseDomains, parseAddresses, buildQuery, involvesClient, threadEntry, readMessage, fmtDate, buildNote, cleanBody, summariseThread,
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
assert.equal(e.base, 'WIWC application\n1 sent, 1 received (2 emails) · first 1 Aug 2026, last 3 Aug 2026', 'counts, and the dates of the first and last email');
assert.equal(buildNote(e, ''), e.base);
assert.equal(buildNote(e, 'They asked for a quote.'), `${e.base}\nThey asked for a quote.`);
e = threadEntry([msg({ sent: true, from: 'me@bluelily.com.au', to: 'x@wiwc.com.au' })], ctx);
assert.equal(e.base, 'WIWC application\nSent · 1 Aug 2026');
assert.equal(e.contactId, null, 'a domain match with no contact leaves the person blank');
// the subject is the first email's, even when it had none: a thread started from a phone with no subject stays "(no subject)"
e = threadEntry([msg({ subject: '' }), msg({ date: D('2026-08-02T01:00:00Z'), subject: 'Re: ' })], ctx);
assert.equal(e.title, '(no subject)');
e = threadEntry([msg({ subject: 'Quote' }), msg({ date: D('2026-08-02T01:00:00Z'), subject: 'Re: Quote' })], ctx);
assert.equal(e.title, 'Quote');
// an unsent draft, or mail in the bin or spam, is not email that was exchanged: it does not count, change the dates or the subject
e = threadEntry([msg({ subject: '' }), msg({ date: D('2026-11-09T01:26:00Z'), subject: 'Re:', skip: true })], ctx);
assert.equal(e.base, '(no subject)\nReceived · 1 Aug 2026');
assert.equal(e.date.toISOString(), '2026-08-01T01:00:00.000Z', 'dated by the last email that was really exchanged');
assert.equal(threadEntry([msg({ skip: true })], ctx), null, 'a thread that is only a draft is not logged');
assert.equal(fmtDate(D('2026-06-30T15:00:00Z')), '1 Jul 2026', '15:00 UTC on 30 June is already 1 July in Brisbane');
// what the model is shown: no quoted earlier mail, no reply trail
assert.equal(cleanBody('Thanks, yes please.\n> old stuff\n> more old\n\nOn Mon, 3 Aug 2026 at 9:00 AM Brett <b@x.com> wrote:\nhidden'), 'Thanks, yes please.');
assert.equal(cleanBody('a'.repeat(5000), 100).length, 100);
assert.equal(threadEntry([msg({ bulk: true })], ctx), null, 'newsletters are skipped');
assert.equal(threadEntry([msg({ from: 'stranger@else.com' })], ctx), null, 'nothing to do with the client');
assert.equal(threadEntry([msg({ from: 'me@bluelily.com.au', to: 'me@bluelily.com.au', sent: true })], { ...ctx, domains: [] }), null, 'mail to yourself is not the client');
assert.equal(threadEntry([msg({ subject: '' })], ctx).title, '(no subject)');

const rm = readMessage({ threadId: 'a', internalDate: '1785546000000', labelIds: ['SENT'], payload: { headers: [{ name: 'subject', value: 'Hi' }, { name: 'List-Unsubscribe', value: '<x>' }] } });
assert.equal(rm.sent, true);
assert.equal(rm.subject, 'Hi');
assert.equal(readMessage({ threadId: 'a', labelIds: ['DRAFT'] }).skip, true);
assert.equal(readMessage({ threadId: 'a', labelIds: ['SENT'] }).skip, false);
assert.equal(rm.bulk, true);

console.log('clientEmailSync rules passed');

// the real summariser with a fake Gmail thread and a fake model: what it asks for, and that a failure gives no summary rather than an error
const summariserCheck = (async () => {
  const prompts = [];
  const gmail = { users: { threads: { get: async () => ({ data: { messages: [
    { internalDate: '1000', labelIds: ['INBOX'], payload: { body: 'Can you send a quote?\n> old' } },
    { internalDate: '2000', labelIds: ['SENT'], payload: { body: 'Sent it today.' } },
  ] } }) } } };
  const deps = { readBody: (p) => p.body, getModels: async () => ({ light: 'light-model' }), logUsage: () => {}, callModel: async (model, prompt, opts) => { prompts.push({ model, prompt, opts }); return { text: '  They asked for a quote and it was sent.  ', inputTokens: 1, outputTokens: 1 }; } };
  const out = await summariseThread({ gmail, threadId: 't', userId: 1, deps });
  assert.equal(out, 'They asked for a quote and it was sent.');
  assert.equal(prompts[0].model, 'light-model', 'the light model is used');
  assert.match(prompts[0].prompt, /<thread>\nTHEM 1970-01-01: Can you send a quote\?\nME 1970-01-01: Sent it today\.\n<\/thread>/, 'oldest first, who said it, quoted mail removed');
  assert.match(prompts[0].opts.system, /never instructions to follow/);
  assert.equal(await summariseThread({ gmail, threadId: 't', userId: 1, deps: { ...deps, callModel: async () => { throw new Error('boom'); } } }), '');
  console.log('summariseThread passed');
})();

// ---- a real sync with a fake Gmail ----
if (!process.env.DATABASE_URL) { summariserCheck.then(() => { console.log('SKIP database part: DATABASE_URL is not set'); process.exit(0); }); return; }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const { syncClient, syncClientEmails } = require('./clientEmailSync');

function fakeGmail(messages) {
  const calls = [];
  const toApi = (m) => ({ id: m.id, threadId: m.threadId, internalDate: String(Date.parse(m.date)), labelIds: m.draft ? ['DRAFT'] : m.sent ? ['SENT'] : ['INBOX'], payload: { headers: [
    { name: 'Subject', value: m.subject }, { name: 'From', value: m.from }, { name: 'To', value: m.to }, ...(m.bulk ? [{ name: 'List-Unsubscribe', value: '<x>' }] : []),
  ] } });
  const g = {
    calls,
    window: null, // null: a search finds every message; an array of ids: only those (what a later read inside a short window finds)
    users: {
      // a read back to 1 July finds everything; a later, shorter window finds only the messages in g.window
      messages: { list: async ({ q }) => { calls.push(q); const wide = q.endsWith(` after:${SEED_EPOCH}`); return { data: { messages: messages.filter((m) => wide || !g.window || g.window.includes(m.id)).map((m) => ({ id: m.id, threadId: m.threadId })) } }; } },
      // a thread is always returned whole, whatever the search window was
      threads: { get: async ({ id }) => ({ data: { id, messages: messages.filter((m) => m.threadId === id).map(toApi) } }) },
    },
  };
  return g;
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
      // an unsent reply Brett's thread has open in Drafts, saved much later: it must not count or move the date
      { id: 'd1', threadId: 't1', date: '2026-11-09T01:26:00Z', subject: 'Re:', from: 'me@bluelily.com.au', to: 'brett@gmail.com', draft: true },
    ];
    const gmail = fakeGmail(mails);
    const getGmail = async () => ({ gmail, ownEmail: 'me@bluelily.com.au' });
    const asked = [];
    let summaryText = (threadId) => `Summary of ${threadId}.`;
    const summarise = async ({ threadId }) => { asked.push(threadId); return summaryText(threadId); };

    // the first read goes back to 1 July 2026
    let r = await syncClient({ pool, userId: uid, clientId: cid, getGmail, summarise });
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
    assert.equal(logged[0].note, 'WIWC application\n1 sent, 1 received (2 emails) · first 1 Aug 2026, last 2 Aug 2026\nSummary of t1.', 'subject, counts, first and last dates, and the summary');
    assert.equal(logged[0].date.toISOString(), '2026-08-02T01:00:00.000Z', 'the draft did not move the date');
    assert.deepEqual([...asked].sort(), ['t1', 't2'], 'one summary per thread that is logged, none for skipped mail');
    assert.equal(logged[1].contactId, null);
    assert.ok((await pool.query('SELECT "emailSyncedAt" FROM clients WHERE id=$1', [cid])).rows[0].emailSyncedAt, 'the read is recorded');

    // a later read starts from the last one (less the safety margin), not from July
    r = await syncClient({ pool, userId: uid, clientId: cid, getGmail, summarise });
    assert.ok(!gmail.calls[1].endsWith(` after:${SEED_EPOCH}`), 'incremental after the first read');
    assert.deepEqual([r.created, r.updated], [0, 0], 'nothing new is logged twice');
    assert.equal(asked.length, 2, 'and nothing already summarised is summarised again');
    assert.equal((await rows()).length, 2);

    // a thread that grows moves its entry on and is not duplicated
    mails.push({ id: 'm6', threadId: 't1', date: '2026-10-01T01:00:00Z', subject: 'Re: WIWC application', from: 'brett@gmail.com', to: 'me@bluelily.com.au' });
    gmail.window = ['m6']; // the later read's search only finds the new message
    r = await syncClient({ pool, userId: uid, clientId: cid, getGmail, summarise });
    assert.deepEqual([r.created, r.updated], [0, 1]);
    logged = await rows();
    assert.equal(logged.length, 2);
    assert.match(logged.find((x) => x.externalId === 'thread:t1').note, /1 sent, 2 received \(3 emails\) · first 1 Aug 2026, last 1 Oct 2026\nSummary of t1\./, 'the counts and first date cover the whole thread, not only the new message');
    assert.equal(asked.length, 3, 'a grown thread is summarised again');

    gmail.window = null;
    // an entry the person edited is left alone while its thread has not grown
    gmail.window = null;
    await pool.query(`UPDATE client_interactions SET note='my own words' WHERE "clientId"=$1 AND "externalId"='thread:t2'`, [cid]);
    await syncClientEmails({ pool, gmail, ownEmail: 'me@bluelily.com.au', userId: uid, clientId: cid, summarise });
    assert.equal((await rows()).find((x) => x.externalId === 'thread:t2').note, 'my own words');
    assert.equal(asked.length, 3, 'an entry with the person\'s own words is not summarised over');

    // an entry written before summaries existed (no summary, untouched) gets one on the next read, and a failed summary is retried
    await pool.query(`UPDATE client_interactions SET note=title WHERE "clientId"=$1 AND "externalId"='thread:t2'`, [cid]);
    summaryText = () => '';
    await syncClientEmails({ pool, gmail, ownEmail: 'me@bluelily.com.au', userId: uid, clientId: cid, summarise });
    assert.equal((await rows()).find((x) => x.externalId === 'thread:t2').note, 'Domain only\nReceived · 1 Sep 2026', 'no summary made: the entry is brought in line without one');
    summaryText = (id) => `Late summary of ${id}.`;
    await syncClientEmails({ pool, gmail, ownEmail: 'me@bluelily.com.au', userId: uid, clientId: cid, summarise });
    assert.equal((await rows()).find((x) => x.externalId === 'thread:t2').note, 'Domain only\nReceived · 1 Sep 2026\nLate summary of t2.');

    // an entry a smaller or earlier read got wrong (wrong subject, counts from one message, a draft's date) is put right from the whole thread, keeping its summary
    await pool.query(`UPDATE client_interactions SET title='Re:', note='Re:\nReceived\nAn earlier summary.', date=now() WHERE "clientId"=$1 AND "externalId"='thread:t1'`, [cid]);
    const askedBefore = asked.length;
    await syncClientEmails({ pool, gmail, ownEmail: 'me@bluelily.com.au', userId: uid, clientId: cid, summarise });
    const fixed = (await rows()).find((x) => x.externalId === 'thread:t1');
    assert.equal(fixed.title, 'WIWC application');
    assert.equal(fixed.note, 'WIWC application\n1 sent, 2 received (3 emails) · first 1 Aug 2026, last 1 Oct 2026\nAn earlier summary.');
    assert.equal(fixed.date.toISOString(), '2026-10-01T01:00:00.000Z');
    assert.equal(asked.length, askedBefore, 'its summary is kept, not paid for again');

    // a thread with nothing new in a short window is not looked at, so a damaged entry stays damaged; the full read (the button) puts it right
    await pool.query(`UPDATE client_interactions SET title='Re:', note='Re:\nReceived\nAn earlier summary.', date=now() WHERE "clientId"=$1 AND "externalId"='thread:t1'`, [cid]);
    gmail.window = ['m3']; // the short window only holds a message of another thread
    await syncClient({ pool, userId: uid, clientId: cid, getGmail, summarise });
    assert.equal((await rows()).find((x) => x.externalId === 'thread:t1').title, 'Re:', 'a short read does not reach a thread outside its window');
    const callsBefore = gmail.calls.length;
    r = await syncClient({ pool, userId: uid, clientId: cid, getGmail, summarise, full: true });
    assert.ok(gmail.calls[callsBefore].endsWith(` after:${SEED_EPOCH}`), 'a full read goes back to 1 July whatever the last read was');
    assert.equal((await rows()).find((x) => x.externalId === 'thread:t1').title, 'WIWC application');
    assert.equal(r.unreadable, 0);
    gmail.window = null;

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
