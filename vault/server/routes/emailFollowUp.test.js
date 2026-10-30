'use strict';

// Route and storage tests for Email Follow-Up, against a real (throwaway, LOCAL) Postgres with a stand-in for Gmail and for the model.
// The rule suite (services/emailFollowUp/emailFollowUp.test.js) cannot see these: they are about what the app DOES with the rules.
//   EF_TEST_DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local node server/routes/emailFollowUp.test.js
// Without that variable it prints SKIPPED and exits 0 (a skipped test is never reported as a pass). It creates two users and deletes them
// (and everything of theirs) at the end. It refuses a database that is not on this machine.

const url = process.env.EF_TEST_DATABASE_URL;
if (!url) { console.log('SKIPPED email-follow-up routes: set EF_TEST_DATABASE_URL to a throwaway Postgres on this machine'); process.exit(0); }
try { if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('not local'); } catch { console.error('REFUSED: EF_TEST_DATABASE_URL must point at this machine'); process.exit(1); }
process.env.DATABASE_URL = url;

const express = require('express');
const { pool, initSchema } = require('../db');

const failures = [];
const ok = (name, cond, extra) => { if (cond) console.log(`  ok   ${name}`); else { failures.push(name); console.log(`  FAIL ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await initSchema();
  const stamp = Date.now();
  const mkUser = async (n) => (await pool.query(`INSERT INTO users (email, "passwordHash") VALUES ($1,'x') RETURNING id`, [`ef-test-${n}-${stamp}@example.test`])).rows[0].id;
  const userA = await mkUser('a');
  const userB = await mkUser('b');

  // stand-ins: Gmail (nothing in Sent, nothing new in threads; can be made to fail) and the model
  let gmailFails = false;
  let threadPages = null;   // Find mail: pages of thread ids, newest first (null = nothing)
  let sentPages = null;     // Check Sent: pages of message ids (null = nothing)
  const sentQueries = [];   // the searches the Sent check made
  const downloaded = [];    // Sent messages actually downloaded
  const page = (pages, token) => { const i = token ? Number(token) : 0; return { items: pages[i] || [], next: i + 1 < pages.length ? String(i + 1) : undefined }; };
  const fakeGmail = { users: {
    messages: {
      list: async ({ q, pageToken }) => {
        if (gmailFails) throw new Error('Gmail is down');
        sentQueries.push(q);
        if (!sentPages) return { data: { messages: [] } };
        const p = page(sentPages, pageToken);
        return { data: { messages: p.items.map((id) => ({ id })), nextPageToken: p.next } };
      },
      get: async ({ id }) => {
        downloaded.push(id);
        return { data: { id, threadId: `t-${id}`, internalDate: String(Date.now()), labelIds: ['SENT'], payload: { mimeType: 'text/plain', headers: [{ name: 'To', value: 'p@client.test' }, { name: 'Subject', value: `S ${id}` }, { name: 'From', value: 'me@x.test' }], body: { data: Buffer.from(`hello ${id}`).toString('base64') } } } };
      },
    },
    threads: {
      get: async ({ id }) => ({ data: { messages: [{ id: `${id}-m`, internalDate: String(Date.now() - 86400000), payload: { headers: [{ name: 'Subject', value: `Subject ${id}` }, { name: 'From', value: 'p@client.test' }] } }] } }),
      list: async ({ pageToken }) => {
        if (!threadPages) return { data: { threads: [] } };
        const p = page(threadPages, pageToken);
        return { data: { threads: p.items.map((id) => ({ id, snippet: `snippet ${id}` })), nextPageToken: p.next } };
      },
    },
  } };
  require('./gmail').getGmailClient = async () => fakeGmail;

  const extractMod = require('../services/emailFollowUp/extract');
  let modelDelayMs = 0;
  let failOnSourceText = null;
  const readCalls = [];
  extractMod.extractFromSource = async (userId, source, ctx) => {
    readCalls.push(source.id);
    if (modelDelayMs) await sleep(modelDelayMs);
    if (failOnSourceText && source.text.includes(failOnSourceText)) throw new Error('the AI timed out');
    const item = (source.text.match(/item-\d+/) || ['item-0'])[0];
    return extractMod.normalizeMentions(JSON.stringify({ mentions: [{ kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: [item], itemNoun: 'document', claimType: 'agreed', dueRaw: null, quote: `owes ${item}` }] }), source, ctx);
  };

  const store = require('../services/emailFollowUp/caseStore');
  const ledgerLib = require('../services/emailFollowUp/ledger');
  const approvalLib = require('../services/emailFollowUp/approval');
  const { buildNudgeDraft } = require('../services/emailFollowUp/draft');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: Number(req.headers['x-user'] || userA) }; next(); });
  app.use('/api/email-follow-up', require('./emailFollowUp'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/email-follow-up`;
  const call = async (method, path, body, user) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': String(user || userA) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const newCase = async (extra = {}, user = userA) => (await call('POST', '/', { title: 'T', obligation: 'They owe items', aliases: ['p@client.test'], ...extra }, user)).body.case;
  const addMsg = (userId, caseId, i, ext = `m-${i}-${Math.random()}`) => store.addSource(userId, caseId, {
    channel: 'inbound', externalId: ext, threadId: `thread-${caseId}-${i}`, subject: `S${i}`, fromAddr: 'P <p@client.test>', toAddr: 'me@x.test', messageIdHeader: `<${ext}@x>`,
    receivedAt: new Date(Date.now() - (10 - i) * 3600000).toISOString(), text: `Hello. The client owes item-${i} and should send it.`,
  });
  const ledgerOf = async (caseId) => (await pool.query('SELECT ledger FROM ef_cases WHERE id=$1', [caseId])).rows[0].ledger;
  const extractedOf = async (caseId) => (await pool.query('SELECT id, "extractedAt" FROM ef_sources WHERE "caseId"=$1 ORDER BY id', [caseId])).rows;

  try {
    // ---- M1: a client or project id from the request must be the caller's own ----
    console.log('ownership');
    const clientA = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'A client') RETURNING id`, [userA])).rows[0].id;
    const clientB = (await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'B client') RETURNING id`, [userB])).rows[0].id;
    let r = await call('POST', '/', { title: 'x', obligation: 'y', clientId: clientA }, userB);
    ok("another person's client is refused on create", r.status === 400, r);
    r = await call('POST', '/', { title: 'x', obligation: 'y', clientId: clientB }, userB);
    ok('your own client is accepted', r.status === 201 && r.body.case.clientId === clientB, r);
    const caseB = r.body.case;
    r = await call('PATCH', `/${caseB.id}`, { clientId: clientA }, userB);
    ok("another person's client is refused on patch", r.status === 400, r);
    const projA = (await pool.query(`INSERT INTO projects (name, "userId") VALUES ('A proj',$1) RETURNING id`, [userA])).rows[0].id;
    r = await call('POST', '/', { title: 'x', obligation: 'y', projectId: projA }, userB);
    ok("another person's project is refused", r.status === 400, r);
    r = await call('GET', `/${caseB.id}`, null, userA);
    ok("another person cannot read the case", r.status === 404, r.status);
    r = await call('GET', `/?clientId=${clientB}`, null, userB);
    ok("a client's page lists that client's cases, with the client's name", r.status === 200 && r.body.cases.length === 1 && r.body.cases[0].id === caseB.id && r.body.cases[0].clientName === 'B client', r.body);
    r = await call('GET', `/?clientId=${clientA}`, null, userB);
    ok("someone else's client id lists nothing", r.status === 200 && r.body.cases.length === 0, r.body);
    r = await call('GET', `/${caseB.id}`, null, userB);
    ok('the case itself carries its client name (for the Open in CRM link)', r.body.case.clientId === clientB && r.body.case.clientName === 'B client', r.body.case);
    r = await call('PATCH', `/${caseB.id}`, { clientId: null }, userB);
    ok('a case can be unlinked from its client', r.status === 200 && r.body.case.clientId === null, r.body);

    // ---- H1: a failed Read keeps what was read before it ----
    console.log('extract keeps its work');
    const c1 = await newCase();
    for (let i = 1; i <= 3; i += 1) await addMsg(userA, c1.id, i);
    failOnSourceText = 'item-3';
    r = await call('POST', `/${c1.id}/extract`, {});
    ok('a failure on the third message is reported, not hidden', r.status === 200 && r.body.stopped && r.body.read === 2, r.body);
    let rows = await ledgerOf(c1.id);
    ok('the first two messages are kept (two rows)', rows.length === 2, rows.map((x) => x.items));
    ok('the first two are marked read, the third is not', (await extractedOf(c1.id)).filter((s) => s.extractedAt).length === 2);
    failOnSourceText = null;
    r = await call('POST', `/${c1.id}/extract`, {});
    ok('pressing again reads only the third', r.status === 200 && r.body.read === 1 && !r.body.stopped, r.body);
    rows = await ledgerOf(c1.id);
    ok('three rows, none twice', rows.length === 3 && rows.every((x) => x.anchors.length === 1), rows.map((x) => [x.items, x.anchors.length]));
    r = await call('POST', `/${c1.id}/extract`, {});
    ok('nothing left to read: no change', r.body.read === 0 && (await ledgerOf(c1.id)).length === 3, r.body);

    // a model that fails on the very first message is an error the person sees
    const c1b = await newCase();
    await addMsg(userA, c1b.id, 1);
    failOnSourceText = 'item-1';
    r = await call('POST', `/${c1b.id}/extract`, {});
    ok('a failure with nothing read yet is an error', r.status === 500, r);
    ok('and nothing was marked read', (await extractedOf(c1b.id)).every((s) => !s.extractedAt));
    failOnSourceText = null;

    // ---- H1: two Reads at once do not double up or lose anything ----
    console.log('two at once');
    const c2 = await newCase();
    for (let i = 1; i <= 3; i += 1) await addMsg(userA, c2.id, i);
    modelDelayMs = 120;
    const both = await Promise.all([call('POST', `/${c2.id}/extract`, {}), call('POST', `/${c2.id}/extract`, {})]);
    modelDelayMs = 0;
    rows = await ledgerOf(c2.id);
    ok('both presses succeed', both.every((x) => x.status === 200), both.map((x) => x.status));
    ok('three rows, each from one reading only', rows.length === 3 && rows.every((x) => x.anchors.length === 1), rows.map((x) => [x.items, x.anchors.length]));
    ok('every message marked read', (await extractedOf(c2.id)).every((s) => s.extractedAt));

    // ---- H1: a Read and another change at once: neither overwrites the other ----
    console.log('a Read while something else changes');
    const c3 = await newCase();
    await store.withLedger(userA, c3.id, async (l) => ({ ledger: ledgerLib.applyMention(l, { kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: ['seed'], claimType: 'agreed', quote: 'seed' }).rows, value: 1 }));
    await addMsg(userA, c3.id, 9);
    modelDelayMs = 300;
    const reading = call('POST', `/${c3.id}/extract`, {});
    await sleep(60);
    const tasking = await call('POST', `/${c3.id}/rows/r1/task`, {});
    const readDone = await reading;
    modelDelayMs = 0;
    rows = await ledgerOf(c3.id);
    ok('the task was made while the AI was reading', tasking.status === 201, tasking);
    ok('both changes survive: the new row AND the link to the task', readDone.status === 200 && rows.length === 2 && rows.find((x) => x.id === 'r1').taskId === tasking.body.taskId, rows.map((x) => [x.id, x.taskId]));
    await pool.query('DELETE FROM tasks WHERE id=$1', [tasking.body.taskId]);

    // ---- the lock itself: two slow read-modify-writes at the same moment take turns ----
    console.log('the ledger lock');
    const cLock = await newCase();
    const slowAdd = (item) => store.withLedger(userA, cLock.id, async (l) => {
      await sleep(120); // time for the other one to read the same ledger, if nothing stops it
      return { ledger: ledgerLib.applyMention(l, { kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: [item], claimType: 'agreed', quote: item }, { newId: () => `r${l.length + 1}` }).rows, value: 1 };
    });
    await Promise.all([slowAdd('first'), slowAdd('second')]);
    const lockRows = await ledgerOf(cLock.id);
    ok('both changes are kept (the later one did not overwrite the earlier)', lockRows.length === 2 && new Set(lockRows.map((x) => x.id)).size === 2, lockRows.map((x) => [x.id, x.items]));
    let rolledBack = false;
    await store.withLedger(userA, cLock.id, async () => { throw new Error('boom'); }).catch(() => { rolledBack = true; });
    ok('a change that throws leaves the ledger as it was', rolledBack && (await ledgerOf(cLock.id)).length === 2);

    // ---- M2: changing the checking sends approved drafts back; copy re-checks ----
    console.log('profile change and copy');
    const c4 = await newCase({ profile: 'soft' });
    const src = await addMsg(userA, c4.id, 4);
    const srcRow = (await store.listSources(c4.id, { withText: true })).find((s) => s.id === src.id);
    const mentions = extractMod.normalizeMentions(JSON.stringify({ mentions: [{ kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: ['item-4'], claimType: 'agreed', quote: 'owes item-4' }] }), { ...srcRow, receivedAt: new Date(srcRow.receivedAt).toISOString() }, { tz: 'Australia/Brisbane' }).mentions;
    await store.withLedger(userA, c4.id, async (l) => ({ ledger: ledgerLib.applyMention(l, mentions[0], { newId: () => 'r1' }).rows, value: 1 }));
    const row = (await ledgerOf(c4.id))[0];
    const draftContent = { ...buildNudgeDraft(row, { to: ['p@client.test'], threadIds: [] }), notes: [] };
    const hash = approvalLib.draftHash({ ...draftContent, id: null, version: 1 });
    const approvedDraft = async () => {
      const d = await store.insertDraft(userA, c4.id, 'r1', draftContent, hash, { verdict: 'pass', results: [], reasons: [] });
      await store.addApproval(d.id, 1, hash, 'approved', userA, []);
      await store.setDraftStatus(d.id, 'approved');
      return d;
    };
    let d1 = await approvedDraft();
    r = await call('POST', `/drafts/${d1.id}/copy`, {});
    ok('an approved draft copies', r.status === 200 && r.body.ok, r);
    r = await call('PATCH', `/${c4.id}`, { profile: 'professional' });
    ok('the profile changed', r.body.case && r.body.case.profile === 'professional', r);
    ok('so the approved draft went back to pending', (await store.getDraft(userA, d1.id)).status === 'pending');
    r = await call('PATCH', `/${c4.id}`, { profile: 'professional' });
    const d2 = await approvedDraft();
    ok('re-saving the same profile does not disturb approvals', (await store.getDraft(userA, d2.id)).status === 'approved');
    await pool.query(`UPDATE ef_sources SET "parseStatus"='failed' WHERE id=$1`, [src.id]);
    r = await call('POST', `/drafts/${d2.id}/copy`, {});
    ok('copy re-runs the check: a source that has since become unreadable stops it', r.status === 409 && /check has changed/.test(r.body.reason || ''), r);
    ok('and the draft is back to pending', (await store.getDraft(userA, d2.id)).status === 'pending');

    // ---- M3: Draft follow-up checks Sent itself when the last check is stale ----
    console.log('Sent check on demand');
    const c5 = await newCase();
    const s5 = await addMsg(userA, c5.id, 5);
    const src5 = (await store.listSources(c5.id, { withText: true })).find((s) => s.id === s5.id);
    const m5 = extractMod.normalizeMentions(JSON.stringify({ mentions: [{ kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: ['item-5'], claimType: 'agreed', quote: 'owes item-5' }] }), { ...src5, receivedAt: new Date(src5.receivedAt).toISOString() }, { tz: 'Australia/Brisbane' }).mentions;
    await store.withLedger(userA, c5.id, async (l) => ({ ledger: ledgerLib.applyMention(l, m5[0], { newId: () => 'r1' }).rows, value: 1 }));
    ok('no Sent check has ever been made', (await store.latestSweep(c5.id)) === null);
    gmailFails = true;
    r = await call('POST', `/${c5.id}/rows/r1/draft`, {});
    ok('if Sent cannot be checked, nothing is drafted', r.status === 502 && !(await store.listDrafts(c5.id)).length, r);
    gmailFails = false;
    r = await call('POST', `/${c5.id}/rows/r1/draft`, {});
    ok('otherwise the check is made for you and the draft appears', r.status === 201, r);
    const sw = await store.latestSweep(c5.id);
    ok('and the check is recorded as completed', sw && sw.completed === true, sw);
    await pool.query(`UPDATE ef_sent_sweeps SET "toAt"=NOW() - interval '2 hours' WHERE "caseId"=$1`, [c5.id]);
    r = await call('POST', `/${c5.id}/rows/r1/draft`, {});
    const sw2 = await store.latestSweep(c5.id);
    ok('a stale check is made again before the next draft', r.status === 201 && new Date(sw2.to).getTime() > Date.now() - 60000, { s: r.status, to: sw2 && sw2.to });

    // ---- Find mail: no ceiling at the newest 15 threads ----
    console.log('Find mail goes past what is attached');
    const cFind = await newCase();
    const ids = Array.from({ length: 40 }, (_, i) => `th${String(i + 1).padStart(3, '0')}`);
    threadPages = [ids.slice(0, 10), ids.slice(10, 20), ids.slice(20, 30), ids.slice(30, 40)];
    const attachThreads = async (n) => { for (let i = 0; i < n; i += 1) await store.addSource(userA, cFind.id, { channel: 'inbound', externalId: `f-${ids[i]}`, threadId: ids[i], subject: 'x', text: 'x', receivedAt: new Date().toISOString() }); };
    r = await call('GET', `/${cFind.id}/suggestions`);
    ok('the first press shows twelve of the forty and says there are more', r.status === 200 && r.body.threads.length === 12 && r.body.more === true, { n: r.body.threads && r.body.threads.length, more: r.body.more });
    await attachThreads(15);
    r = await call('GET', `/${cFind.id}/suggestions`);
    ok('after the newest 15 are attached it reaches past them (it used to show nothing)', r.body.threads.length === 12 && r.body.threads[0].threadId === 'th016' && r.body.more === true, { first: r.body.threads[0] && r.body.threads[0].threadId, n: r.body.threads.length });
    await attachThreads(35);
    r = await call('GET', `/${cFind.id}/suggestions`);
    ok('with 35 attached, the last five are shown and nothing more is promised', r.body.threads.length === 5 && r.body.more === false, { n: r.body.threads.length, more: r.body.more });
    await attachThreads(40);
    r = await call('GET', `/${cFind.id}/suggestions`);
    ok('with all forty attached there is nothing left', r.body.threads.length === 0 && r.body.more === false, r.body);
    threadPages = null;

    // ---- Check Sent: a big Sent folder is read a page at a time, and counts as done only at the end ----
    console.log('Check Sent in steps');
    const cSent = await newCase();
    const sid = (n) => `s${String(n).padStart(4, '0')}`;
    sentPages = [Array.from({ length: 100 }, (_, i) => sid(i + 1)), Array.from({ length: 100 }, (_, i) => sid(i + 101)), Array.from({ length: 50 }, (_, i) => sid(i + 201))];
    r = await call('POST', `/${cSent.id}/sent-sweep`, {});
    ok('the first press looks at 100 and is not finished', r.status === 200 && r.body.completed === false && r.body.partial === true && r.body.scanned === 100, r.body);
    const firstAfter = Number(sentQueries[sentQueries.length - 1].match(/after:(\d+)/)[1]); // where THIS case's first look started
    let sw0 = await store.latestSweep(cSent.id);
    ok('the case shows the check as in progress', sw0.partial === true && sw0.completed === false && sw0.scanned === 100, sw0);
    ok('an unfinished check does not count as a Sent check (the gate stays shut)', !require('../services/emailFollowUp/gates').sentSweepCovers(sw0, null, new Date().toISOString()));
    r = await call('POST', `/${cSent.id}/sent-sweep`, {});
    ok('the second press carries on to 200', r.body.scanned === 200 && r.body.completed === false, r.body);
    gmailFails = true;
    r = await call('POST', `/${cSent.id}/sent-sweep`, {});
    ok('a Gmail failure part-way is an error and leaves the check unfinished', r.status >= 500 && (await store.latestSweep(cSent.id)).completed === false, r);
    gmailFails = false;
    const before = downloaded.length;
    r = await call('POST', `/${cSent.id}/sent-sweep`, {});
    ok('after a failure it starts again but does not download what it already has', r.body.partial === true && downloaded.length === before, { r: r.body, more: downloaded.length - before });
    await call('POST', `/${cSent.id}/sent-sweep`, {});
    r = await call('POST', `/${cSent.id}/sent-sweep`, {});
    ok('the last page finishes it', r.body.completed === true && r.body.partial === false, r.body);
    ok('every Sent message was downloaded exactly once (250)', downloaded.length === 250 && new Set(downloaded).size === 250, { n: downloaded.length, unique: new Set(downloaded).size });
    const swDone = await store.latestSweep(cSent.id);
    ok('now it counts as a Sent check', require('../services/emailFollowUp/gates').sentSweepCovers(swDone, null, new Date().toISOString()), swDone);
    sentPages = [[]];
    r = await call('POST', `/${cSent.id}/sent-sweep`, {});
    const lastAfter = Number(sentQueries[sentQueries.length - 1].match(/after:(\d+)/)[1]);
    ok('a later check only searches the recent tail, not everything again', r.body.completed === true && lastAfter > firstAfter, { firstAfter, lastAfter });
    ok('and still claims the whole earlier window', new Date((await store.latestSweep(cSent.id)).from).getTime() <= firstAfter * 1000 + 1000, null);
    await call('PATCH', `/${cSent.id}`, { aliases: ['p@client.test', 'other@client.test'] });
    sentPages = [[]];
    const nBefore = sentQueries.length;
    await call('POST', `/${cSent.id}/sent-sweep`, {});
    const widened = Number(sentQueries[nBefore].match(/after:(\d+)/)[1]);
    ok('a new address on the case means a full look back, not just the tail', widened <= firstAfter + 2, { widened, firstAfter });

    // Draft follow-up on a big Sent folder: it begins the check, says so, and drafts nothing until the check is finished
    const cBig = await newCase();
    const sB = await addMsg(userA, cBig.id, 7);
    const srcBig = (await store.listSources(cBig.id, { withText: true })).find((x) => x.id === sB.id);
    const mBig = extractMod.normalizeMentions(JSON.stringify({ mentions: [{ kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: ['item-7'], claimType: 'agreed', quote: 'owes item-7' }] }), { ...srcBig, receivedAt: new Date(srcBig.receivedAt).toISOString() }, { tz: 'Australia/Brisbane' }).mentions;
    await store.withLedger(userA, cBig.id, async (l) => ({ ledger: ledgerLib.applyMention(l, mBig[0], { newId: () => 'r1' }).rows, value: 1 }));
    sentPages = [Array.from({ length: 100 }, (_, i) => `b${i}`), Array.from({ length: 10 }, (_, i) => `c${i}`)];
    r = await call('POST', `/${cBig.id}/rows/r1/draft`, {});
    ok('a big Sent folder: nothing is drafted yet and the person is told why', r.status === 409 && /takes a few steps/.test(r.body.error || '') && !(await store.listDrafts(cBig.id)).length, r);
    await call('POST', `/${cBig.id}/sent-sweep`, {});
    r = await call('POST', `/${cBig.id}/rows/r1/draft`, {});
    ok('once the check has finished, the draft is made', r.status === 201, r);
    sentPages = null;

    // ---- closing a case: finished, off the list, read-only ----
    console.log('closing');
    const cC = await newCase({ title: 'Close me' });
    r = await call('PATCH', `/${cC.id}`, { status: 'closed', closeReason: 'all paid' });
    ok('a case can be closed, with a reason and a time', r.status === 200 && r.body.case.status === 'closed' && r.body.case.closeReason === 'all paid' && r.body.case.closedAt, r.body);
    const tries = [
      ['POST', `/${cC.id}/attachments`, {}], ['POST', `/${cC.id}/extract`, {}], ['POST', `/${cC.id}/sent-sweep`, {}], ['POST', `/${cC.id}/threads`, { threadId: 'abcdef123' }],
      ['POST', `/${cC.id}/threads/abcdef123/set-aside`, {}], ['POST', `/${cC.id}/threads/abcdef123/detach`, {}],
      ['POST', `/${cC.id}/rows/r1/event`, { type: 'waive' }], ['POST', `/${cC.id}/rows/r1/task`, {}], ['POST', `/${cC.id}/rows/r1/draft`, {}],
    ];
    const refused = [];
    for (const [m, p, b] of tries) { const x = await call(m, p, b); if (x.status !== 409 || !x.body.closed) refused.push([m, p, x.status]); }
    ok('a closed case refuses every change (read, attach, check, draft, row actions, set aside)', refused.length === 0, refused);
    r = await call('GET', `/${cC.id}`);
    ok('but it can still be read', r.status === 200 && r.body.case.status === 'closed', r.status);
    r = await call('PATCH', `/${cC.id}`, { status: 'active' });
    ok('reopening clears the close', r.body.case.status === 'active' && r.body.case.closedAt === null && r.body.case.closeReason === null, r.body.case);
    r = await call('POST', `/${cC.id}/extract`, {});
    ok('and work is allowed again', r.status === 200, r);
    r = await call('GET', '/');
    ok('the list carries the status of each case (the page filters it)', r.body.cases.some((x) => x.id === cC.id && x.status === 'active'), null);

    // a closed case also refuses to approve, edit or copy a draft it already has
    const dClosed = await approvedDraft();
    const dPending = await store.insertDraft(userA, c4.id, 'r1', draftContent, hash, { verdict: 'pass', results: [], reasons: [] });
    await call('PATCH', `/${c4.id}`, { status: 'closed' });
    const copyClosed = await call('POST', `/drafts/${dClosed.id}/copy`, {});
    const approveClosed = await call('POST', `/drafts/${dPending.id}/approve`, {});
    const editClosed = await call('PATCH', `/drafts/${dPending.id}`, { subject: 'new' });
    ok('a closed case will not copy, approve or edit a draft either', [copyClosed, approveClosed, editClosed].every((x) => x.status === 409 && x.body.closed === true), [copyClosed.status, approveClosed.status, editClosed.status]);
    await call('PATCH', `/${c4.id}`, { status: 'active' });

    // ---- setting a thread aside, and removing one ----
    console.log('set aside and remove');
    const cA = await newCase();
    const mA = await store.addSource(userA, cA.id, { channel: 'inbound', externalId: 'a-msg', threadId: 'thread-aaa', subject: 'A', fromAddr: 'P <p@client.test>', receivedAt: new Date(Date.now() - 3600000).toISOString(), text: 'The client owes item-1 and should send it.' });
    await store.addSource(userA, cA.id, { kind: 'document', channel: 'inbound', externalId: 'a-doc', threadId: 'thread-aaa', parentId: mA.id, filename: 'inv.pdf', receivedAt: new Date().toISOString(), text: 'Invoice: item-1 total $10.' });
    const mB = await store.addSource(userA, cA.id, { channel: 'inbound', externalId: 'b-msg', threadId: 'thread-bbb', subject: 'B', fromAddr: 'P <p@client.test>', receivedAt: new Date().toISOString(), text: 'The client owes item-2 and should send it.' });
    r = await call('POST', `/${cA.id}/threads/thread-aaa/set-aside`, { aside: true });
    ok('a thread (message and attachment) can be set aside', r.status === 200 && r.body.changed === 2, r.body);
    readCalls.length = 0;
    r = await call('POST', `/${cA.id}/extract`, {});
    ok('a set-aside thread is not read', r.body.read === 1 && readCalls.length === 1 && readCalls[0] === mB.id, { read: r.body.read, calls: readCalls });
    r = await call('GET', `/${cA.id}`);
    ok('it is still in the case and marked aside (so citations still resolve)', r.body.sources.filter((x) => x.setAsideAt).length === 2 && r.body.sources.length === 3, r.body.sources.map((x) => [x.id, x.setAsideAt]));
    ok('the coverage statement says it was set aside, and does not count it as read', r.body.coverage.notVisible.some((x) => /you set aside/.test(x)) && r.body.coverage.read.messages === 1, r.body.coverage);
    r = await call('POST', `/${cA.id}/threads/thread-aaa/set-aside`, { aside: false });
    readCalls.length = 0;
    r = await call('POST', `/${cA.id}/extract`, {});
    ok('brought back, it is read', r.body.read === 2 && readCalls.length === 2, { read: r.body.read, calls: readCalls });

    // remove: refused when something quotes it, allowed when nothing does
    r = await call('POST', `/${cA.id}/threads/thread-aaa/detach`, {});
    ok('a thread a ledger row quotes cannot be removed, and the reply says what quotes it', r.status === 409 && r.body.cited && r.body.cited.rows >= 1 && /Set it aside/.test(r.body.error), r.body);
    ok('and nothing was removed', (await store.listSources(cA.id)).length === 3);
    const cN = await newCase();
    const mN = await store.addSource(userA, cN.id, { channel: 'inbound', externalId: 'n-msg', threadId: 'thread-nnn', subject: 'N', text: 'noise', receivedAt: new Date().toISOString() });
    await store.addSource(userA, cN.id, { kind: 'document', channel: 'inbound', externalId: 'n-doc', threadId: 'thread-nnn', parentId: mN.id, filename: 'x.pdf', text: 'noise doc', receivedAt: new Date().toISOString() });
    r = await call('POST', `/${cN.id}/threads/thread-nnn/detach`, {});
    ok('a thread nothing quotes is removed with its attachments', r.status === 200 && r.body.removed === 2 && (await store.listSources(cN.id)).length === 0, r.body);

    // ---- deleting a case: confirmation, the recycle bin, restore, forever ----
    console.log('delete');
    const recycle = require('../services/recycleBin');
    recycle.loadAdapters();
    const cD = await newCase({ title: 'Delete me (test)', clientId: clientA });
    await call('PATCH', `/${cD.id}`, { clientId: null });
    const sD = await addMsg(userA, cD.id, 6);
    const dDoc = await store.addSource(userA, cD.id, { kind: 'document', channel: 'inbound', externalId: 'd-doc', threadId: `thread-${cD.id}-6`, parentId: sD.id, filename: 'inv.pdf', receivedAt: new Date().toISOString(), text: 'Invoice item-6 total $60.' });
    const srcD = (await store.listSources(cD.id, { withText: true })).find((x) => x.id === sD.id);
    const mD = extractMod.normalizeMentions(JSON.stringify({ mentions: [{ kind: 'waiting_on', direction: 'they_owe', party: 'p@client.test', items: ['item-6'], claimType: 'agreed', quote: 'owes item-6' }] }), { ...srcD, receivedAt: new Date(srcD.receivedAt).toISOString() }, { tz: 'Australia/Brisbane' }).mentions;
    await store.withLedger(userA, cD.id, async (l) => ({ ledger: ledgerLib.applyMention(l, mD[0], { newId: () => 'r1' }).rows, value: 1 }));
    const taskId = (await pool.query(`INSERT INTO tasks (title, status, priority, "userId") VALUES ('From the case','todo','medium',$1) RETURNING id`, [userA])).rows[0].id;
    await store.withLedger(userA, cD.id, async (l) => ({ ledger: l.map((x) => ({ ...x, taskId })), value: 1 }));
    const rowD = (await ledgerOf(cD.id))[0];
    const contentD = { ...buildNudgeDraft(rowD, { to: ['p@client.test'], threadIds: [] }), notes: [] };
    const hashD = approvalLib.draftHash({ ...contentD, id: null, version: 1 });
    const draftD = await store.insertDraft(userA, cD.id, 'r1', contentD, hashD, { verdict: 'pass', results: [], reasons: [] });
    await store.addApproval(draftD.id, 1, hashD, 'approved', userA, []);
    await store.setDraftStatus(draftD.id, 'approved');
    await pool.query(`INSERT INTO ef_sent_sweeps ("caseId","userId","fromAt","toAt",completed,found) VALUES ($1,$2,NOW() - interval '30 days',NOW(),TRUE,0)`, [cD.id, userA]);

    r = await call('GET', `/${cD.id}/delete-preview`);
    ok('the preview counts what would go', r.status === 200 && r.body.messages === 1 && r.body.attachments === 1 && r.body.drafts === 1 && r.body.approvals === 1 && r.body.approvedEver === 1 && r.body.sweeps === 1 && r.body.rows === 1 && r.body.tasks === 1, r.body);
    r = await call('DELETE', `/${cD.id}`, { confirmTitle: 'wrong name' });
    ok('without the case name typed exactly, nothing is deleted', r.status === 400 && (await store.getCase(userA, cD.id)) !== null, r);
    r = await call('DELETE', `/${cD.id}`, { confirmTitle: 'Delete me (test)' });
    ok('a case with an approved draft needs a second, explicit confirmation', r.status === 409 && r.body.needsAcknowledgement === true && (await store.getCase(userA, cD.id)) !== null, r.body);
    r = await call('DELETE', `/${cD.id}`, { confirmTitle: 'Delete me (test)' }, userB);
    ok("another person cannot delete it", r.status === 404 && (await store.getCase(userA, cD.id)) !== null, r.status);
    const ledgerBefore = JSON.stringify(await ledgerOf(cD.id));
    r = await call('DELETE', `/${cD.id}`, { confirmTitle: 'Delete me (test)', acknowledgeApprovals: true });
    ok('with both confirmations it is deleted and a copy is kept', r.status === 200 && r.body.binId && r.body.forever === false, r.body);
    ok('the case and everything under it is gone', (await store.getCase(userA, cD.id)) === null
      && (await pool.query('SELECT COUNT(*) AS n FROM ef_sources WHERE "caseId"=$1', [cD.id])).rows[0].n === '0'
      && (await pool.query('SELECT COUNT(*) AS n FROM ef_drafts WHERE "caseId"=$1', [cD.id])).rows[0].n === '0'
      && (await pool.query('SELECT COUNT(*) AS n FROM ef_approvals WHERE "draftId"=$1', [draftD.id])).rows[0].n === '0'
      && (await pool.query('SELECT COUNT(*) AS n FROM ef_sent_sweeps WHERE "caseId"=$1', [cD.id])).rows[0].n === '0');
    ok('the task made from the case is untouched', (await pool.query('SELECT COUNT(*) AS n FROM tasks WHERE id=$1', [taskId])).rows[0].n === '1');
    const binned = await recycle.list(userA, { types: ['email-follow-up-case'] });
    ok('it is in the recycle bin, named', binned.some((x) => x.id === r.body.binId && x.title === 'Delete me (test)'), binned.map((x) => [x.id, x.title]));

    const back = await recycle.restoreItem(userA, r.body.binId);
    const restored = await store.getCase(userA, Number(back.entityId));
    ok('restoring brings the case back with the same id and ledger', restored && restored.id === cD.id && JSON.stringify(restored.ledger) === ledgerBefore, restored && restored.id);
    const rs = await store.listSources(cD.id, { withText: true });
    ok('with its messages and attachments, still linked, ids unchanged', rs.length === 2 && rs.find((x) => x.id === dDoc.id).parentId === sD.id && rs.find((x) => x.id === sD.id).text.includes('item-6'), rs.map((x) => [x.id, x.parentId]));
    const rd = await store.listDrafts(cD.id);
    ok('and the draft, still approved, with its approval record', rd.length === 1 && rd[0].status === 'approved' && (await store.latestApproval(rd[0].id)).decision === 'approved', rd.map((x) => x.status));
    ok('and the Sent check record', (await store.latestSweep(cD.id)).completed === true);
    r = await call('POST', `/drafts/${rd[0].id}/copy`, {});
    ok('the restored approved draft copies, as before', r.status === 200 && r.body.ok, r);

    // forever skips the bin
    const binBefore = (await recycle.list(userA, { types: ['email-follow-up-case'] })).length;
    r = await call('DELETE', `/${cD.id}`, { confirmTitle: 'Delete me (test)', acknowledgeApprovals: true, forever: true });
    ok('delete forever keeps no copy', r.status === 200 && r.body.binId === null && r.body.forever === true && (await recycle.list(userA, { types: ['email-follow-up-case'] })).length === binBefore, r.body);
    ok('and the case is gone for good', (await store.getCase(userA, cD.id)) === null);

    // too big for the bin: refused with the way out, nothing deleted
    const cBigBin = await newCase({ title: 'Big one' });
    await addMsg(userA, cBigBin.id, 8);
    process.env.EF_CASE_BIN_MAX_BYTES = '200';
    r = await call('DELETE', `/${cBigBin.id}`, { confirmTitle: 'Big one' });
    delete process.env.EF_CASE_BIN_MAX_BYTES;
    ok('a case too big for the recycle bin is not deleted, and the reply offers delete forever', r.status === 409 && r.body.tooLarge === true && (await store.getCase(userA, cBigBin.id)) !== null, r.body);
    r = await call('DELETE', `/${cBigBin.id}`, { confirmTitle: 'Big one', forever: true });
    ok('and delete forever then works', r.status === 200 && (await store.getCase(userA, cBigBin.id)) === null, r.body);

    // ---- every Gmail route is limited per person ----
    console.log('rate limit');
    const userC = await mkUser('c');
    const cRate = await newCase({}, userC);
    const codes = [];
    for (let i = 0; i < 65; i += 1) codes.push((await call('GET', `/${cRate.id}/suggestions`, null, userC)).status);
    ok('the first 60 in a minute are allowed', codes.slice(0, 60).every((c) => c === 200), codes.slice(0, 60).filter((c) => c !== 200));
    ok('the 61st is refused with 429', codes.slice(60).every((c) => c === 429), codes.slice(60));
    r = await call('POST', `/${cRate.id}/sent-sweep`, {}, userC);
    ok('the limit covers the other Gmail routes too', r.status === 429, r.status);
    r = await call('GET', `/${cRate.id}`, null, userC);
    ok('but reading the case itself is not limited', r.status === 200, r.status);
    r = await call('GET', `/${caseB.id}/suggestions`, null, userB);
    ok('and one person using up the limit does not use up anyone elses', r.status === 200, r.status);
    await pool.query('DELETE FROM users WHERE id=$1', [userC]).catch(() => {});
  } finally {
    server.close();
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[userA, userB]]).catch(() => {}); // cascades to cases, sources, drafts, clients
    await pool.end();
  }
  if (failures.length) { console.error(`\n${failures.length} FAILURE(S): ${failures.join('; ')}`); process.exit(1); }
  console.log('email-follow-up routes: passed');
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
