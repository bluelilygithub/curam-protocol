import assert from 'node:assert/strict';
import { DEVICE_CATALOG, devicesOfKind, deviceById, screenFor, customScreen, fitScale, CUSTOM_LIMITS } from './deviceCatalog.mjs';

// every entry is complete, unique, portrait and within sensible limits
assert.equal(new Set(DEVICE_CATALOG.map((d) => d.id)).size, DEVICE_CATALOG.length, 'ids are unique');
for (const d of DEVICE_CATALOG) {
  assert.ok(d.id && d.label && ['phone', 'tablet', 'desktop'].includes(d.kind), `${d.id} is complete`);
  assert.ok(d.width >= CUSTOM_LIMITS.min && d.height >= CUSTOM_LIMITS.min && d.width <= CUSTOM_LIMITS.max && d.height <= CUSTOM_LIMITS.max, `${d.id} size is in range`);
  if (d.kind !== 'desktop') assert.ok(d.height > d.width, `${d.id} is listed upright`);
  else assert.ok(d.width > d.height, `${d.id} is listed wide`);
}
assert.ok(devicesOfKind('phone').length >= 8 && devicesOfKind('tablet').length >= 5 && devicesOfKind('desktop').length >= 2);
assert.equal(deviceById('iphone-14').width, 390);
assert.equal(deviceById('nope'), null);

assert.deepEqual(screenFor(deviceById('iphone-14')), { width: 390, height: 844 });
assert.deepEqual(screenFor(deviceById('iphone-14'), 'landscape'), { width: 844, height: 390 });
assert.equal(screenFor(null), null);

assert.deepEqual(customScreen('500', '900'), { id: 'custom', label: 'Custom 500 x 900', kind: 'custom', width: 500, height: 900 });
assert.equal(customScreen('', '900'), null);
assert.equal(customScreen('abc', '900'), null);
assert.equal(customScreen('100', '900'), null, 'too small');
assert.equal(customScreen('500', '99999'), null, 'too large');

assert.equal(fitScale(390, 844, 1000, 1000), 1, 'never enlarges');
assert.equal(fitScale(1000, 1000, 500, 2000), 0.5, 'shrinks to the tighter side');
assert.equal(fitScale(400, 800, 400, 400), 0.5);
assert.equal(fitScale(0, 800, 400, 400), 1, 'no screen, no scaling');

console.log('deviceCatalog: ok');
