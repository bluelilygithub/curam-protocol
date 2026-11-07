import assert from 'node:assert/strict';
import { positionText, changeText, periodLabel, movingAverage, chartDomain } from './keywordsHelpers.mjs';

assert.equal(positionText(4.256), '4.3');
assert.equal(positionText(null), '—');
assert.equal(positionText(undefined), '—');
assert.equal(positionText(NaN), '—');
assert.deepEqual(changeText(6), { text: '▲ 6.0', dir: 'up' }, 'a positive change moved up Google');
assert.deepEqual(changeText(-9.04), { text: '▼ 9.0', dir: 'down' });
assert.deepEqual(changeText(0.01), { text: '0.0', dir: 'none' });
assert.deepEqual(changeText(null), { text: '—', dir: 'none' }, 'no earlier figure is a dash, not zero');
assert.equal(periodLabel('all'), 'All history');
assert.equal(periodLabel('nonsense'), 'This period', 'an unknown value never throws');

const days = [
  { position: 10, impressions: 100 }, { position: null, impressions: 0 }, { position: 4, impressions: 100 }, { position: 20, impressions: 0 },
];
const avg = movingAverage(days, 3);
assert.equal(avg[0], 10);
assert.equal(avg[1], 10, 'a day with no position is skipped');
assert.equal(avg[2], 7, 'weighted by impressions: (10*100 + 4*100) / 200');
assert.equal(avg.length, days.length);
assert.deepEqual(movingAverage([{ position: null, impressions: 0 }], 7), [null]);
assert.equal(movingAverage([{ position: 3, impressions: 0 }], 7)[0], 3, 'a day with no impressions still counts a little, so it is not dropped');

assert.deepEqual(chartDomain([{ position: 6.4 }, { position: 9.9 }]), [5, 11]);
assert.deepEqual(chartDomain([{ position: 1.2 }]), [1, 3], 'never above position 1');
assert.deepEqual(chartDomain([]), [1, 10]);
assert.deepEqual(chartDomain([{ position: null }]), [1, 10]);
console.log('keywordsHelpers.test.mjs: all passed');
