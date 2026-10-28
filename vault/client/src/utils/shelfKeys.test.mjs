// node client/src/utils/shelfKeys.test.mjs
import assert from 'node:assert/strict';
import { whenText, statusWord, EXPIRY_CHOICES } from './shelfKeys.mjs';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL  ${name}\n   ${e.message}`); process.exitCode = 1; } };
const now = new Date('2026-10-29T12:00:00Z');

t('past moments read as today, yesterday, N days ago, then a date', () => {
  assert.equal(whenText('2026-10-29T08:00:00Z', false, now), 'today');
  assert.equal(whenText('2026-10-28T12:00:00Z', false, now), 'yesterday');
  assert.equal(whenText('2026-10-19T12:00:00Z', false, now), '10 days ago');
  assert.match(whenText('2026-01-05T12:00:00Z', false, now), /2026/);
});
t('future moments read as in N days, tomorrow, or in N hours', () => {
  assert.equal(whenText('2026-11-28T12:00:00Z', true, now), 'in 30 days');
  assert.equal(whenText('2026-10-30T12:00:00Z', true, now), 'tomorrow');
  assert.equal(whenText('2026-10-29T15:00:00Z', true, now), 'in 3 hours');
});
t('a bad date says unknown instead of breaking', () => {
  assert.equal(whenText('nonsense', false, now), 'unknown');
  assert.equal(whenText(null, false, now), 'unknown');
  assert.equal(whenText('', false, now), 'unknown');
  assert.equal(whenText(undefined, true, now), 'unknown');
});
t('status words, and an expiry list that starts with never', () => {
  assert.equal(statusWord('active'), 'Active');
  assert.equal(statusWord('revoked'), 'Revoked');
  assert.equal(statusWord('expired'), 'Expired');
  assert.equal(statusWord('??'), 'Unknown');
  assert.equal(EXPIRY_CHOICES[0].value, '');
  assert.deepEqual(EXPIRY_CHOICES.slice(1).map((c) => c.value), ['30', '90', '365']);
});

console.log(process.exitCode ? 'Some checks FAILED' : `All ${passed} checks passed`);
