// node client/src/pages/contractReview/verdict.test.mjs   (Risk review's verdict). No npm script, to keep package.json unchanged.
import assert from 'node:assert';
import { reviewVerdict } from './verdict.mjs';

const c = (riskLevel, extra = {}) => ({ riskLevel, verificationStatus: 'verified_exact', ...extra });

let v = reviewVerdict({ clauses: [c('risky'), c('risky', { verificationStatus: 'failed' }), c('unclear'), c('standard'), c('risky', { isContextOnly: true })], partyName: 'Acme' });
assert.strictEqual(v.level, 'risky');
assert.strictEqual(v.title, 'Read before you sign');
assert.strictEqual(v.sentence, '2 clauses are risky for Acme, and 1 is unclear. Start with the risky ones.');
assert.deepStrictEqual(v.counts, { risky: 2, unclear: 1, standard: 1 }, 'context-only clauses are not counted');
assert.deepStrictEqual(v.notes.map((n) => n.id), ['unverified']);

v = reviewVerdict({ clauses: [c('risky')] });
assert.strictEqual(v.sentence, '1 clause is risky for your side. Start with the risky ones.');

v = reviewVerdict({ clauses: [c('unclear'), c('unclear'), c('standard')], partyName: 'Tenant Co' });
assert.strictEqual(v.level, 'unclear');
assert.strictEqual(v.sentence, 'No clause was flagged risky for Tenant Co, but 2 clauses need a closer look.');

v = reviewVerdict({
  clauses: [c('standard')],
  obligations: [{ derivedStatus: 'overdue' }, { derivedStatus: 'overdue', userState: 'handled' }, { derivedStatus: 'upcoming' }],
  coverageReport: [{ clauseType: 'limitation_of_liability', status: 'not_found' }, { clauseType: 'termination', status: 'found' }],
});
assert.strictEqual(v.level, 'clear');
assert.ok(!/safe/i.test(v.title + v.sentence), 'never says safe');
assert.deepStrictEqual([v.overdue, v.upcoming], [1, 1], 'a handled obligation is not overdue');
assert.deepStrictEqual(v.notes.map((n) => n.text), ['1 obligation is overdue.', 'Usual clause not found: limitation of liability.']);

assert.strictEqual(reviewVerdict().level, 'clear', 'an empty review does not throw');
console.log('contract review verdict tests passed');
