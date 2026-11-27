// node client/src/components/charts/chartMath.test.mjs
import assert from 'node:assert/strict';
import { maxAbsOf, positionPct, divergingBar, thresholdStatus, thresholdBar, changeOverRange, cardsForRange, heatCell, weekStart, priceAxisDomain, axisPct, stackLanes } from './chartMath.mjs';

// ---- zero-centred bars ----
assert.equal(maxAbsOf([2, -5, null, 'x']), 5);
assert.equal(maxAbsOf([0.2, -0.1]), 1, 'never below the floor');
assert.deepEqual(divergingBar(5, 10), { left: 50, width: 25 });
assert.deepEqual(divergingBar(-5, 10), { left: 25, width: 25 });
assert.deepEqual(divergingBar(-40, 10), { left: 0, width: 50 }, 'clamped to the track');
assert.deepEqual(divergingBar(0, 10), { left: 50, width: 0 });
assert.deepEqual(divergingBar(null, 10), { left: 50, width: 0 });
assert.deepEqual(divergingBar(0.01, 10), { left: 50, width: 1 }, 'a tiny move still shows');
// the index tick
assert.equal(positionPct(0, 10), 50);
assert.equal(positionPct(5, 10), 75);
assert.equal(positionPct(-10, 10), 0);
assert.equal(positionPct(99, 10), 100, 'tick clamped');
assert.equal(positionPct(null, 10), 50);

// ---- thresholds: 10% trigger ----
assert.equal(thresholdStatus(10, 10, 2), 'past', 'exactly at the trigger is past');
assert.equal(thresholdStatus(8, 10, 2), 'near', 'exactly at the near line (2 pts) is near');
assert.equal(thresholdStatus(7.99, 10, 2), 'within');
assert.equal(thresholdStatus(9, 10, 1), 'near', 'the server margin is 1 pt (portfolioAlerts.js)');
assert.equal(thresholdStatus(8, 10, 1), 'within');
assert.equal(thresholdStatus(null, 10, 1), 'within');
const t = thresholdBar(5, 10, 0);
assert.equal(t.triggerAt.toFixed(2), '66.67', 'the scale reaches past the trigger');
assert.equal(t.width.toFixed(2), '33.33');
assert.equal(thresholdBar(40, 10, 20).width, 100, 'clamped');
assert.equal(thresholdBar(-3, 10, 0).width, 0, 'a rise above the peak is no bar');

// ---- change over range ----
assert.equal(changeOverRange([], 'v'), null);
assert.equal(changeOverRange([{ v: 5 }], 'v'), null);
assert.equal(changeOverRange(null, 'v'), null);
assert.deepEqual(changeOverRange([{ v: 100 }, { v: null }, { v: 90 }, { v: 110 }], 'v'), { first: 100, last: 110, change: 10, pct: 10 });
assert.equal(changeOverRange([{ v: 0 }, { v: 5 }], 'v').pct, null, 'no % from zero');

// ---- which cards a range shows ----
assert.equal(cardsForRange('today').trailingReturn, true);
for (const r of ['7d', '30d', '90d', '12m', 'fy', 'all']) assert.equal(cardsForRange(r).trailingReturn, false, r);

// ---- heatmap scale ----
assert.deepEqual(heatCell(0), { tone: 'flat', strength: 0, strong: false });
assert.deepEqual(heatCell(null), { tone: 'flat', strength: 0, strong: false });
assert.deepEqual(heatCell(3), { tone: 'gain', strength: 85, strong: true });
assert.deepEqual(heatCell(-9), { tone: 'loss', strength: 85, strong: true }, 'capped');
assert.equal(heatCell(0.3).strong, false);
assert.ok(heatCell(-1).strength < heatCell(-2).strength, 'bigger moves are stronger');

// ---- week grouping (Monday start) ----
assert.equal(weekStart('2026-11-30'), '2026-11-30', 'a Monday is its own week');
assert.equal(weekStart('2026-12-06'), '2026-11-30', 'Sunday belongs to the week before');
assert.equal(weekStart('2026-12-03'), '2026-11-30');
assert.equal(weekStart('nonsense'), null);


// price axis (watchlist valuation): every value and the reference inside, padded, never below zero
{
  const d = priceAxisDomain([152, 251.58, 460], 217.2);
  assert.ok(d.min < 152 && d.max > 460, 'padded around the extremes');
  assert.ok(Math.abs(d.min - (152 - 308 * 0.08)) < 1e-9 && Math.abs(d.max - (460 + 308 * 0.08)) < 1e-9);
  assert.ok(axisPct(152, d) > 0 && axisPct(460, d) < 100);
  assert.ok(axisPct(217.2, d) > axisPct(152, d) && axisPct(217.2, d) < axisPct(251.58, d), 'order kept');
  assert.strictEqual(axisPct(9999, d), 100, 'clamped');
  assert.strictEqual(priceAxisDomain([], null), null);
  assert.strictEqual(priceAxisDomain([0, -5], null), null, 'non-positive prices ignored');
  const flat = priceAxisDomain([100], 100);
  assert.ok(flat.min < 100 && flat.max > 100, 'a single price still gets a visible range');
  assert.strictEqual(priceAxisDomain([1, 2], 1.5, 5).min, 0, 'never below zero');
  assert.strictEqual(axisPct(5, { min: 1, max: 1 }), 50);
}

// marker lanes: close markers move to the next lane, input order kept
assert.deepStrictEqual(stackLanes([10, 50, 51, 52, 90], 4), [0, 0, 1, 2, 0]);
assert.deepStrictEqual(stackLanes([52, 50, 10], 4), [1, 0, 0], 'order of input kept');
assert.deepStrictEqual(stackLanes([20, 24, 28], 4), [0, 0, 0], 'exactly minGap apart share a lane');
assert.deepStrictEqual(stackLanes([], 4), []);

console.log('chartMath tests passed');
