#!/usr/bin/env node
/**
 * Range-driven chart helpers: period benchmark returns and per-holding period movers.
 *
 * Run: node server/services/sharesChartData.test.js
 */
'use strict';

const assert = require('assert');
const { buildBenchmarksPeriod, buildPeriodMovers, buildNormalizedPerformance } = require('./sharesChartData');

let n = 0;
function test(name, fn) {
  try { fn(); n += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

const obs = (date, portfolio, nasdaq, sox, asx) => ({
  date, portfolioChangePct: portfolio, nasdaqPct: nasdaq, soxPct: sox, asxPct: asx,
});

test('period return compounds the daily moves (1% then 2% = 3.02%, not 3%)', () => {
  const history = [obs('2026-09-01', 1, 1, null, null), obs('2026-09-02', 2, 2, null, null)];
  const b = buildBenchmarksPeriod(buildNormalizedPerformance(history), history);
  assert.strictEqual(b.available, true);
  const port = b.items.find((i) => i.kind === 'portfolio');
  assert.strictEqual(port.pct, 3.02);
  assert.strictEqual(b.items.find((i) => i.kind === 'nasdaq').pct, 3.02);
  assert.strictEqual(b.observationCount, 2);
  assert.strictEqual(b.from, '2026-09-01');
  assert.strictEqual(b.to, '2026-09-02');
});

test('an index with no recorded moves is omitted, never shown as 0%', () => {
  const history = [obs('2026-09-01', 1, 1, null, null), obs('2026-09-02', 1, 1, null, null)];
  const kinds = buildBenchmarksPeriod(buildNormalizedPerformance(history), history).items.map((i) => i.kind);
  assert.deepStrictEqual(kinds, ['portfolio', 'nasdaq']); // no sox, no asx
});

test('a negative period is reported as negative', () => {
  const history = [obs('2026-09-01', -2, -1, -3, -1), obs('2026-09-02', -3, -1, -3, -1)];
  const b = buildBenchmarksPeriod(buildNormalizedPerformance(history), history);
  assert.strictEqual(b.items.find((i) => i.kind === 'portfolio').pct, -4.94); // 0.98 * 0.97 = 0.9506
});

test('no observations -> not available, empty items', () => {
  const b = buildBenchmarksPeriod([], []);
  assert.strictEqual(b.available, false);
  assert.deepStrictEqual(b.items, []);
});

const holdings = [
  { key: 'TSM:NYSE', symbol: 'TSM', exchange: 'NYSE', sectorBenchmark: 'SOX', sectorBenchmarkKey: 'sox' },
  { key: 'GOOG:NASDAQ', symbol: 'GOOG', exchange: 'NASDAQ', sectorBenchmark: 'Nasdaq', sectorBenchmarkKey: 'nasdaq' },
  { key: 'CBA:ASX', symbol: 'CBA', exchange: 'ASX', sectorBenchmark: 'ASX 200', sectorBenchmarkKey: 'asx' },
];
const trailing = [
  { key: 'TSM:NYSE', dataAvailable: true, trailingPct: 12 },
  { key: 'GOOG:NASDAQ', dataAvailable: true, trailingPct: -3 },
  { key: 'CBA:ASX', dataAvailable: false },
];
const bench = { items: [{ kind: 'sox', pct: 5 }, { kind: 'nasdaq', pct: -3.1 }] };

test('period movers compare each holding with its own sector index over the range', () => {
  const m = buildPeriodMovers(holdings, trailing, bench);
  const tsm = m.find((x) => x.symbol === 'TSM');
  assert.strictEqual(tsm.periodChangePct, 12);
  assert.strictEqual(tsm.sectorBenchmarkPct, 5);
  assert.strictEqual(tsm.vsSectorPct, 7);
  assert.strictEqual(tsm.relativeToSector, 'beat');
});

test('within 0.25pp of the index counts as matched; below it as lagged', () => {
  const m = buildPeriodMovers(holdings, trailing, bench);
  assert.strictEqual(m.find((x) => x.symbol === 'GOOG').relativeToSector, 'matched'); // -3 vs -3.1 = +0.1pp
  const lag = buildPeriodMovers(holdings, [{ key: 'TSM:NYSE', dataAvailable: true, trailingPct: 1 }], bench);
  assert.strictEqual(lag[0].relativeToSector, 'lagged');
});

test('a holding with no snapshot in the window is left out; no benchmark -> "unknown", not beat/lag', () => {
  const m = buildPeriodMovers(holdings, trailing, { items: [] });
  assert.ok(!m.some((x) => x.symbol === 'CBA'));
  assert.ok(m.every((x) => x.relativeToSector === 'unknown' && x.vsSectorPct === null));
});

test('period movers carry the dollar move through unchanged (and null when unavailable)', () => {
  const withDollars = [
    { key: 'TSM:NYSE', dataAvailable: true, trailingPct: 12, changeAud: 480.25 },
    { key: 'GOOG:NASDAQ', dataAvailable: true, trailingPct: -3 }, // no changeAud supplied
  ];
  const m = buildPeriodMovers(holdings, withDollars, bench);
  assert.strictEqual(m.find((x) => x.symbol === 'TSM').changeAud, 480.25);
  assert.strictEqual(m.find((x) => x.symbol === 'GOOG').changeAud, null);
});

test('period movers are sorted by size of move', () => {
  const m = buildPeriodMovers(holdings, trailing, bench);
  assert.deepStrictEqual(m.map((x) => x.symbol), ['TSM', 'GOOG']);
});

console.log(`\n${n} tests passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
