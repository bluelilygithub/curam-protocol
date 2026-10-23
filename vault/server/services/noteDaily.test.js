'use strict';

// node server/services/noteDaily.test.js   (part of npm run test:notes)

const assert = require('assert');
const { MAX_CARRIED, validDay, extractOpenTodos, composeDailyBody } = require('./noteDaily');

assert.strictEqual(validDay('2026-10-23'), '2026-10-23');
assert.strictEqual(validDay(' 2026-10-23 '), '2026-10-23');
assert.strictEqual(validDay('2026-02-30'), null);
assert.strictEqual(validDay('23/10/2026'), null);
assert.strictEqual(validDay(undefined), null);
assert.strictEqual(validDay('2028-02-29'), '2028-02-29', 'leap day');
assert.strictEqual(validDay('2027-02-29'), null);

const prev = [
  '# Thu 22 Oct',
  '- [ ] Call Sam',
  '- [x] Send quote',
  '  - [ ] nested open one',
  '1. [ ] numbered one',
  '* [ ]   padded text  ',
  '- [ ] ',
  '- [ ] Call Sam',
  'text - [ ] not a todo',
].join('\n');
assert.deepStrictEqual(extractOpenTodos(prev), ['- [ ] Call Sam', '- [ ] nested open one', '- [ ] numbered one', '- [ ] padded text'],
  'open ones only, nested included, repeats and empty boxes dropped, always written as "- [ ] text"');
assert.deepStrictEqual(extractOpenTodos('nothing here'), []);
assert.deepStrictEqual(extractOpenTodos(null), []);
assert.strictEqual(extractOpenTodos(Array.from({ length: 80 }, (_, i) => `- [ ] task ${i}`).join('\n')).length, MAX_CARRIED);

assert.strictEqual(composeDailyBody('# Fri 23 Oct\n\nNotes:\n', [], '2026-10-22'), '# Fri 23 Oct\n\nNotes:', 'nothing carried: the template as it is');
assert.strictEqual(composeDailyBody('# Fri', ['- [ ] a', '- [ ] b'], '2026-10-22'), '# Fri\n\nCarried over from 2026-10-22:\n- [ ] a\n- [ ] b\n');
assert.strictEqual(composeDailyBody('', ['- [ ] a'], null), 'Carried over:\n- [ ] a\n');
// carried to-dos are real to-dos again, so they carry on the next day too
assert.deepStrictEqual(extractOpenTodos(composeDailyBody('# Sat', ['- [ ] a'], '2026-10-22')), ['- [ ] a']);

console.log('noteDaily tests passed');
