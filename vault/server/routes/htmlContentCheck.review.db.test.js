'use strict';
// DATABASE_URL=... node server/routes/htmlContentCheck.review.db.test.js
// Real database, fake sign-in, a stand-in fetcher and a stand-in model that counts its calls (no live site or model). Proves, for the
// rework's R2 (decisions that belong to the job and carry over between checks):
//   - a check sorts lines and unrequested changes into Needs attention / To approve / Approved; a date that updates itself is Expected
//     automatically; marking the rest makes the job Ready to send;
//   - a check with the same changes reuses the links without calling the AI; decisions carry over by fingerprint;
//   - when an approved edit changes again it comes back as "was approved, now changed", its change marked New this check;
//   - links made by hand carry over to the next check;
//   - the old per-round approvals move into decisions once (needs_work becomes question) and a cleared one is not brought back;
//   - another member is refused; the recycle bin brings decisions back.
const assert = require('node:assert/strict');
const express = require('express');

if (!process.env.DATABASE_URL) { console.log('SKIP htmlContentCheck.review.db.test.js: DATABASE_URL is not set'); process.exit(0); }

let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool, moveOldApprovals } = require('../db');
const router = require('./htmlContentCheck');

const URL1 = 'https://shop.example/about';
const html = ({ phone = '03 1111', intro = 'We have sold fine wine in Hobart since 1990.', hours = 3 } = {}) => `<html><body>
  <h1>About the shop</h1><p>${intro}</p><p>Call us on ${phone} for bookings and tastings.</p>
  <p>Our cellar holds more than two thousand bottles from Tasmania and beyond.</p><p>Updated ${hours} hours ago</p></body></html>`;
let current = html();
router._setPageDeps({
  plainFetch: async (url) => ({ html: current, finalUrl: url }),
  browserFetch: async () => { throw new Error('no browser in this test'); },
  browserAvailable: () => false,
});
let modelCalls = 0;
router._setMatchDeps({
  getModels: async () => ({ standard: 'model-under-test' }),
  callModel: async (_m, prompt) => {
    modelCalls++;
    const block = (tag) => JSON.parse(prompt.split(`<${tag}>\n`)[1].split(`\n</${tag}>`)[0]);
    const changes = block('page_changes');
    const lines = block('request_lines').map((l) => ({ ref: l.ref, changeIds: changes.filter((c) => /Call us on 03 2222/.test(c.after || '')).map((c) => c.id), reason: 'stand-in' }));
    return { text: JSON.stringify({ lines }), inputTokens: 300, outputTokens: 40 };
  },
  logUsage: () => {},
});

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
  const tag = `hcc-review-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash") VALUES ($1,'x') RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/api/html-content-check`;
  const call = async (user, method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const where = (rv) => Object.fromEntries(['attention', 'approve', 'approved'].map((k) => [k, rv[k].map((x) => (x.type === 'line' ? `${x.ref}:${x.reason}` : `${x.reason}${x.volatile ? '(auto)' : ''}`))]));
  const check = async (job) => {
    const n = (await call(A, 'POST', `/jobs/${job.id}/rounds`)).body.round.number;
    const m = await call(A, 'POST', `/jobs/${job.id}/rounds/${n}/match`, { reuse: true });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    return m.body;
  };
  try {
    let r = await call(A, 'POST', '/jobs', { name: `${tag} shop`, requestText: 'Change the phone number to 03 2222', url: URL1 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const job = r.body;
    const pageId = job.pages[0].id;

    // ---- check 1: the phone changed (asked), the intro was reworded (not asked), the "updated" line changed by itself ----
    current = html({ phone: '03 2222', intro: 'We have proudly sold fine wine in Hobart since 1990.', hours: 5 });
    let v = await check(job);
    assert.equal(modelCalls, 1);
    const sum1 = (await call(A, 'GET', `/jobs/${job.id}`)).body.rounds.find((x) => x.number === 1);
    assert.equal(sum1.sinceBaseline?.total, 3, 'the first check reports its changes since the starting point (Check again relies on it)');
    assert.deepEqual(where(v.review), { attention: ['unmarked'], approve: ['R1:looksDone'], approved: ['expected(auto)'] });
    assert.equal(v.review.counts.autoExpected, 1);
    const intro = v.review.attention[0];
    assert.match(intro.fp, new RegExp(`^p${pageId}\\.`));
    // decide: approve R1, mark the rewording "mine, intentional"
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/rounds/1/lines/R1/decision`, { status: 'done' })).status, 400);
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/rounds/1/pages/${pageId}/changes/p999.nope/decision`, { status: 'mine' })).status, 404);
    assert.equal((await call(A, 'PUT', `/jobs/${job.id}/rounds/1/pages/${pageId}/changes/${intro.fp}/decision`, { status: 'approved' })).status, 400, 'not a change mark');
    await call(A, 'PUT', `/jobs/${job.id}/rounds/1/lines/R1/decision`, { status: 'approved' });
    v = (await call(A, 'PUT', `/jobs/${job.id}/rounds/1/pages/${pageId}/changes/${intro.fp}/decision`, { status: 'mine', note: 'On purpose' })).body;
    assert.equal(v.review.ready, true);
    assert.deepEqual(v.decisions.changes[`${pageId}|${intro.fp}`], { status: 'mine', note: 'On purpose' });
    assert.equal(v.approvals.R1.status, 'approved', 'the old shape still answers for screens not moved over');

    // ---- check 2: nothing new: links reused without the AI, decisions carried over, nothing new ----
    current = html({ phone: '03 2222', intro: 'We have proudly sold fine wine in Hobart since 1990.', hours: 5 });
    v = await check(job);
    assert.equal(modelCalls, 1, 'the same changes: no AI call');
    assert.equal(v.usage.reused, 1);
    assert.equal(v.pages[0].results.matches.carriedFrom, 1);
    assert.equal(v.review.ready, true);
    assert.ok([...v.review.approved].every((x) => !x.isNew && !(x.links || []).some((l) => l.isNew)), 'nothing is new this check');

    // ---- check 3: the phone was edited again: R1 comes back, its change new this check; the rewording keeps its mark ----
    current = html({ phone: '03 3333', intro: 'We have proudly sold fine wine in Hobart since 1990.', hours: 5 });
    v = await check(job);
    assert.equal(modelCalls, 2, 'changed: the AI is asked again');
    const r1 = v.review.attention.find((x) => x.ref === 'R1');
    assert.equal(r1.reason, 'changedSinceApproval', JSON.stringify(v.review.attention));
    const newPhone = v.review.attention.find((x) => x.type === 'change');
    assert.equal(newPhone.isNew, true, 'the new phone change is new this check');
    assert.equal(v.review.approved.find((x) => x.fp === intro.fp).decision.status, 'mine', 'the mark carried over by fingerprint');
    // link it by hand, then approve again
    v = (await call(A, 'PUT', `/jobs/${job.id}/rounds/3/pages/${pageId}/matches/R1`, { changeIds: [newPhone.changeId] })).body;
    assert.equal(v.review.attention.find((x) => x.ref === 'R1').reason, 'changedSinceApproval', 'still the old approval');
    v = (await call(A, 'PUT', `/jobs/${job.id}/rounds/3/lines/R1/decision`, { status: 'approved' })).body;
    assert.equal(v.review.ready, true);

    // ---- check 4: same as check 3: the hand link carries over without the AI ----
    v = await check(job);
    assert.equal(modelCalls, 2);
    assert.equal(v.pages[0].results.matches.items.R1.by, 'person');
    assert.equal(v.review.approved.find((x) => x.ref === 'R1').reason, 'approved');
    // a question with a note, then cleared
    v = (await call(A, 'PUT', `/jobs/${job.id}/rounds/4/lines/R1/decision`, { status: 'question', note: 'Is 3333 right?' })).body;
    assert.equal(v.review.attention.find((x) => x.ref === 'R1').decision.note, 'Is 3333 right?');
    v = (await call(A, 'PUT', `/jobs/${job.id}/rounds/4/lines/R1/decision`, { status: null })).body;
    assert.equal(v.review.approve.find((x) => x.ref === 'R1').reason, 'looksDone');

    // ---- the old approvals move once ----
    const itemId = job.items[0].id;
    await pool.query('DELETE FROM content_check_decisions WHERE "jobId" = $1 AND "itemId" IS NOT NULL', [job.id]);
    await pool.query(`INSERT INTO content_check_approvals ("jobId","userId","roundNumber","itemId",status,note) VALUES ($1,$2,1,$3,'approved',null), ($1,$2,2,$3,'needs_work','old note')`, [job.id, A, itemId]);
    await moveOldApprovals(pool);
    let d = (await pool.query('SELECT status, note, fps FROM content_check_decisions WHERE "jobId" = $1 AND "itemId" = $2', [job.id, itemId])).rows;
    assert.deepEqual(d, [{ status: 'question', note: 'old note', fps: null }], 'the latest round wins; needs_work is a question');
    await pool.query('DELETE FROM content_check_decisions WHERE "jobId" = $1 AND "itemId" = $2', [job.id, itemId]);
    await moveOldApprovals(pool);
    d = (await pool.query('SELECT 1 FROM content_check_decisions WHERE "jobId" = $1 AND "itemId" = $2', [job.id, itemId])).rows;
    assert.equal(d.length, 0, 'a cleared decision is not brought back');
    // the old approve route now writes a decision
    v = (await call(A, 'PUT', `/jobs/${job.id}/rounds/4/approvals/R1`, { status: 'needs_work', note: 'via old route' })).body;
    assert.equal(v.decisions.lines.R1.status, 'question');

    // ---- another member ----
    assert.equal((await call(B, 'PUT', `/jobs/${job.id}/rounds/4/lines/R1/decision`, { status: 'approved' })).status, 404);
    assert.equal((await call(B, 'PUT', `/jobs/${job.id}/rounds/4/pages/${pageId}/changes/${intro.fp}/decision`, { status: null })).status, 404);

    // ---- recycle bin ----
    require('../services/recycleBin/adapters');
    const bin = require('../services/recycleBin');
    const before = (await call(A, 'GET', `/jobs/${job.id}/rounds/4`)).body.decisions;
    r = await call(A, 'DELETE', `/jobs/${job.id}`);
    assert.equal(r.status, 200);
    await bin.restoreItem(A, r.body.binId);
    assert.deepEqual((await call(A, 'GET', `/jobs/${job.id}/rounds/4`)).body.decisions, before, 'decisions came back');

    console.log('htmlContentCheck.review.db.test.js: all checks passed');
  } finally {
    server.close();
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1::int[])', [[A, B]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [[A, B]]);
    await pool.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
