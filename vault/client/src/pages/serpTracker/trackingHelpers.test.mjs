import assert from 'node:assert/strict';
import { trackingEstimate, trackingWarning, rankText, rankChange, readsLine } from './trackingHelpers.mjs';

const pricing = { queuedPerTenResultsUsd: 0.0006, trackDepthCap: 30, maxTrackReads: 3 };

assert.equal(trackingEstimate({ keywords: 5, devices: 2, depth: 100 }, null), null, 'no prices yet: no estimate');
assert.equal(trackingEstimate({ keywords: 0, devices: 2, depth: 30 }, pricing), null, 'nothing to track');
assert.equal(trackingEstimate({ keywords: 3, devices: 0, depth: 30 }, pricing), null);

// 20 keywords x 2 devices, depth 100 is capped at 30 = 3 pages: 20 x 2 x 3 x 0.0006 = 0.072 a day, x3 reads worst case
const e = trackingEstimate({ keywords: 20, devices: 2, depth: 100 }, pricing);
assert.equal(e.searches, 40);
assert.equal(e.pages, 3, 'depth is capped at the top 30');
assert.ok(Math.abs(e.perDayLow - 0.072) < 1e-9);
assert.ok(Math.abs(e.perDayHigh - 0.216) < 1e-9);
assert.ok(Math.abs(e.perMonthLow - 2.16) < 1e-9);
assert.ok(Math.abs(e.perMonthHigh - 6.48) < 1e-9);
assert.match(e.text, /40 searches a day \(20 keywords x 2 devices, top 30\)/);
assert.match(e.text, /about US\$0\.072 a day, US\$2\.16 a month/);
assert.match(e.text, /up to 3 reads.*about US\$0\.22 a day, US\$6\.48 a month/);
const one = trackingEstimate({ keywords: 1, devices: 1, depth: 10 }, pricing);
assert.match(one.text, /^1 search a day \(1 keyword x 1 device, top 10\)/, 'singular words');
assert.equal(trackingEstimate({ keywords: 2, devices: 1, depth: 20 }, pricing).pages, 2);

// the warning: only when the worst case passes the shared monthly limit
assert.match(trackingWarning(e, 5), /worst case \(US\$6\.48 a month\) is more than the monthly limit of US\$5\.00/);
assert.equal(trackingWarning(e, 10), '');
assert.equal(trackingWarning(null, 5), '');
assert.equal(trackingWarning(e, 0), '');

assert.equal(rankText({ status: 'found', position: 5, depth: 30 }), '#5');
assert.equal(rankText({ status: 'not_found', position: null, depth: 30 }), 'Not in top 30');
assert.equal(rankText({ status: 'failed', position: null, depth: 30 }), 'Failed');
assert.equal(rankText(null), '—');

assert.equal(rankChange({ status: 'found', position: 5 }, { status: 'found', position: 8 }), 3, 'moved up three places');
assert.equal(rankChange({ status: 'found', position: 9 }, { status: 'found', position: 4 }), -5);
assert.equal(rankChange({ status: 'not_found', position: null }, { status: 'found', position: 4 }), null, 'only between two found results');
assert.equal(rankChange({ status: 'found', position: 4 }, null), null);

assert.equal(readsLine([]), '');
assert.equal(readsLine([{ position: 3 }]), '1 read');
assert.equal(readsLine([{ position: null }]), '1 read, not found');
assert.equal(readsLine([{ position: null }, { position: 5 }]), 'Found on 1 of 2 reads');
assert.equal(readsLine([{ position: null }, { position: null }, { position: null }]), 'Not found on any of 3 reads');

console.log('trackingHelpers.test.mjs: all passed');
