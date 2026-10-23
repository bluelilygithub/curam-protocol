import assert from 'node:assert';
import { SCOPES, STARTERS, citeLinks, historyFor, buildMap, RELATED_KINDS } from './askNotes.mjs';

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

assert.strictEqual(citeLinks('Chase [T1] on [P2][C1], see [D3] and [A4] and [1].'), 'Chase [T1](#rel-T1) on [P2](#rel-P2)[C1](#rel-C1), see [D3](#rel-D3) and [A4](#rel-A4) and [1](#src-1).', 'linked records get their own kind of link');
assert.strictEqual(citeLinks('[X1] and [T] and [T1](#rel-T1)'), '[X1] and [T] and [T1](#rel-T1)', 'only the five kinds, with a number, once');

// ---- the mud map outline
const item = (key, kind, parent = null) => ({ key, kind, parent, label: key });
const map = buildMap([item('T2', 'task', 'C1'), item('C1', 'client'), item('P1', 'project', 'C1'), item('T1', 'task', 'P1'), item('D1', 'deal', 'C1'), item('P9', 'project'), item('T7', 'task', 'GONE'), item('A1', 'activity', 'C1')]);
assert.deepStrictEqual(map.map((n) => n.item.key), ['C1', 'P9', 'T7'], 'clients first, then loose projects, then loose tasks; one whose parent is missing is not lost');
assert.deepStrictEqual(map[0].children.map((n) => n.item.key), ['P1', 'T2', 'D1', 'A1'], 'under a client: projects, tasks, deals, contact');
assert.deepStrictEqual(map[0].children[0].children.map((n) => n.item.key), ['T1'], 'a project holds its tasks');
assert.deepStrictEqual(buildMap(undefined), []);
assert.deepStrictEqual(buildMap([item('C1', 'client', 'C1')]).map((n) => n.item.key), ['C1'], 'an item that names itself as its parent does not vanish');
assert.deepStrictEqual(Object.keys(RELATED_KINDS), ['client', 'project', 'task', 'deal', 'activity']);

console.log('ok - ask your notes: scopes, starters, citation links, history for follow-ups');
