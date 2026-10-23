// node client/src/pages/notes/noteTodos.test.mjs   (part of npm run test:notes)
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { countUnlinked, stripMarkers, chipify, dueLabel } from './noteTodos.mjs';

const body = ['# Visit', '- [ ] Call Sam {task:5}', '- [x] Send the quote {task:6}', '- [ ] Book the venue', '- [x] already done', '- plain bullet {task:9}', '- [ ] '].join('\n');
assert.strictEqual(countUnlinked(body), 1, 'only a to-do that is open and not a task yet');
assert.strictEqual(countUnlinked('- [ ] a\n- [ ] b\n  - [ ] c'), 3);
assert.strictEqual(countUnlinked(''), 0);
assert.strictEqual(stripMarkers(body), ['# Visit', '- [ ] Call Sam', '- [x] Send the quote', '- [ ] Book the venue', '- [x] already done', '- plain bullet {task:9}', '- [ ] '].join('\n'), 'only to-do lines lose their marker');
assert.strictEqual(stripMarkers('- [ ] a {task:1}\r\n- [ ] b'), '- [ ] a\r\n- [ ] b');
assert.strictEqual(chipify('- [ ] Call Sam {task:5}\ntext {task:5}'), '- [ ] Call Sam [task](vault-task:5)\ntext {task:5}', 'a link the view draws as a chip; line numbers are unchanged');
assert.strictEqual(chipify('- [x] a {task:1}\r\n').split('\n').length, 2);

// the same lines are found as on the server
const require = createRequire(import.meta.url);
const server = require('../../../../server/services/noteTodos.js');
for (const sample of [body, '- [ ] a {task:1}\n  - [x] b\n1. [ ] c {task:22}\n* [ ] d', 'nothing', '- [ ] x {task:3} more']) {
  assert.strictEqual(countUnlinked(sample), server.countUnlinked(sample), 'same count as the server');
  assert.strictEqual(stripMarkers(sample) === sample, server.parseTodos(sample).every((t) => !t.taskId), 'markers found on the same lines');
}

// the chip's words
const today = '2026-10-23';
assert.strictEqual(dueLabel(null, today), 'Task');
assert.strictEqual(dueLabel({ status: 'done', dueDate: '2026-10-01' }, today), 'Done');
assert.strictEqual(dueLabel({ status: 'todo', dueDate: null }, today), 'Task');
assert.strictEqual(dueLabel({ status: 'in-progress' }, today), 'In progress');
assert.strictEqual(dueLabel({ status: 'todo', dueDate: '2026-10-23' }, today), 'Due today');
assert.strictEqual(dueLabel({ status: 'todo', dueDate: '2026-10-30' }, today), 'Due Fri 30 Oct');
assert.strictEqual(dueLabel({ status: 'todo', dueDate: '2026-10-20T00:00:00.000Z' }, today), 'Overdue, Tue 20 Oct');

console.log('ok - live to-dos on the screen: counts, markers, chips, due wording, same lines as the server');
