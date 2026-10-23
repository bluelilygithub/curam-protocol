import assert from 'node:assert';
import { toggleTaskLine, taskCounts, stripMarkdown } from './noteMarkdown.mjs';

// ticking a to-do writes back into the right line only
const body = 'Plan\n- [ ] Call Sam\n- [x] Send quote\n  - [ ] nested\n1. [ ] numbered\nplain - [ ] not a task';
assert.strictEqual(toggleTaskLine(body, 2).split('\n')[1], '- [x] Call Sam');
assert.strictEqual(toggleTaskLine(body, 3).split('\n')[2], '- [ ] Send quote', 'a ticked one unticks');
assert.strictEqual(toggleTaskLine(body, 4).split('\n')[3], '  - [x] nested', 'indent is kept');
assert.strictEqual(toggleTaskLine(body, 5).split('\n')[4], '1. [x] numbered');
assert.strictEqual(toggleTaskLine(toggleTaskLine(body, 2), 2), body, 'twice is back to the start');
assert.strictEqual(toggleTaskLine(body, 1), body, 'a heading line is not a task');
assert.strictEqual(toggleTaskLine(body, 6), body, 'a [ ] in the middle of a sentence is not a task');
assert.strictEqual(toggleTaskLine(body, 99), body, 'a stale line number changes nothing');
assert.strictEqual(toggleTaskLine(body, 0), body);
assert.strictEqual(toggleTaskLine(body, 'x'), body);
assert.strictEqual(toggleTaskLine(null, 1), '');
// only that one line changes
const changed = toggleTaskLine(body, 2).split('\n');
assert.deepStrictEqual(changed.filter((l, i) => l !== body.split('\n')[i]).length, 1);

assert.deepStrictEqual(taskCounts(body), { total: 4, done: 1 });
assert.deepStrictEqual(taskCounts('nothing here'), { total: 0, done: 0 });
assert.deepStrictEqual(taskCounts(undefined), { total: 0, done: 0 });

// list rows read as words
assert.strictEqual(stripMarkdown('# Launch plan'), 'Launch plan');
assert.strictEqual(stripMarkdown('### Deep heading'), 'Deep heading');
assert.strictEqual(stripMarkdown('**Call** Sam about __the quote__'), 'Call Sam about the quote');
assert.strictEqual(stripMarkdown('some *emphasis* and _more_ here'), 'some emphasis and more here');
assert.strictEqual(stripMarkdown('- [ ] Buy milk'), 'Buy milk');
assert.strictEqual(stripMarkdown('- [x] Done thing'), 'Done thing');
assert.strictEqual(stripMarkdown('- bullet one\n* bullet two\n1. numbered'), 'bullet one\nbullet two\nnumbered');
assert.strictEqual(stripMarkdown('see [the site](https://example.com) now'), 'see the site now');
assert.strictEqual(stripMarkdown('![logo](a.png)'), 'logo');
assert.strictEqual(stripMarkdown('run `npm test` first'), 'run npm test first');
assert.strictEqual(stripMarkdown('> quoted'), 'quoted');
assert.strictEqual(stripMarkdown('~~old~~ new'), 'old new');
// things that are not markdown stay as typed
assert.strictEqual(stripMarkdown('use snake_case_names and 2 * 3 = 6'), 'use snake_case_names and 2 * 3 = 6');
assert.strictEqual(stripMarkdown('Move to March. Call Sam.'), 'Move to March. Call Sam.');
assert.strictEqual(stripMarkdown('100% sure_thing'), '100% sure_thing');
assert.strictEqual(stripMarkdown(null), '');

console.log('ok - note markdown: tick a to-do in place, strip symbols for list rows');
