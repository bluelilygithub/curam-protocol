import assert from 'node:assert';
import { dueLabel, directionLabel, statusLabel, tabHint } from './labels.mjs';

assert.strictEqual(dueLabel({ status: 'exact', date: '2026-10-23' }), 'due 2026-10-23');
// a deadline the tool could not work out never shows a made-up date, and says what is missing and what was said
const vague = dueLabel({ status: 'needs_review', date: null, raw: 'early next week', missing: ['a stated date'] });
assert.ok(vague.includes('needs you') && vague.includes('a stated date') && vague.includes('"early next week"'));
assert.ok(!/\d{4}-\d{2}-\d{2}/.test(vague));
assert.strictEqual(dueLabel(null), 'no deadline given');
assert.strictEqual(directionLabel({ direction: 'i_owe' }), 'You owe this');
assert.strictEqual(directionLabel({ direction: 'they_owe' }), 'They owe you');
assert.ok(statusLabel('unverified').includes('still open'));
assert.ok(statusLabel('suspended').includes('someone else'));
for (const id of ['ledger', 'mail', 'drafts', 'coverage']) assert.ok(tabHint(id).length > 10, `tab hint for ${id}`);
console.log('email-follow-up labels: passed');
