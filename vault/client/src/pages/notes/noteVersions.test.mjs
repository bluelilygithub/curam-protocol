// node client/src/pages/notes/noteVersions.test.mjs   (part of npm run test:notes)
import assert from 'node:assert';
import { describeWhen, describeReason, describeSize, describeLength } from './noteVersions.mjs';

const now = new Date(2026, 9, 24, 15, 0);
assert.strictEqual(describeWhen(new Date(2026, 9, 24, 14, 35), now), 'Today, 2:35 pm');
assert.strictEqual(describeWhen(new Date(2026, 9, 24, 0, 5), now), 'Today, 12:05 am');
assert.strictEqual(describeWhen(new Date(2026, 9, 23, 9, 10), now), 'Yesterday, 9:10 am');
assert.strictEqual(describeWhen(new Date(2026, 9, 21, 16, 5), now), 'Wed 21 Oct, 4:05 pm');
assert.strictEqual(describeWhen(new Date(2025, 11, 31, 12, 0), now), 'Wed 31 Dec 2025, 12:00 pm', 'the year when it is not this year');
assert.strictEqual(describeWhen('not a date', now), '');
assert.strictEqual(describeReason('ai'), 'Before an AI change');
assert.strictEqual(describeReason('restore'), 'Before a restore');
assert.strictEqual(describeReason('edit'), '');
assert.strictEqual(describeSize(1052), '1,052 characters');
assert.strictEqual(describeSize(1), '1 character');
assert.strictEqual(describeSize(undefined), '0 characters');
assert.strictEqual(describeLength(1000, 1000), 'same length as now');
assert.strictEqual(describeLength(1000, 600), '400 more than now');
assert.strictEqual(describeLength(600, 1000), '400 fewer than now');

console.log('ok - earlier versions wording: when, why, how long');
