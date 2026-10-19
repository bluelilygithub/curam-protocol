'use strict';

// node server/services/notesTutor.test.js   (npm run test:notes-tutor). No model is called.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS, buildTutorPrompt, cleanMessages, normalizeTutorReply, askNotesTutor,
} = require('./notesTutor');

(async () => {
  // ---- the guide knows exactly the controls the page can show (fails if one is added to or removed from either list alone) ----
  const { NOTES_TOOLS } = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/notes/notesTools.mjs')).href);
  assert.deepStrictEqual(CATALOG.map((t) => t.id).sort(), NOTES_TOOLS.map((t) => t.id).sort(), 'the guide catalogue matches the Notes controls');
  assert.strictEqual(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, 'no duplicate ids');
  for (const t of CATALOG) {
    assert.ok(t.group && t.does && t.label, `${t.id} is described`);
    assert.strictEqual(t.label, NOTES_TOOLS.find((n) => n.id === t.id).label, `${t.id} uses the page's own name`);
  }
  assert.ok(NOTES_TOOLS.every((t) => ['create', 'recorder', 'search', 'editor', 'list'].includes(t.open)), 'every control says what Open does');

  // ---- the voice-note facts the guide must not get wrong ----
  const voice = CATALOG.find((t) => t.id === 'new-voice-note');
  assert.match(voice.does, /Stop and make the note/);
  assert.match(voice.does, /tidies them|tidy/i);
  assert.match(voice.does, /always kept at the bottom/);
  assert.match(voice.notes, /deleted/);
  assert.match(voice.notes, /about an hour/);
  assert.match(voice.notes, /small cost/);
  assert.match(voice.notes, /Try again button/);
  assert.match(CATALOG.find((t) => t.id === 'dictate').notes, /different from New voice note/);
  const gaps = NOT_POSSIBLE.join(' ');
  for (const needle of [/Replaying a voice recording/, /who said what by name/, /Zoom, Teams/, /about an hour/, /legal or evidential/, /Folders, tags or sharing/, /Restoring a deleted note/]) assert.match(gaps, needle);
  assert.match(RULES.join(' '), /Open buttons .* never change or delete an existing note/);
  assert.match(RULES.join(' '), /two|microphone buttons/);

  // ---- safety rules are in the instructions ----
  assert.match(SYSTEM, /cannot see any of this person's notes/);
  assert.match(SYSTEM, /ONLY the tools and rules/);
  assert.match(SYSTEM, /Never invent a button/i);
  assert.match(SYSTEM, /New voice note \(beside \+\) records/);
  assert.match(SYSTEM, /Dictate \(in the editor\) types live/);

  // ---- the prompt carries every tool, the rules, the gaps, the conversation ----
  const prompt = buildTutorPrompt({ messages: [{ role: 'user', content: 'record my voice' }], currentTool: 'dictate' });
  for (const t of CATALOG) assert.ok(prompt.includes(`tool "${t.id}"`), `prompt lists ${t.id}`);
  assert.match(prompt, /THINGS IT DOES NOT DO/);
  assert.match(prompt, /Person: record my voice/);
  assert.match(prompt, /currently has the "dictate" tool open/);

  // ---- conversation hygiene and the model's answer is untrusted ----
  const msgs = cleanMessages([{ role: 'system', content: 'x' }, { role: 'user', content: '  hi \n there ' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }))]);
  assert.ok(msgs.length <= 10 && msgs.every((m) => m.role === 'user' || m.role === 'assistant'));
  let r = normalizeTutorReply(JSON.stringify({ verdict: 'doable', answer: 'Use the mic.', steps: [{ tool: 'new-voice-note', do: 'Press Start recording.' }, { tool: 'teleporter', do: 'x' }] }));
  assert.deepStrictEqual(r.steps.map((s) => s.tool), ['new-voice-note'], 'unknown ids are dropped');
  assert.strictEqual(r.steps[0].label, 'New voice note');
  r = normalizeTutorReply({ verdict: 'doable', answer: 'x', steps: [] });
  assert.strictEqual(r.verdict, 'question', 'doable with no steps is not an answer');
  r = normalizeTutorReply({ verdict: 'beyond', answer: 'No.', steps: [{ tool: 'search', do: 'x' }] });
  assert.strictEqual(r.steps.length, 0, 'a beyond answer shows no steps');
  r = normalizeTutorReply({ verdict: 'accountant', answer: 'x', steps: [] });
  assert.ok(VERDICTS.includes(r.verdict));
  r = normalizeTutorReply('not json {oops');
  assert.ok(!/[{}]/.test(r.answer));

  // ---- ask() with a fake model ----
  let seen = null; let logged = null;
  const deps = {
    getModels: async () => ({ standard: 'test-model', light: 'light-model' }),
    callModel: async (model, p, opts) => { seen = { model, prompt: p, system: opts.system }; return { text: JSON.stringify({ verdict: 'doable', answer: 'ok', steps: [{ tool: 'convert-task', do: 'Press the tick-list button.' }] }), model, inputTokens: 1, outputTokens: 1 }; },
    logUsage: (u) => { logged = u; },
  };
  const out = await askNotesTutor(7, { messages: [{ role: 'user', content: 'turn this into a task' }] }, deps);
  assert.strictEqual(out.steps[0].tool, 'convert-task');
  assert.strictEqual(seen.model, 'test-model', 'uses the workspace model, never a hardcoded id');
  assert.deepStrictEqual({ u: logged.userId, f: logged.feature }, { u: 7, f: 'notes_guide' });
  await assert.rejects(askNotesTutor(1, { messages: [] }, deps), /Type what you want to do/);

  console.log('notesTutor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
