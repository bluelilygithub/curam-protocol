'use strict';

const assert = require('assert');
const { monthlyCapUsd, estimateUsd, monthStart, assertWithinCap, FEATURE } = require('./spend');

assert.strictEqual(FEATURE, 'shares_compliance_report');
assert.strictEqual(monthlyCapUsd({}), 1);
assert.strictEqual(monthlyCapUsd({ SHARES_COMPLIANCE_MAX_COST_USD: '2.5' }), 2.5);
assert.strictEqual(monthlyCapUsd({ SHARES_COMPLIANCE_MAX_COST_USD: 'abc' }), 1);
assert.strictEqual(estimateUsd({}), 0.05);
assert.strictEqual(monthStart(new Date('2026-11-24T09:00:00Z')), '2026-11-01T00:00:00.000Z');

const makePool = (total) => ({
  async query(sql, params) {
    assert.match(sql, /FROM usage_logs/);
    assert.strictEqual(params[0], 7);
    assert.strictEqual(params[2], FEATURE);
    return { rows: [{ total }] };
  },
});

(async () => {
  const env = { SHARES_COMPLIANCE_MAX_COST_USD: '1', SHARES_COMPLIANCE_ESTIMATED_COST_USD: '0.2' };
  const ok = await assertWithinCap(7, { pool: makePool(0.7), env, now: new Date('2026-11-24T00:00:00Z') });
  assert.ok(Math.abs(ok.remaining - 0.3) < 1e-9);

  await assert.rejects(
    () => assertWithinCap(7, { pool: makePool(0.9), env, now: new Date('2026-11-24T00:00:00Z') }),
    (err) => err.status === 402 && /Shares compliance limit/.test(err.message)
  );

  console.log('sharesCompliance/spend: ok');
})().catch((err) => { console.error(err); process.exit(1); });
