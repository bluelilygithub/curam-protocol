// node client/src/pages/guitar/gigPlay.test.mjs   (gig mode rules)
import assert from 'node:assert';
import { clampBpm, chordMs, groupChart, keyAction, clampIndex, FONT_STEPS } from './gigPlay.mjs';

// ── Gig mode ──
assert.strictEqual(clampBpm(100), 100);
assert.strictEqual(clampBpm(5), 30);
assert.strictEqual(clampBpm(900), 240);
assert.strictEqual(clampBpm(null), 100);
assert.strictEqual(chordMs(120, 4), 2000);
assert.strictEqual(chordMs(60, 2), 2000);
assert.strictEqual(chordMs(undefined, 4), 2400);

const events = [
  { sectionName: 'Verse', lineIdx: 0, lyricText: 'one', chordRoot: 'C' }, { sectionName: 'Verse', lineIdx: 0, chordRoot: 'G' },
  { sectionName: 'Verse', lineIdx: 1, lyricText: 'two', chordRoot: 'A' },
  { sectionName: 'Chorus', lineIdx: 2, chordRoot: 'F' }, { sectionName: 'Capo 2', lineIdx: 3, chordRoot: 'C' },
];
const g = groupChart(events);
assert.deepStrictEqual(g.map(s => [s.name, s.lines.length]), [['Verse', 2], ['Chorus', 1], [null, 1]], 'a Capo line is not a section');
assert.deepStrictEqual(g[0].lines[0].evs.map(e => e.flatIdx), [0, 1]);
assert.strictEqual(g[0].lines[0].lyric, 'one');
assert.strictEqual(g[2].lines[0].evs[0].flatIdx, 4);
assert.deepStrictEqual(groupChart([]), []);

for (const [k, a] of [[' ', 'toggle'], ['ArrowRight', 'next'], ['PageDown', 'next'], ['ArrowLeft', 'prev'], ['PageUp', 'prev'], ['+', 'bigger'], ['-', 'smaller'], ['n', 'nextSong'], ['p', 'prevSong'], [']', 'faster'], ['[', 'slower']]) {
  assert.strictEqual(keyAction(k), a, `${JSON.stringify(k)} is ${a}`);
}
assert.strictEqual(keyAction('x'), null);
assert.strictEqual(keyAction('Escape'), null, 'Escape is left to the window');
assert.strictEqual(clampIndex(-3, 5), 0);
assert.strictEqual(clampIndex(9, 5), 4);
assert.strictEqual(clampIndex(2, 0), 0);
assert.ok(FONT_STEPS.every((n, i) => i === 0 || n > FONT_STEPS[i - 1]));

console.log('gigPlay tests passed');
