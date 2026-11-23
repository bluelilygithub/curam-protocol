#!/usr/bin/env node
/**
 * Benchmark close rows: USD converted at the given rate, AUD stored as-is, undated or unpriced
 * quotes refused (never stored under a guessed day), missing FX leaves AUD null.
 *
 * Run: node server/services/sharesBenchmarks.test.js
 */
'use strict';

const assert = require('assert');
const { toCloseRow } = require('./sharesBenchmarks');

const QQQ = { symbol: 'QQQ', exchange: 'NASDAQ' };
const STW = { symbol: 'STW', exchange: 'ASX' };

const us = toCloseRow(QQQ, { current: 500, previousClose: 495, currency: 'USD', tradingDay: '2026-11-20' }, 1.5);
assert.deepStrictEqual(us, {
  symbol: 'QQQ', tradingDay: '2026-11-20', currency: 'USD',
  closeNative: 500, prevCloseNative: 495, usdAud: 1.5, closeAud: 750,
});

const au = toCloseRow(STW, { current: 72.1, previousClose: 71.9, currency: 'AUD', tradingDay: '2026-11-20' }, 1.5);
assert.strictEqual(au.closeAud, 72.1);
assert.strictEqual(au.usdAud, null);

const noFx = toCloseRow(QQQ, { current: 500, previousClose: 495, currency: 'USD', tradingDay: '2026-11-20' }, null);
assert.strictEqual(noFx.closeAud, null);
assert.strictEqual(noFx.closeNative, 500);

assert.strictEqual(toCloseRow(QQQ, { current: 500, currency: 'USD', tradingDay: null }, 1.5), null);
assert.strictEqual(toCloseRow(QQQ, { current: 0, currency: 'USD', tradingDay: '2026-11-20' }, 1.5), null);
assert.strictEqual(toCloseRow(QQQ, null, 1.5), null);

console.log('sharesBenchmarks.test.js: all passed');
