// node client/src/components/shares/watchlistReport.test.mjs
import assert from 'node:assert';
import * as r from './watchlistReport.mjs';

// fallback guard
const ok = { version: 1, centralQuestion: 'Q?', verdicts: { growth: { label: 'Fast' } } };
assert.ok(r.isUsableStructured(ok));
for (const bad of [null, undefined, 'x', {}, { ...ok, version: 2 }, { ...ok, centralQuestion: ' ' }, { ...ok, verdicts: {} }, { ...ok, verdicts: null }]) {
  assert.strictEqual(r.isUsableStructured(bad), false, JSON.stringify(bad));
}

// tones
assert.strictEqual(r.consensusTone('Buy'), 'gain');
assert.strictEqual(r.consensusTone('Sell'), 'loss');
assert.strictEqual(r.consensusTone('Hold'), 'neutral');
assert.strictEqual(r.consensusTone('Mixed'), 'warn');
assert.strictEqual(r.moatTone({ weak: 1, moderate: 5, strong: 0 }), 'warn', 'mostly moderate');
assert.strictEqual(r.moatTone({ weak: 0, moderate: 1, strong: 3 }), 'gain');
assert.strictEqual(r.moatTone({ weak: 2, moderate: 1, strong: 0 }), 'loss');
assert.strictEqual(r.moatTone({ weak: 1, moderate: 0, strong: 1 }), 'loss', 'tie goes to the weaker level');
assert.strictEqual(r.moatTone({ weak: 0, moderate: 0, strong: 0 }), 'neutral');
assert.strictEqual(r.labelTone('valuation', 'Priced for persistent high growth'), 'warn');
assert.strictEqual(r.labelTone('valuation', 'Trades at a discount to peers'), 'gain');
assert.strictEqual(r.labelTone('valuation', 'In line with peers'), 'neutral');
assert.strictEqual(r.labelTone('growth', 'Fast but decelerating'), 'warn');
assert.strictEqual(r.labelTone('growth', 'Strong'), 'gain');
assert.strictEqual(r.labelTone('growth', 'Shrinking'), 'loss');
for (const t of ['gain', 'loss', 'warn', 'neutral']) assert.ok(r.TONE_ICON[t] && r.TONE_COLOR[t], `tone ${t} has an icon and a colour`);

// maths
assert.ok(Math.abs(r.pctFrom(251.58, 217.2) - 15.8287) < 1e-3);
assert.ok(r.pctFrom(152, 217.2) < 0);
assert.strictEqual(r.pctFrom(100, 0), null);
assert.strictEqual(r.pctFrom(null, 100), null);
const pk = r.peakBar(217.2, 286.99);
assert.ok(Math.abs(pk.fillPct - 75.68) < 0.01 && Math.abs(pk.fromHighPct - -24.32) < 0.01);
assert.strictEqual(r.peakBar(300, 200).fillPct, 100, 'above the high is clamped to a full bar');
assert.strictEqual(r.peakBar(100, null), null);
assert.strictEqual(r.levelIndex('Strong'), 2);
assert.strictEqual(r.levelIndex('huge'), -1);

// competitors keep a fixed group order; same-group rows stay separate
const g = r.groupCompetitors([
  { group: 'competes by category', names: ['A'] }, { group: 'head to head', names: ['B'] }, { group: 'competes by category', names: ['C'] }, { group: 'x', names: ['D'] },
]);
assert.deepStrictEqual(g.map((x) => [x.key, x.rows.length]), [['head to head', 1], ['competes by category', 2]]);

// pills: only sections the report has and the page builds
const s = { centralQuestion: 'Q', moat: { factors: [{}] }, valuation: { targets: [] }, risks: [] };
assert.deepStrictEqual(r.sectionPills(s, 36, ['summary', 'moat']).map((p) => p.label), ['Summary', 'Moat', 'Sources (36)']);
assert.deepStrictEqual(r.sectionPills(s, 0).map((p) => p.id), ['summary', 'moat', 'valuation'], 'no risks, no sources');

console.log('watchlistReport tests passed');
