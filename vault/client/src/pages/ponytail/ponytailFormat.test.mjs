// node client/src/pages/ponytail/ponytailFormat.test.mjs
import assert from 'assert';
import { money, compact, minutes, pct, totalTokens, testsShare, brisbaneDay, addDays, fillDays, shortDay, brisbaneTime } from './ponytailFormat.mjs';

assert.strictEqual(money(1.5), '$1.50');
assert.strictEqual(money(null), '–');
assert.strictEqual(compact(999), '999');
assert.strictEqual(compact(1234), '1.2K');
assert.strictEqual(compact(3400000), '3.4M');
assert.strictEqual(minutes(90000), '1.5 min');
assert.strictEqual(pct(null), '–');
assert.strictEqual(pct(49.6), '50%');
assert.strictEqual(totalTokens({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }), 10);
assert.strictEqual(testsShare(3, 4), 75);
assert.strictEqual(testsShare(0, 0), null);
assert.strictEqual(brisbaneDay(new Date('2026-11-18T23:30:00Z')), '2026-11-19', 'Brisbane is a day ahead late in UTC');
assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
assert.strictEqual(addDays('2026-03-01', -1), '2026-02-28');
const filled = fillDays([{ day: '2026-11-18', cost: 2 }], '2026-11-17', '2026-11-19');
assert.deepStrictEqual(filled.map((d) => [d.day, d.cost]), [['2026-11-17', 0], ['2026-11-18', 2], ['2026-11-19', 0]]);
assert.strictEqual(shortDay('2026-11-19'), '19 Nov');
assert.strictEqual(brisbaneTime('2026-11-18T23:30:00Z'), '19 Nov 2026, 09:30');
assert.strictEqual(brisbaneTime(null), '–');
console.log('ponytailFormat tests passed');
