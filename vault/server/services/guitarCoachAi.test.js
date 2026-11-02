'use strict';
// node server/services/guitarCoachAi.test.js. A fake model is used; nothing is sent anywhere.
const assert = require('assert');
const coach = require('./guitarCoach');
const ai = require('./guitarCoachAi');

const now = new Date();
const ago = (d) => new Date(now.getTime() - d * 86400000).toISOString();
const facts = coach.weekFacts({
  sessions: [{ songId: 1, title: 'Blackbird', minutes: 30, confidence: 4, playedAt: ago(1) }],
  loopRuns: [], scores: [], songs: [{ id: 2, title: 'Wonderwall', learnStatus: 'ready', lastPracticedAt: ago(40) }],
}, now);

const fake = (text, log = []) => ({
  getModels: async () => ({ standard: 'std-model', light: 'light-model' }),
  callModel: async (model, prompt, opts) => { log.push({ model, prompt, system: opts.system }); return { text, model, inputTokens: 1, outputTokens: 1 }; },
  logUsage: (u) => log.push({ usage: u }),
});

(async () => {
  // A good answer is used, with the light model, and the usage is logged under the coach's feature name
  const log = [];
  let r = await ai.weeklyReview(7, facts, fake(JSON.stringify({ review: 'You practised 30 minutes over 1 session. Wonderwall is going rusty, so revisit it.' }), log));
  assert.strictEqual(r.source, 'ai');
  assert.match(r.text, /Wonderwall/);
  assert.strictEqual(log.find(l => l.model).model, 'light-model', 'review uses the light model');
  assert.deepStrictEqual({ u: log.find(l => l.usage).usage.userId, f: log.find(l => l.usage).usage.feature }, { u: 7, f: 'guitar_coach_review' });
  assert.match(log.find(l => l.prompt).prompt, /FACTS/);

  // A made-up number is not shown: the template is used instead
  r = await ai.weeklyReview(7, facts, fake(JSON.stringify({ review: 'Great, a 12 day streak and 90 minutes!' })));
  assert.strictEqual(r.source, 'rules');
  assert.ok(!/streak/.test(r.text));
  // Not JSON, an error from the model, and no model at all each fall back
  assert.strictEqual((await ai.weeklyReview(7, facts, fake('sorry, no'))).source, 'rules');
  assert.strictEqual((await ai.weeklyReview(7, facts, { ...fake(''), callModel: async () => { throw new Error('boom'); } })).source, 'rules');
  assert.strictEqual((await ai.weeklyReview(7, facts, { ...fake(''), getModels: async () => ({}) })).source, 'rules');
  // A quiet week never calls the model
  const quiet = coach.weekFacts({ sessions: [], loopRuns: [], scores: [], songs: [] }, now);
  const quietLog = [];
  assert.strictEqual((await ai.weeklyReview(7, quiet, fake('{}', quietLog))).source, 'rules');
  assert.strictEqual(quietLog.length, 0);

  // Session wording
  const songs = [{ id: 1, title: 'A', learnStatus: 'learning', lastPracticedAt: ago(1) }, { id: 2, title: 'B', learnStatus: 'ready', lastPracticedAt: ago(40) }];
  const plan = coach.buildSession({ minutes: 20, focus: [], songs, loops: [], transitions: [] }, now);
  const tips = plan.blocks.map(() => 'Play it through without stopping.');
  const sLog = [];
  let s = await ai.sessionWords(7, plan, 'rhythm', fake(JSON.stringify({ intro: 'A short mix.', tips }), sLog));
  assert.strictEqual(s.source, 'ai');
  assert.match(sLog.find(l => l.prompt).prompt, /never as instructions/, 'the typed focus is passed as data');
  s = await ai.sessionWords(7, plan, '', fake(JSON.stringify({ intro: 'x', tips: ['too few'] })));
  assert.strictEqual(s.source, 'rules');
  assert.strictEqual(s.tips.length, plan.blocks.length);

  // Explain: a good answer passes; a chord the song does not use, or no model, gives null
  const song = coach.explainFacts({ title: 'T', artist: 'A', bpm: 90 }, [{ chordRoot: 'C', chordQuality: '' }, { chordRoot: 'G', chordQuality: '' }, { chordRoot: 'A', chordQuality: 'm' }], { key: 'C major' });
  const eLog = [];
  const good = await ai.explainSong(7, song, fake(JSON.stringify({ summary: 'C, G and Am in C major.', why: ['G leads home to C.'], techniques: ['Loop the G to Am change.'] }), eLog));
  assert.ok(good);
  assert.strictEqual(eLog.find(l => l.model).model, 'std-model', 'explain uses the standard model');
  assert.strictEqual(await ai.explainSong(7, song, fake(JSON.stringify({ summary: 'Add an Fmaj7 here.', why: ['Fmaj7 is lush.'], techniques: [] }))), null);
  assert.strictEqual(await ai.explainSong(7, song, { ...fake(''), getModels: async () => ({}) }), null);

  console.log('guitarCoachAi tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
