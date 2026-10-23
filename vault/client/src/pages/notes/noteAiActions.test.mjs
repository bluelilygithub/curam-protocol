import assert from 'node:assert';
import { AI_ACTIONS, todayLocal, applyText, taskPayload } from './noteAiActions.mjs';

assert.deepStrictEqual(AI_ACTIONS.map((a) => a.id), ['summary', 'todos', 'tidy', 'tags', 'title'], 'same actions the server knows');
assert.ok(AI_ACTIONS.every((a) => a.label && a.icon && a.working));

// the person's own day, not UTC (11 pm on the 23rd is still the 23rd)
assert.strictEqual(todayLocal(new Date(2026, 9, 23, 23, 59)), '2026-10-23');
assert.strictEqual(todayLocal(new Date(2026, 0, 5, 0, 1)), '2026-01-05');

// applying text
assert.strictEqual(applyText('old', 'replace', 'new'), 'new');
assert.strictEqual(applyText('old', 'top', 'Summary:\nShort'), 'Summary:\nShort\n\nold');
assert.strictEqual(applyText('old\n\n', 'bottom', 'more'), 'old\n\nmore');
assert.strictEqual(applyText('', 'top', 'x'), 'x');
assert.strictEqual(applyText('keep', 'replace', '   '), 'keep', 'empty AI text never wipes the note');

// tasks carry the note's project and client, and only a real date
assert.deepStrictEqual(taskPayload({ title: ' Call Sam ', due: '2026-10-30', who: null }, { title: 'Acme call', project_id: 4, client_id: 9 }),
  { title: 'Call Sam', notes: 'From note: Acme call', projectId: 4, clientId: 9, dueDate: '2026-10-30' });
assert.deepStrictEqual(taskPayload({ title: 'Send quote', due: 'next week', who: 'Jo' }, { title: 'Untitled' }),
  { title: 'Send quote', notes: 'From a note\nFor: Jo', projectId: null, clientId: null, dueDate: null });
assert.strictEqual(taskPayload({ title: 'x'.repeat(500) }, {}).title.length, 200);

console.log('ok - note AI actions: local day, where text goes, task payload');
