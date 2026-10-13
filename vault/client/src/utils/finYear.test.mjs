// Run: node client/src/utils/finYear.test.mjs
// Guards the two copies of finYearForDate (server/utils/finYear.js and finYear.mjs) staying identical.
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { finYearForDate as clientFy } from './finYear.mjs';

const require = createRequire(import.meta.url);
const { finYearForDate: serverFy } = require('../../../server/utils/finYear.js');

assert.strictEqual(clientFy('2025-06-30'), '2024-25');
assert.strictEqual(clientFy('2025-07-01'), '2025-26');
assert.strictEqual(clientFy('2099-12-31'), '2099-00');
assert.strictEqual(clientFy('2000-01-01'), '1999-00');

let n = 0;
for (let t = Date.UTC(1999, 0, 1); t < Date.UTC(2101, 0, 1); t += 86400000 * 7) {
  const iso = new Date(t).toISOString().slice(0, 10);
  assert.strictEqual(clientFy(iso), serverFy(iso), iso);
  n++;
}
// every FY boundary day exactly
for (let y = 1999; y <= 2100; y++) {
  for (const d of [`${y}-06-30`, `${y}-07-01`]) assert.strictEqual(clientFy(d), serverFy(d), d);
}
console.log(`finYear: client and server agree on ${n} dates and every FY boundary`);
