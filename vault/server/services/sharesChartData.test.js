#!/usr/bin/env node
/**
 * Range-driven chart helpers: period benchmark returns and per-holding period movers.
 *
 * Run: node server/services/sharesChartData.test.js
 */
'use strict';

const assert = require('assert');
const {
  buildBenchmarksPeriod, buildPeriodMovers, buildNormalizedPerformance,
  rangeKeyFrom, fyStartFor, buildRange, downsampleDaily, buildHoldingsValueSeries, observationFromRow,
} = require('./sharesChartData');

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

// ---- weekend repeats and the price-based holdings figures (fix 2026-11-28) ----

test('Sunday and Monday notes carry no new session and are not compounded (production: Sat, Sun, Mon all -2.5)', () => {
  // Notes run at 7 am Sydney after the US close: Fri 16 Oct = US Thu, Sat 17 = US Fri, Sun 18 and Mon 19 = no session, Tue 20 = US Mon.
  const history = [obs('2026-10-16', null, -0.13, null, null), obs('2026-10-17', null, -2.5, null, null),
    obs('2026-10-18', null, -2.5, null, null), obs('2026-10-19', null, -2.5, null, null), obs('2026-10-20', null, 1.21, null, null)];
  assert.strictEqual(buildNormalizedPerformance(history).at(-1).nasdaq, Math.round(100 * 0.9987 * 0.975 * 1.0121 * 100) / 100);
});

test('a Sunday note re-measured slightly differently is still skipped; Saturday counts', () => {
  const history = [obs('2026-11-07', null, 1.46, null, null), obs('2026-11-08', null, 1.4, null, null)];
  assert.strictEqual(buildNormalizedPerformance(history).at(-1).nasdaq, 101.46);
});

const snap = (symbol, priceAud, iso) => ({ symbol, priceAud, recordedAt: new Date(iso) });
const pos = [{ symbol: 'NVDA', quantity: 10, priceAud: 90 }, { symbol: 'CBA', quantity: 5, priceAud: 160 }];
const rows = [
  snap('NVDA', 999, '2026-10-12T01:00:00Z'), // before the window: ignored
  snap('NVDA', 100, '2026-10-13T00:00:00Z'), snap('NVDA', 104, '2026-10-13T05:00:00Z'),
  snap('CBA', 150, '2026-10-13T00:00:00Z'),
  snap('NVDA', 95, '2026-10-14T03:00:00Z'), // CBA has no price this day: carried forward
  snap('GONE', 50, '2026-10-14T03:00:00Z'), // sold: not held today, ignored
  snap('CBA', 0, '2026-10-15T03:00:00Z'), // a bad zero price is ignored
];

test("holdings series: today's units, first price in the window as the start, last price of each day, live price at the end", () => {
  const s = buildHoldingsValueSeries(rows, pos, '2026-10-13', 'UTC', '2026-10-16');
  assert.strictEqual(s.baseValue, 10 * 100 + 5 * 150);
  assert.deepStrictEqual(s.points.map((p) => [p.date, p.value]), [['2026-10-13', 1040 + 750], ['2026-10-14', 950 + 750], ['2026-10-16', 900 + 800]]);
  assert.strictEqual(s.liveValue, 1700);
  assert.strictEqual(s.changeAud, -50);
  assert.strictEqual(s.pct, Math.round((-50 / 1750) * 10000) / 100);
  assert.strictEqual(s.included, 2);
});

test('holdings series: dates follow the workspace time zone', () => {
  // 2026-10-13T14:00Z is the 14th in Sydney
  const s = buildHoldingsValueSeries([snap('NVDA', 100, '2026-10-13T14:00:00Z')], [{ symbol: 'NVDA', quantity: 1, priceAud: 100 }], '2026-10-14', 'Australia/Sydney', '2026-10-14');
  assert.strictEqual(s.from, '2026-10-14');
});

test('holdings series: no stored prices -> null; a holding with no price is left out and counted', () => {
  assert.strictEqual(buildHoldingsValueSeries([], pos, '2026-10-13', 'UTC', '2026-10-16'), null);
  const s = buildHoldingsValueSeries([snap('NVDA', 100, '2026-10-13T00:00:00Z')], pos, '2026-10-13', 'UTC', '2026-10-13');
  assert.deepStrictEqual([s.included, s.total], [1, 2]);
});

test("the tile's % and A$ are one calculation, and the chart line ends on the same %", () => {
  const history = [obs('2026-10-13', -0.19, 0.1, null, null), obs('2026-10-14', -2.45, 0.2, null, null), obs('2026-10-16', -1.42, 0.3, null, null)];
  const s = buildHoldingsValueSeries(rows, pos, history[0].date, 'UTC', '2026-10-16');
  const norm = buildNormalizedPerformance(history, s);
  const b = buildBenchmarksPeriod(norm, history, s);
  const own = b.items.find((i) => i.kind === 'portfolio');
  assert.strictEqual(own.pct, s.pct);
  assert.strictEqual(own.changeAud, s.changeAud);
  assert.ok(Math.abs(own.changeAud / s.baseValue * 100 - own.pct) < 0.01, 'A$ over the start value is the %');
  assert.ok(Math.abs(norm.at(-1).portfolio - 100 - own.pct) < 0.01, 'chart ends where the tile does');
  assert.ok(!('changeAudCoverage' in b), 'all holdings priced: no coverage note');
});

test('a note date from pg (a JS Date) becomes YYYY-MM-DD, so the weekend rule and the holdings series work', () => {
  // production bug: String(date).slice(0, 10) gave "Wed Oct 14"
  const row = observationFromRow({ date: new Date(2026, 9, 18), headlines: { portfolioMove: { changePct: -1.42 }, nasdaqPct: -1.42 } });
  assert.strictEqual(row.date, '2026-10-18');
  assert.strictEqual(observationFromRow({ date: '2026-10-18', headlines: '{}' }).date, '2026-10-18');
  const history = [observationFromRow({ date: new Date(2026, 9, 17), headlines: { nasdaqPct: -1.42 } }), row];
  assert.strictEqual(buildNormalizedPerformance(history).at(-1).nasdaq, 98.58, 'the Sunday note is skipped');
  const s = buildHoldingsValueSeries([snap('NVDA', 100, '2026-10-17T03:00:00Z')], [{ symbol: 'NVDA', quantity: 2, priceAud: 90 }], history[0].date, 'UTC', '2026-10-18');
  assert.strictEqual(s.pct, -10, 'the series finds its prices from a pg-style date');
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

// ── ranges: Today, 7d, 30d, 90d, 12 months, Financial year, All time ──────────────────────
test('range keys: the new ones are accepted, the old ?days= numbers still map, junk falls back to 30d', () => {
  for (const k of ['today', '7d', '30d', '90d', '12m', 'fy', 'all']) assert.strictEqual(rangeKeyFrom(k), k);
  assert.strictEqual(rangeKeyFrom('FY'), 'fy');
  assert.strictEqual(rangeKeyFrom(' 12M '), '12m');
  assert.deepStrictEqual([1, 7, 30, 90, '1', '90'].map(rangeKeyFrom), ['today', '7d', '30d', '90d', 'today', '90d']);
  for (const junk of [undefined, null, '', 'banana', 45, '365', '12']) assert.strictEqual(rangeKeyFrom(junk), '30d');
});

test('financial year starts 1 July: 30 Jun is still last year, 1 Jul begins the new one', () => {
  assert.strictEqual(fyStartFor('2026-06-30'), '2025-07-01');
  assert.strictEqual(fyStartFor('2026-07-01'), '2026-07-01');
  assert.strictEqual(fyStartFor('2026-10-02'), '2026-07-01');
  assert.strictEqual(fyStartFor('2027-01-15'), '2026-07-01');
  assert.strictEqual(fyStartFor('2026-01-01'), '2025-07-01');
});

test('financial-year range: window length counts both ends (1 Jul alone = 1 day; 2 Oct = 94)', () => {
  assert.strictEqual(buildRange('fy', { today: '2026-07-01' }).days, 1);
  const r = buildRange('fy', { today: '2026-10-02' });
  assert.strictEqual(r.days, 94);
  assert.strictEqual(r.fromDate, '2026-07-01');
  assert.strictEqual(r.phrase, 'the current financial year (since 1 Jul 2026)');
  assert.strictEqual(r.label, 'Financial year');
});

test('12 months = 365 days; fixed ranges carry their own length and wording', () => {
  assert.strictEqual(buildRange('12m', { today: '2026-10-02' }).days, 365);
  assert.strictEqual(buildRange('12m', { today: '2026-10-02' }).phrase, 'the last 12 months');
  assert.strictEqual(buildRange('90d', { today: '2026-10-02' }).days, 90);
  assert.strictEqual(buildRange('7d', { today: '2026-10-02' }).phrase, 'the last 7 days');
  assert.strictEqual(buildRange('today', { today: '2026-10-02' }).days, 1);
});

test('all time reaches back to the first snapshot, and says when that was', () => {
  const r = buildRange('all', { today: '2026-10-02', firstSnapshotAt: '2026-05-18T08:45:02Z' });
  assert.strictEqual(r.key, 'all');
  assert.strictEqual(r.fromDate, '2026-05-18');
  assert.strictEqual(r.phrase, 'all recorded history (since 18 May 2026)');
  const expectedDays = Math.ceil((Date.now() - Date.parse('2026-05-18T08:45:02Z')) / 86400000);
  assert.ok(Math.abs(r.days - expectedDays) <= 1);
});

test('all time with nothing recorded yet does not crash', () => {
  const r = buildRange('all', { today: '2026-10-02', firstSnapshotAt: null });
  assert.strictEqual(r.days, 1);
  assert.strictEqual(r.fromDate, null);
  assert.strictEqual(r.phrase, 'all recorded history');
});

test('downsampleDaily keeps the LAST point of each day, in order', () => {
  const pts = [
    { recordedAt: '2026-09-01T01:00:00Z', priceAud: 1 }, { recordedAt: '2026-09-01T09:00:00Z', priceAud: 2 },
    { recordedAt: '2026-09-02T03:00:00Z', priceAud: 3 }, { recordedAt: '2026-09-01T20:00:00Z', priceAud: 9 },
  ];
  // input order is what the database returns (ascending); the 20:00 row arriving late still lands on 1 Sep
  const out = downsampleDaily(pts.slice(0, 3));
  assert.deepStrictEqual(out.map((p) => p.priceAud), [2, 3]);
});

test('period movers are sorted by size of move', () => {
  const m = buildPeriodMovers(holdings, trailing, bench);
  assert.deepStrictEqual(m.map((x) => x.symbol), ['TSM', 'GOOG']);
});

console.log(`\n${n} tests passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
