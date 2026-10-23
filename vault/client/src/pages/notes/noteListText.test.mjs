import assert from 'node:assert';
import { listText } from './noteListText.mjs';

// a titled note shows its title and the start of its text
assert.deepStrictEqual(listText({ title: 'Launch plan', body: 'Move to March.\nCall Sam.' }), { title: 'Launch plan', preview: 'Move to March. Call Sam.' });
// an untitled note with text shows its first line as the title and the rest as the preview
assert.deepStrictEqual(listText({ title: 'Untitled', body: 'Ideas for the launch\nmove to March, call Sam' }), { title: 'Ideas for the launch', preview: 'move to March, call Sam' });
assert.deepStrictEqual(listText({ title: '', body: '\n\n  Buy milk  ' }), { title: 'Buy milk', preview: '' }, 'blank lines and spaces are skipped');
assert.deepStrictEqual(listText({ title: 'untitled', body: 'one line only' }), { title: 'one line only', preview: '' }, 'any case of "untitled"');
// nothing at all
assert.deepStrictEqual(listText({ title: 'Untitled', body: '' }), { title: 'Untitled', preview: '' });
assert.deepStrictEqual(listText({ title: 'Untitled' }), { title: 'Untitled', preview: '' });
assert.deepStrictEqual(listText(null), { title: 'Untitled', preview: '' });
// a very long first line is cut
const long = listText({ title: 'Untitled', body: `${'word '.repeat(40)}\nmore` });
assert.ok(long.title.length <= 61 && long.title.endsWith('…'), 'a long first line is shortened');
assert.strictEqual(long.preview, 'more');
// previews are bounded
assert.strictEqual(listText({ title: 'T', body: 'x'.repeat(500) }).preview.length, 60);
// a real title is never replaced by the text
assert.strictEqual(listText({ title: 'Budget', body: 'something else' }).title, 'Budget');

// markdown symbols are not shown in the list: a "# Heading" first line lists as "Heading", a to-do as its words
assert.deepStrictEqual(listText({ title: 'Untitled', body: '# Launch plan\n- [ ] Call Sam\n**Important**' }), { title: 'Launch plan', preview: 'Call Sam Important' });
assert.strictEqual(listText({ title: 'Plan', body: '**Bold** start' }).preview, 'Bold start');
assert.strictEqual(listText({ title: 'Untitled', preview: '## From the list preview' }).title, 'From the list preview', 'works on the short preview the list sends');

console.log('ok - note list text: first line stands in for "Untitled", real titles are kept');
