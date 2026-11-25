// node client/src/pages/devicePreview/countriesModel.test.mjs
import assert from 'node:assert/strict';
import { samePlace, comparableRuns, parseSpokenAddress, formatMb, formatCost, estimateLine, captureLabel, gridOf, screensForRun, toggleId, DEFAULT_SCREEN_IDS } from './countriesModel.mjs';
import { deviceById } from '../../utils/deviceCatalog.mjs';

assert.equal(parseSpokenAddress('Example dot com slash Shop'), 'example.com/shop');
assert.equal(parseSpokenAddress('  '), null);

assert.equal(formatMb(2.5 * 1024 * 1024), '2.5 MB');
assert.equal(formatMb(30.5 * 1024 * 1024), '31 MB');
assert.equal(formatCost(30e6, 1.45), 'about A$0.04');
assert.equal(formatCost(1000, 1.45), 'about A$0.01', 'never "A$0.00"');
assert.equal(formatCost(30e6, null), '');

assert.equal(estimateLine({ countries: 6, screens: 2, bytesPerCountry: 4 * 1024 * 1024, costPerGb: 1.45 }), '6 countries x 2 screens = 12 pictures, about 24 MB, about A$0.04');
assert.equal(estimateLine({ countries: 1, screens: 1, bytesPerCountry: 1024 * 1024, costPerGb: null }), '1 country x 1 screen = 1 picture, about 1.0 MB');

assert.deepEqual(captureLabel({ status: 'ok', verified: true, exitCountry: 'AU' }), { text: 'Verified', tone: 'ok' });
assert.deepEqual(captureLabel({ status: 'ok', verified: false, exitCountry: 'US' }), { text: 'Unverified: exited from US', tone: 'warn' });
assert.deepEqual(captureLabel({ status: 'blocked', verified: false, exitCountry: null }), { text: 'Unverified: exit not confirmed', tone: 'warn' });
assert.equal(captureLabel({ status: 'failed' }).tone, 'bad');
assert.equal(captureLabel(null).text, 'Not captured');

const run = {
  settings: { countries: ['AU', 'DE'], screens: [{ id: 'p' }, { id: 'l' }] },
  captures: [{ id: 1, country: 'DE', deviceId: 'l' }, { id: 2, country: 'AU', deviceId: 'p' }],
};
const g = gridOf(run);
assert.deepEqual(g.rows.map((r) => [r.country, r.cells.map((c) => c && c.id)]), [['AU', [2, null]], ['DE', [null, 1]]]);
assert.deepEqual(gridOf(null).rows, []);

const devices = DEFAULT_SCREEN_IDS.map(deviceById);
assert.ok(devices.every(Boolean), 'default screens are in the catalogue');
assert.deepEqual(screensForRun(devices).map((s) => s.mobile), [true, false]);

assert.deepEqual(toggleId(['a'], 'b'), { list: ['a', 'b'], refused: false });
assert.deepEqual(toggleId(['a', 'b'], 'a'), { list: ['b'], refused: false });
assert.equal(toggleId(['a', 'b', 'c', 'd'], 'e').refused, true);

assert.equal(samePlace('https://www.shop.example/a/?x=1'), samePlace('http://shop.example/a'));
const rs = [{ id: 1, url: 'https://shop.example/', status: 'done' }, { id: 2, url: 'https://shop.example', status: 'running' }, { id: 3, url: 'https://other.example/', status: 'done' }, { id: 4, url: 'https://www.shop.example/', status: 'stopped' }];
assert.deepEqual(comparableRuns({ id: 1, url: 'https://shop.example/' }, rs).map((r) => r.id), [4]);
assert.deepEqual(comparableRuns(null, rs), []);

console.log('countriesModel tests passed');
