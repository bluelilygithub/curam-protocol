import assert from 'node:assert/strict';
import { parseClock, formatClock } from './clock.mjs';

assert.equal(parseClock('90'), 90);
assert.equal(parseClock('90s'), 90);
assert.equal(parseClock('2.5'), 2.5);
assert.equal(parseClock('1:30'), 90);
assert.equal(parseClock('02:36'), 156);
assert.equal(parseClock('1:30.5'), 90.5);
assert.equal(parseClock('1:02:03'), 3723);
assert.equal(parseClock('1m30'), 90);
assert.equal(parseClock('1 min 30 s'), 90);
assert.equal(parseClock('2 minutes'), 120);
assert.equal(parseClock('1h 5m'), 3900);
assert.equal(parseClock(''), null);
assert.equal(parseClock('abc'), null);
assert.equal(parseClock(null), null);

assert.equal(formatClock(0), '0:00');
assert.equal(formatClock(156), '2:36');
assert.equal(formatClock(156.5), '2:36.5');
assert.equal(formatClock(3723), '1:02:03');
assert.equal(formatClock(-4), '0:00');
// what is shown can always be read back
for (const v of [0, 5, 59.9, 60, 156, 277.3, 3723]) assert.ok(Math.abs(parseClock(formatClock(v)) - v) < 0.06, String(v));

console.log('clock tests passed');
