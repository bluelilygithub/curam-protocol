import assert from 'node:assert';
import { SCOPES, STARTERS, citeLinks, historyFor } from './askNotes.mjs';

assert.deepStrictEqual(SCOPES.map((s) => s.id), ['all', 'filters', 'note'], 'the three scopes the server understands');
assert.ok(STARTERS.length >= 3 && STARTERS.every((q) => q.length > 15 && q.length <= 500));

assert.strictEqual(citeLinks('Sam agreed [1] and Jo [2][3].'), 'Sam agreed [1](#src-1) and Jo [2](#src-2)[3](#src-3).');
assert.strictEqual(citeLinks('See [site](https://x.com) and [1].'), 'See [site](https://x.com) and [1](#src-1).', 'a real link is left alone');
assert.strictEqual(citeLinks('[1](#src-1) again'), '[1](#src-1) again', 'already a link: not wrapped twice');
assert.strictEqual(citeLinks('a [note] and [a1] and [1234]'), 'a [note] and [a1] and [1234]', 'brackets that are not a small number are left alone');
assert.strictEqual(citeLinks(null), '');

const done = (q, a) => ({ id: q, question: q, answer: a });
assert.deepStrictEqual(historyFor([done('q1', 'a1'), { question: 'q2', pending: true }, { question: 'q3', error: 'boom' }, done('q4', 'a4')]),
  [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q4' }, { role: 'assistant', content: 'a4' }], 'unanswered and failed turns are skipped');
assert.strictEqual(historyFor(Array.from({ length: 10 }, (_, i) => done(`q${i}`, `a${i}`))).length, 6, 'only the last six messages');
assert.deepStrictEqual(historyFor(Array.from({ length: 10 }, (_, i) => done(`q${i}`, `a${i}`))).at(-1), { role: 'assistant', content: 'a9' });
assert.deepStrictEqual(historyFor(undefined), []);

console.log('ok - ask your notes: scopes, starters, citation links, history for follow-ups');
