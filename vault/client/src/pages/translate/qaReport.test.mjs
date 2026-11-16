// node client/src/pages/translate/qaReport.test.mjs
import assert from 'node:assert';

// qaReport.js pulls in nothing from the browser except through functions this test does not call.
const { resultVerdict, isStalled } = await import('./qaReport.js');

assert.strictEqual(resultVerdict(null).level, 'none');
assert.strictEqual(resultVerdict({ hardFail: true, polarityOrSentenceTypeIssues: [{}] }).level, 'problem');
assert.strictEqual(resultVerdict({ polarityOrSentenceTypeIssues: [{}] }).level, 'check');
assert.strictEqual(resultVerdict({ softFail: true }).level, 'check');
// Rows the completeness check itself adds (routine numbers and codes) are not a defect...
assert.strictEqual(resultVerdict({ garbledOrIncompleteRows: [{ check: 'deterministic_completeness' }] }).level, 'ok');
// ...rows the second model adds are.
assert.strictEqual(resultVerdict({ garbledOrIncompleteRows: [{ source: 'x' }] }).level, 'check');
assert.strictEqual(resultVerdict({ uncertainTerms: [{}] }).level, 'look');
assert.strictEqual(resultVerdict({ uncertainTerms: [{}], polarityOrSentenceTypeIssues: [{}] }).level, 'check', 'the worse kind wins');
assert.strictEqual(resultVerdict({ skipped: true }).level, 'none');
assert.strictEqual(resultVerdict({ skipped: true, uncertainTerms: [{}] }).level, 'look');
assert.strictEqual(resultVerdict({ uncertainTerms: [] }).level, 'ok');
// The count of items never changes the verdict (it jitters between runs of the same document).
assert.strictEqual(resultVerdict({ uncertainTerms: Array(40).fill({}) }).label, resultVerdict({ uncertainTerms: [{}] }).label);
assert.match(resultVerdict({}).detail, /not proof/);

const now = Date.parse('2026-11-17T12:00:00Z');
const at = (mins) => new Date(now - mins * 60000).toISOString();
assert.strictEqual(isStalled({ id: 1, status: 'translating', createdAt: at(45) }, null, now), true);
assert.strictEqual(isStalled({ id: 1, status: 'translating', createdAt: at(45) }, 1, now), false, 'the job running in this page is not stalled');
assert.strictEqual(isStalled({ id: 1, status: 'translating', createdAt: at(5) }, null, now), false, 'a young job may be running in another tab');
assert.strictEqual(isStalled({ id: 1, status: 'done', createdAt: at(500) }, null, now), false);
assert.strictEqual(isStalled({ id: 1, status: 'generating', createdAt: at(31) }, null, now), true);

console.log('qaReport tests passed');
