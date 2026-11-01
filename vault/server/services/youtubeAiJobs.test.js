'use strict';
// node server/services/youtubeAiJobs.test.js   (part of npm run test:youtube). No network and no database: small fakes stand in.
const assert = require('node:assert/strict');
const { createAiTranscripts } = require('./youtubeAiJobs');

function fakePool() {
  const rows = new Map();
  return {
    rows,
    async query(sql, params) {
      if (/SELECT "videoId" FROM youtube_transcripts/.test(sql)) return { rows: [...rows.values()].filter((r) => r.userId === params[0]).map((r) => ({ videoId: r.videoId })) };
      if (/^SELECT .* FROM youtube_transcripts WHERE/.test(sql)) { const r = rows.get(params[0] + ':' + params[1]); return { rows: r ? [r] : [] }; }
      if (/INSERT INTO youtube_transcripts/.test(sql)) {
        rows.set(params[0] + ':' + params[1], { userId: params[0], videoId: params[1], title: params[2], segments: JSON.parse(params[3]), language: '', source: 'gemini', model: params[4], durationSec: params[5], costUsd: params[6], createdAt: new Date() });
        return { rows: [] };
      }
      if (/DELETE FROM youtube_transcripts/.test(sql)) { const k = params[0] + ':' + params[1]; const had = rows.delete(k); return { rowCount: had ? 1 : 0, rows: [] }; }
      throw new Error('unexpected sql ' + sql);
    },
  };
}

const VIDEO = { items: [{ snippet: { title: 'Bread basics' }, contentDetails: { duration: 'PT10M' } }] };
const REPLY = JSON.stringify([{ start: '0:00', text: 'Hello.' }, { start: '5:00', text: 'Mid.' }, { start: '9:30', text: 'End.' }]);

function make(over = {}) {
  const pool = fakePool();
  const usage = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const deps = {
    pool,
    ytGet: async () => over.video || VIDEO,
    getKey: () => 'yt-key',
    getModelsForUser: async () => ({ gemini: 'gemini-2.0-flash' in over ? over['gemini-2.0-flash'] : 'gemini-2.0-flash' }),
    logUsage: (u) => usage.push(u),
    watchVideo: async (args) => { if (over.hold) await gate; if (over.fail) throw new Error(over.fail); return { text: over.text || REPLY, inputTokens: 60000, outputTokens: 3000, finishReason: 'STOP', args }; },
    apiKey: () => (over.noKey ? '' : 'gem-key'),
  };
  return { svc: createAiTranscripts(deps), pool, usage, release };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  // ---- the plan shown before anyone agrees
  let { svc } = make();
  let p = await svc.plan(1, 'aaaaaaaaaaa');
  assert.equal(p.available, true);
  assert.equal(p.durationSec, 600);
  assert.equal(p.title, 'Bread basics');
  assert.equal(p.model, 'gemini-2.0-flash');
  assert.ok(p.costUsd > 0 && p.waitLowSec < p.waitHighSec);

  assert.equal((await make({ noKey: true }).svc.plan(1, 'aaaaaaaaaaa')).available, false);
  assert.match((await make({ noKey: true }).svc.plan(1, 'aaaaaaaaaaa')).reason, /no key/);
  assert.match((await make({ 'gemini-2.0-flash': null }).svc.plan(1, 'aaaaaaaaaaa')).reason, /No Gemini model/);
  assert.match((await make({ video: { items: [] } }).svc.plan(1, 'aaaaaaaaaaa')).reason, /does not show this video/);
  assert.match((await make({ video: { items: [{ snippet: { title: 'Live' }, contentDetails: { duration: 'P0D' } }] } }).svc.plan(1, 'aaaaaaaaaaa')).reason, /live stream/);
  const long = await make({ video: { items: [{ snippet: { title: 'Long' }, contentDetails: { duration: 'PT2H' } }] } }).svc.plan(1, 'aaaaaaaaaaa');
  assert.equal(long.available, false);
  assert.match(long.reason, /over 1 hour are not supported \(this one is 2 hours\)/);

  // ---- run it: saved when it comes back, usage logged, then it is used like captions
  let m = make();
  assert.deepEqual(await m.svc.start(1, 'aaaaaaaaaaa'), { started: true });
  assert.equal((await m.svc.status(1, 'aaaaaaaaaaa')).job.status === 'running' || (await m.svc.status(1, 'aaaaaaaaaaa')).job.status === 'done', true);
  await settle();
  const st = await m.svc.status(1, 'aaaaaaaaaaa');
  assert.equal(st.job.status, 'done');
  assert.equal(st.saved.lines, 3);
  assert.equal(st.saved.source, 'gemini');
  assert.ok(st.job.costUsd > 0);
  const got = await m.svc.stored(1, 'aaaaaaaaaaa');
  assert.deepEqual(got.segments.map((s) => [s.start, s.text]), [[0, 'Hello.'], [300, 'Mid.'], [570, 'End.']]);
  assert.equal(got.title, 'Bread basics');
  assert.equal(m.usage.length, 1);
  assert.equal(m.usage[0].feature, 'youtube-transcript');
  assert.equal(m.usage[0].inputTokens, 60000, 'the real token counts are logged, not the estimate');
  assert.deepEqual(await m.svc.savedIds(1), ['aaaaaaaaaaa']);
  assert.deepEqual(await m.svc.savedIds(2), [], 'another person has nothing');

  // already saved: not run again, not charged again
  const again = await m.svc.start(1, 'aaaaaaaaaaa');
  assert.equal(again.status, 409);
  assert.match(again.error, /already saved/);
  assert.equal(m.usage.length, 1);

  // another person cannot see it, and deleting removes it
  assert.equal(await m.svc.remove(2, 'aaaaaaaaaaa'), false);
  assert.equal(await m.svc.remove(1, 'aaaaaaaaaaa'), true);
  assert.equal((await m.svc.status(1, 'aaaaaaaaaaa')).saved, null);

  // ---- one at a time per person
  m = make({ hold: true });
  assert.deepEqual(await m.svc.start(1, 'aaaaaaaaaaa'), { started: true });
  const busy = await m.svc.start(1, 'bbbbbbbbbbb');
  assert.equal(busy.status, 409);
  assert.match(busy.error, /already being written/);
  assert.deepEqual(await m.svc.start(2, 'bbbbbbbbbbb'), { started: true }, 'but someone else can');
  m.release();
  await settle();
  assert.equal((await m.svc.status(1, 'aaaaaaaaaaa')).job.status, 'done');

  // ---- failures are reported, nothing is saved, nothing is charged for a failed call
  m = make({ fail: 'Gemini could not open this video.' });
  await m.svc.start(1, 'aaaaaaaaaaa');
  await settle();
  const bad = await m.svc.status(1, 'aaaaaaaaaaa');
  assert.equal(bad.job.status, 'error');
  assert.match(bad.job.error, /could not open this video/);
  assert.equal(bad.saved, null);
  assert.equal(m.usage.length, 0);
  // and the person can try again straight away
  assert.deepEqual(await m.svc.start(1, 'aaaaaaaaaaa'), { started: true });
  await settle();

  // a reply with no speech is an error, not an empty saved transcript
  m = make({ text: '[]' });
  await m.svc.start(1, 'aaaaaaaaaaa');
  await settle();
  const none = await m.svc.status(1, 'aaaaaaaaaaa');
  assert.equal(none.job.status, 'error');
  assert.match(none.job.error, /did not find any speech/);
  assert.equal(none.saved, null);

  // not allowed to start when the plan says no
  const no = await make({ noKey: true }).svc.start(1, 'aaaaaaaaaaa');
  assert.equal(no.status, 400);

  console.log('youtubeAiJobs: ok');
})().catch((e) => { console.error(e); process.exit(1); });
