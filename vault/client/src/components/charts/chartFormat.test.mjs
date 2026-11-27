// node client/src/components/charts/chartFormat.test.mjs
import assert from 'node:assert/strict';
import { fmtPct, fmtAud, fmtPts, MINUS } from './chartFormat.mjs';

assert.equal(fmtPct(1.6), '+1.6%');
assert.equal(fmtPct(-0.84), `${MINUS}0.8%`);
assert.equal(fmtPct(0), '0.0%');
assert.equal(fmtPct(-0.01), '0.0%', 'rounds to zero: no sign');
assert.equal(fmtPct(2.345, 2), '+2.35%');
assert.equal(fmtPct('3'), '+3.0%');
for (const v of [null, undefined, '', 'abc', NaN]) assert.equal(fmtPct(v), '—');

assert.equal(fmtAud(578), '+A$578');
assert.equal(fmtAud(-1204.4), `${MINUS}A$1,204`);
assert.equal(fmtAud(1234567), '+A$1,234,567');
assert.equal(fmtAud(0), 'A$0');
assert.equal(fmtAud(12.5, { signed: false, digits: 2 }), 'A$12.50');
assert.equal(fmtAud(-3, { signed: false }), `${MINUS}A$3`, 'unsigned still shows a negative');
for (const v of [null, undefined]) assert.equal(fmtAud(v), '—');

assert.equal(fmtPts(0.5), 'beat by 0.5 pts');
assert.equal(fmtPts(-0.84), 'lagged by 0.8 pts');
assert.equal(fmtPts(0), 'level');
assert.equal(fmtPts(0.01), 'level');
assert.equal(fmtPts(null), '—');

console.log('chartFormat tests passed');
