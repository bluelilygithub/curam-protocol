'use strict';

// node server/services/noteTodos.test.js   (part of npm run test:notes)
// Live to-dos, the pure rules: reading the lines, showing each as its task is now, what a save passes on, dates in a line, marking lines.

const assert = require('assert');
const T = require('./noteTodos');

const body = ['# Visit', '- [ ] Call Sam about the budget {task:5}', '- [x] Send the quote {task:6}', '- [ ] Book the venue', '  - [ ] nested one {task:7}', '- plain bullet', '1. [ ] numbered', 'Text with {task:9} inside'].join('\n');

// reading
const todos = T.parseTodos(body);
assert.deepStrictEqual(todos.map((t) => [t.line, t.checked, t.text, t.taskId]), [
  [1, false, 'Call Sam about the budget', 5], [2, true, 'Send the quote', 6], [3, false, 'Book the venue', null], [4, false, 'nested one', 7], [6, false, 'numbered', null],
], 'to-do lines only, with the marker taken off the text');
assert.strictEqual(T.countUnlinked(body), 2, 'not ticked, not a task yet');
assert.strictEqual(T.countUnlinked('- [x] done thing'), 0);
assert.strictEqual(T.countUnlinked('- [ ] '), 0, 'an empty box is not a to-do');
assert.deepStrictEqual(T.parseTodos('- [ ] Windows line\r\n- [x] second {task:3}\r\n').map((t) => [t.text, t.taskId]), [['Windows line', null], ['second', 3]], 'CRLF text is fine');

// showing: each linked line as its task is now; a task that is gone loses its marker
const tasks = new Map([[5, { id: 5, title: 'Call Sam Jones about the budget', status: 'done', dueDate: '2026-11-02' }], [6, { id: 6, title: 'Send the quote', status: 'todo', dueDate: null }]]);
const shown = T.overlay(body, tasks);
assert.deepStrictEqual(shown.body.split('\n').slice(0, 5), ['# Visit', '- [x] Call Sam Jones about the budget {task:5}', '- [ ] Send the quote {task:6}', '- [ ] Book the venue', '  - [ ] nested one'],
  'ticked as the task is, named as the task is, a gone task (7) loses its marker');
assert.deepStrictEqual(Object.keys(shown.linked), ['5', '6']);
assert.strictEqual(shown.linked[5].dueDate, '2026-11-02');
assert.strictEqual(shown.body.split('\n')[7], 'Text with {task:9} inside', 'only to-do lines carry markers');
assert.strictEqual(T.overlay('no todos here', new Map()).body, 'no todos here');
assert.strictEqual(T.overlay('- [ ] a {task:1}\r\n- [x] b', new Map([[1, { title: 'a', status: 'done' }]])).body, '- [x] a {task:1}\r\n- [x] b', 'line endings are kept');

// saving: only what the person changed since the saved text
const before = '- [ ] Call Sam {task:5}\n- [x] Send quote {task:6}\n- [ ] Plan {task:8}';
assert.deepStrictEqual(T.diff(before, before), { statusChanges: [], titleChanges: [], newLinks: [] }, 'nothing changed, nothing passed on');
assert.deepStrictEqual(T.diff(before, '- [x] Call Sam {task:5}\n- [ ] Send quote {task:6}\n- [ ] Plan {task:8}'),
  { statusChanges: [{ taskId: 5, done: true }, { taskId: 6, done: false }], titleChanges: [], newLinks: [] }, 'ticked and unticked');
assert.deepStrictEqual(T.diff(before, '- [ ] Call Sam Jones {task:5}\n- [x] Send quote {task:6}\n- [ ] Plan {task:8}').titleChanges, [{ taskId: 5, title: 'Call Sam Jones' }], 'renamed');
assert.deepStrictEqual(T.diff(before, `${before}\n- [ ] linked by hand {task:12}`).newLinks, [12], 'a marker that was not there before');
assert.deepStrictEqual(T.diff(before, '- [ ] Call Sam\n- [x] Send quote').statusChanges, [], 'a marker taken off unlinks: the task is left alone');
assert.deepStrictEqual(T.diff(before, '- [ ] Plan {task:8}\n- [ ] Call Sam {task:5}\n- [x] Send quote {task:6}'), { statusChanges: [], titleChanges: [], newLinks: [] }, 'moving lines around changes nothing');
assert.deepStrictEqual(T.diff('', '- [x] a {task:1}\n- [x] a again {task:1}').newLinks, [1], 'the same task twice counts once');

// a note that is out of date never re-opens a task finished elsewhere: the saved text and the new text agree, so nothing is passed on
assert.deepStrictEqual(T.diff('- [ ] Call Sam {task:5}', '- [ ] Call Sam {task:5}\nand a new line typed').statusChanges, []);

// dates
const today = '2026-10-23'; // a Friday
assert.strictEqual(T.parseDue('call Sam today', today), '2026-10-23');
assert.strictEqual(T.parseDue('Send it tomorrow', today), '2026-10-24');
assert.strictEqual(T.parseDue('by Friday', today), '2026-10-30', 'a Friday said on a Friday is the next one');
assert.strictEqual(T.parseDue('on Monday', today), '2026-10-26');
assert.strictEqual(T.parseDue('next Monday', today), '2026-10-26');
assert.strictEqual(T.parseDue('next Friday', today), '2026-10-30');
assert.strictEqual(T.parseDue('next Tuesday', '2026-10-21'), '2026-10-27', 'next week, even when this week still has one');
assert.strictEqual(T.parseDue('in 3 days', today), '2026-10-26');
assert.strictEqual(T.parseDue('in 2 weeks', today), '2026-11-06');
assert.strictEqual(T.parseDue('due 2026-12-01', today), '2026-12-01');
assert.strictEqual(T.parseDue('on 2026-02-30', today), null, 'not a real day');
assert.strictEqual(T.parseDue('12 Nov', today), '2026-11-12');
assert.strictEqual(T.parseDue('Nov 12th', today), '2026-11-12');
assert.strictEqual(T.parseDue('5 Jan', today), '2027-01-05', 'a date that has passed this year means next year');
assert.strictEqual(T.parseDue('31 Feb', today), null);
assert.strictEqual(T.parseDue('buy milk', today), null);
assert.strictEqual(T.parseDue('buy milk today', 'not a date'), null);

// marking lines
assert.strictEqual(T.markLine('- [ ] Call Sam', 5), '- [ ] Call Sam {task:5}');
assert.strictEqual(T.markLine('  - [ ] Call Sam {task:2}', 5), '  - [ ] Call Sam {task:5}', 'a marker is replaced, not doubled');
assert.strictEqual(T.markLine('- Call Sam', 5), '- [ ] Call Sam {task:5}', 'a plain bullet becomes a to-do');
assert.strictEqual(T.markLine('Just text', 5), 'Just text');
assert.strictEqual(T.markLine('- [ ] a\r', 3), '- [ ] a {task:3}\r');
assert.strictEqual(T.findBullet('To do:\n- Call Sam\n- Book it', 'book IT'), 2);
assert.strictEqual(T.findBullet('- [ ] Call Sam', 'Call Sam'), -1, 'a to-do is not a bullet');
assert.strictEqual(T.findBullet('- Call Sam\n- Call Sam', 'Call Sam', new Set([0])), 1, 'each line used once');

console.log('noteTodos pure tests passed');
