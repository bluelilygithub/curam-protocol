'use strict';

// node server/services/sharesSignalScorecard.test.js   No database is needed (pure functions only).

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@127.0.0.1:1/x';
const assert = require('assert');
const sc = require('./sharesSignalScorecard');

// ---- which verdicts are calls ----
assert.strictEqual(sc.thesisCall('intact'), 'intact');
for (const v of ['weakening', 'impaired', 'broken', 'red-line']) assert.strictEqual(sc.thesisCall(v), 'concern');
assert.strictEqual(sc.thesisCall('unclear'), null, 'not enough evidence is not a call');

// ---- right or wrong, against the index when there is one ----
assert.strictEqual(sc.judge('bullish', 0.05, 0.02), true, 'beat the index');
assert.strictEqual(sc.judge('bullish', 0.05, 0.08), false, 'rose but lagged the index: wrong');
assert.strictEqual(sc.judge('bearish', 0.05, 0.08), true, 'lagged the index: a bearish call was right');
assert.strictEqual(sc.judge('concern', -0.1, null), true, 'no index: plain return');
assert.strictEqual(sc.judge('intact', -0.1, null), false);
assert.strictEqual(sc.judge('watch', 0.1, 0), null, 'no direction, no verdict');
assert.strictEqual(sc.judge('bullish', null, 0.1), null);

// ---- summary ----
const row = (o) => ({ source: 'briefing', call: 'bullish', s30: 'scored', s90: 'pending', ret30: null, bench30: null, ret90: null, bench90: null, ...o });
const card = sc.summarise([
  row({ ret30: '0.10', bench30: '0.02' }),                       // right, edge +8%
  row({ ret30: '0.01', bench30: '0.05' }),                       // wrong, edge -4%
  row({ s30: 'pending' }),                                       // waiting
  row({ s30: 'no-price' }),                                      // sold before the mark: not counted
  row({ source: 'thesis', call: 'concern', ret30: '-0.2', bench30: null, s90: 'scored', ret90: '-0.3', bench90: '-0.1' }),
]);
const bull = card.groups.find((g) => g.call === 'bullish');
assert.strictEqual(bull.total, 4);
assert.deepStrictEqual([bull.h30.n, bull.h30.hits], [2, 1]);
assert.strictEqual(bull.h30.hitRate, 0.5);
assert.ok(Math.abs(bull.h30.avgEdgePct - 2) < 1e-9, 'average edge (+8 and -4) is +2%');
assert.strictEqual(bull.h90.n, 0);
assert.strictEqual(card.pending, 1);
const concern = card.groups.find((g) => g.call === 'concern');
assert.deepStrictEqual([concern.h30.hits, concern.h90.hits], [1, 1]);
assert.strictEqual(concern.label, 'Thesis check: concern');
assert.deepStrictEqual(sc.summarise([]), { groups: [], pending: 0, total: 0 });

// ---- the block the thesis check sees ----
const block = sc.formatTrackRecord(card, sc.summarise([]), 'NVDA');
assert.match(block, /calibration, not evidence/);
assert.match(block, /For NVDA:\n {2}\(nothing scored yet\)/);
assert.match(block, /News signal: bullish: 30d: 1\/2 right \(50%\), avg \+2\.0% vs index; 90d: none scored/);

console.log('sharesSignalScorecard.test.js: all passed');
process.exit(0);
