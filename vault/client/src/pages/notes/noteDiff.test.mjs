// node client/src/pages/notes/noteDiff.test.mjs   (part of npm run test:notes)
import assert from 'node:assert';
import { diffLines, diffStats, collapse } from './noteDiff.mjs';

const show = (ops) => ops.map((o) => `${o.type === 'same' ? ' ' : o.type === 'add' ? '+' : '-'}${o.text}`).join('|');

assert.strictEqual(show(diffLines('a\nb\nc', 'a\nb\nc')), ' a| b| c', 'no change');
assert.strictEqual(show(diffLines('a\nb\nc', 'a\nX\nc')), ' a|-b|+X| c', 'one line changed');
assert.strictEqual(show(diffLines('a\nb', 'a\nb\nc\nd')), ' a| b|+c|+d', 'lines added at the end');
assert.strictEqual(show(diffLines('a\nb\nc\nd', 'c\nd')), '-a|-b| c| d', 'lines removed at the start');
assert.strictEqual(show(diffLines('', 'new')), '-|+new', 'from nothing');
assert.strictEqual(show(diffLines('gone', '')), '-gone|+', 'to nothing');
assert.strictEqual(show(diffLines('1\n2\n3\n4\n5', '1\n3\n4\n6\n5')), ' 1|-2| 3| 4|+6| 5', 'two separate changes');
assert.strictEqual(show(diffLines('x\r\ny', 'x\ny')), ' x| y', 'line endings do not count as a change');
assert.deepStrictEqual(diffStats(diffLines('a\nb\nc', 'a\nX\nY\nc')), { added: 2, removed: 1 });

// a very long text does not stall the screen: it falls back to all removed, all added
const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n');
const other = Array.from({ length: 2500 }, (_, i) => `different ${i}`).join('\n');
const t0 = Date.now();
const ops = diffLines(big, other);
assert.ok(Date.now() - t0 < 1500, 'fast');
assert.deepStrictEqual(diffStats(ops), { added: 2500, removed: 2500 });

// showing only what changed, with a little around it
const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
const changed = long.replace('l15', 'CHANGED');
assert.deepStrictEqual(collapse(diffLines(long, changed), 2).map((o) => (o.type === 'gap' ? `~${o.count}` : show([o]))), ['~13', ' l13', ' l14', '-l15', '+CHANGED', ' l16', ' l17', '~12']);
assert.deepStrictEqual(collapse(diffLines('a\nb', 'a\nb'), 2), [{ type: 'gap', count: 2 }], 'no change: one gap');

console.log('ok - note diff: lines added, removed and changed, line endings ignored, long texts do not stall, collapse to what changed');
