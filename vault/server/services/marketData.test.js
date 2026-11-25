'use strict';

// node server/services/marketData.test.js   No network: tests the Finnhub fundamentals parser only.

const assert = require('assert');
const { parseFinnhubMetrics } = require('./marketData');

const parsed = parseFinnhubMetrics({
  metric: {
    peBasicExclExtraTTM: 34.2,        // fallback key used when peTTM is absent
    grossMarginTTM: 69.4,
    revenueGrowthQuarterlyYoy: '15.3', // numeric strings accepted
    roeTTM: null,                      // missing: skipped
    'totalDebt/totalEquityQuarterly': 0.29,
    marketCapitalization: 3100000,
  },
  series: {
    quarterly: {
      grossMargin: [
        { period: '2026-09-30', v: 0.695 }, { period: '2026-06-30', v: 0.688 },
        { period: '2026-03-31', v: 0.70 }, { period: '2025-12-31', v: 0.69 }, { period: '2025-09-30', v: 0.68 },
      ],
      operatingMargin: [{ period: '2026-09-30', v: 'x' }], // unreadable: dropped
    },
  },
});
const by = Object.fromEntries(parsed.figures.map((f) => [f.label, f]));
assert.strictEqual(by['P/E (TTM)'].value, 34.2, 'falls back to the next key');
assert.strictEqual(by['Revenue growth, latest quarter YoY'].value, 15.3);
assert.ok(!by['Return on equity (TTM)'], 'null value is skipped, never shown as 0');
assert.strictEqual(by['Debt/equity'].unit, 'x');
assert.strictEqual(parsed.trends.length, 1, 'a series with no readable points is dropped');
assert.strictEqual(parsed.trends[0].points.length, 4, 'last four quarters only');
assert.ok(Math.abs(parsed.trends[0].points[0].pct - 69.5) < 1e-9, 'series fractions shown as percentages');
assert.deepStrictEqual(parseFinnhubMetrics(null), { figures: [], trends: [] });
assert.deepStrictEqual(parseFinnhubMetrics({ error: 'limit' }), { figures: [], trends: [] });

console.log('marketData.test.js: all passed');
