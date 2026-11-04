// node client/src/pages/domains/workspace.test.mjs   (the set being worked on)
import assert from 'node:assert';
import { BLANK_WS, MAX_POOL, dataOf, jsonOf, isDirty, fromSet, mergeRound, orderedPool, toggleShortlist, toggleFeedback, feedbackOf, addTurn, addNote } from './workspace.mjs';

const card = (name, round = 1, over = {}) => ({ name, round, style: 'invented', syllables: 2, spell: { score: 0, notes: [] }, reasoning: '', risks: [], domains: { checkedAt: null, results: [] }, ...over });
const names = (pool) => pool.map((c) => c.name);

// unsaved / saved
assert.strictEqual(isDirty(BLANK_WS), false, 'an empty page has nothing to lose');
assert.strictEqual(isDirty({ ...BLANK_WS, brief: { ...BLANK_WS.brief, what: 'A cafe' } }), true);
{
  const ws = { ...BLANK_WS, brief: { ...BLANK_WS.brief, what: 'A cafe' }, pool: [card('lumera')] };
  const saved = { ...ws, id: 3, savedJson: jsonOf(ws) };
  assert.strictEqual(isDirty(saved), false);
  assert.strictEqual(isDirty({ ...saved, shortlist: ['lumera'] }), true);
  assert.strictEqual(isDirty({ ...saved, name: 'Renamed' }), false, 'the set name is saved with the set, not part of its data');
}
// what is saved is version 2 and leaves out the screen
{
  const d = dataOf({ ...BLANK_WS, lastCounts: { shown: 3 }, id: 9, name: 'x', legacy: { old: 1 } });
  assert.strictEqual(d.schemaVersion, 2);
  assert.ok(!('lastCounts' in d) && !('id' in d) && !('savedJson' in d));
  assert.deepStrictEqual(d.legacy, { old: 1 });
  assert.ok(!('legacy' in dataOf(BLANK_WS)));
}
// opening a saved set fills the gaps in older data and starts clean
{
  const ws = fromSet({ id: 5, name: 'Wine', data: { schemaVersion: 2, brief: { what: 'Fridges', tone: { playfulSerious: 1 } }, pool: [card('a1b')], shortlist: ['a1b'], preferred: 'a1b' } });
  assert.strictEqual(ws.id, 5);
  assert.strictEqual(ws.brief.tone.modernClassic, 3, 'missing tone sliders are neutral');
  assert.strictEqual(ws.brief.tone.playfulSerious, 1);
  assert.deepStrictEqual(ws.brief.required, { tlds: [], platforms: [] });
  assert.strictEqual(isDirty(ws), false);
  assert.deepStrictEqual(ws.feedback, { more: [], less: [] });
  assert.strictEqual(fromSet({ id: 1, name: 'x' }).pool.length, 0, 'an empty set opens');
}

// merging a round
{
  let ws = { ...BLANK_WS };
  ws = mergeRound(ws, { cards: [card('lumera', 1), card('tasmin', 1)], checkedNames: ['lumera', 'tasmin', 'dropped1'], counts: { generated: 180, shown: 2 }, creditsUsed: 40 });
  assert.deepStrictEqual(names(ws.pool), ['lumera', 'tasmin']);
  assert.deepStrictEqual(ws.seen, ['lumera', 'tasmin', 'dropped1'], 'everything looked at is remembered');
  assert.strictEqual(ws.rounds, 1);
  assert.deepStrictEqual(ws.lastCounts, { generated: 180, shown: 2, added: 2, credits: 40 });
  // round two: a repeat is updated in place and keeps its first round; a new name is added
  ws = mergeRound(ws, { cards: [card('lumera', 2, { reasoning: 'newer' }), card('bevaro', 2)], checkedNames: ['lumera', 'bevaro'], counts: {}, creditsUsed: 40 });
  assert.deepStrictEqual(names(ws.pool), ['lumera', 'tasmin', 'bevaro']);
  assert.strictEqual(ws.pool[0].reasoning, 'newer');
  assert.strictEqual(ws.pool[0].round, 1);
  assert.strictEqual(ws.lastCounts.added, 1);
  assert.strictEqual(ws.rounds, 2);
  // nothing came back
  assert.strictEqual(mergeRound(ws, { cards: [] }).pool.length, 3);
}
// the pool is capped; own, shortlisted and preferred names stay, the oldest go
{
  const old = Array.from({ length: MAX_POOL }, (_, i) => card(`old${i}`, 1));
  old[0] = card('keepme', 1, { own: true });
  let ws = { ...BLANK_WS, pool: old, shortlist: ['old1'], preferred: 'old2' };
  ws = mergeRound(ws, { cards: [card('new1', 2), card('new2', 2), card('new3', 2)], checkedNames: [] });
  assert.strictEqual(ws.pool.length, MAX_POOL);
  for (const keep of ['keepme', 'old1', 'old2', 'new1', 'new2', 'new3']) assert.ok(names(ws.pool).includes(keep), `${keep} kept`);
  assert.ok(!names(ws.pool).includes('old3') && !names(ws.pool).includes('old4') && !names(ws.pool).includes('old5'), 'the oldest others went');
}
// seen is bounded
assert.ok(mergeRound({ ...BLANK_WS, seen: Array.from({ length: 400 }, (_, i) => `n${i}`) }, { cards: [], checkedNames: ['z'] }).seen.length <= 300);

// order: own first, newest round first, then arrival order
assert.deepStrictEqual(names(orderedPool([card('a', 1), card('b', 2), card('c', 2), card('mine', 1, { own: true })])), ['mine', 'b', 'c', 'a']);
assert.deepStrictEqual(orderedPool(null), []);

// shortlist
{
  let ws = { ...BLANK_WS, preferred: 'a' };
  ws = toggleShortlist(ws, 'a');
  assert.deepStrictEqual(ws.shortlist, ['a']);
  ws = toggleShortlist(ws, 'b');
  assert.deepStrictEqual(ws.shortlist, ['a', 'b']);
  ws = toggleShortlist(ws, 'a');
  assert.deepStrictEqual(ws.shortlist, ['b']);
  assert.strictEqual(ws.preferred, '', 'taking the preferred name off the shortlist clears it');
  assert.strictEqual(toggleShortlist({ ...BLANK_WS, shortlist: Array.from({ length: 16 }, (_, i) => `n${i}`) }, 'extra').shortlist.length, 16, 'at most sixteen');
}
// more like this / less like this
{
  let ws = toggleFeedback(BLANK_WS, 'lumera', 'more');
  assert.strictEqual(feedbackOf(ws, 'lumera'), 'more');
  ws = toggleFeedback(ws, 'lumera', 'less');
  assert.strictEqual(feedbackOf(ws, 'lumera'), 'less');
  assert.deepStrictEqual(ws.feedback.more, [], 'one or the other');
  ws = toggleFeedback(ws, 'lumera', 'less');
  assert.strictEqual(feedbackOf(ws, 'lumera'), '', 'pressing again clears it');
  assert.strictEqual(feedbackOf(BLANK_WS, 'x'), '');
}

// the talk-it-through thread and extra notes
{
  let ws = addTurn(BLANK_WS, 'Which suggests events?', 'Lean towards a.');
  assert.deepStrictEqual(ws.conversation, [{ q: 'Which suggests events?', a: 'Lean towards a.' }]);
  for (let i = 0; i < 20; i++) ws = addTurn(ws, 'q' + i, 'a' + i);
  assert.strictEqual(ws.conversation.length, 12);
  assert.strictEqual(ws.conversation[11].q, 'q19');
  assert.deepStrictEqual(dataOf(ws).conversation, ws.conversation, 'the thread is saved');
  assert.deepStrictEqual(fromSet({ id: 1, name: 'x', data: { conversation: [{ q: 'a', a: 'b' }] } }).conversation, [{ q: 'a', a: 'b' }]);
  assert.deepStrictEqual(fromSet({ id: 1, name: 'x' }).conversation, []);
  let n = addNote(BLANK_WS, '  The exhibitions are called Stairs of Light ');
  assert.strictEqual(n.brief.notes, 'The exhibitions are called Stairs of Light');
  n = addNote(n, 'Aimed at galleries');
  assert.strictEqual(n.brief.notes, 'The exhibitions are called Stairs of Light\nAimed at galleries');
  assert.strictEqual(addNote(BLANK_WS, '   '), BLANK_WS, 'nothing to add');
  assert.strictEqual(addNote(BLANK_WS, 'x'.repeat(3000)).brief.notes.length, 1500);
}

console.log('workspace tests passed');
