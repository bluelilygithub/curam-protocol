'use strict';

// node server/config/featureAccess.test.js
// An accountant login is not narrowed by the workspace's member switches: Finance always, Shares only when the owner ticked it.

const assert = require('assert');
const { accountantFlags, FEATURE_ACCESS_KEYS } = require('./featureAccess');

const off = accountantFlags(null);
assert.strictEqual(off.finance, true, 'Finance is always on for an accountant');
assert.strictEqual(off.shares, false, 'Shares is off unless the owner ticked it');
assert.deepStrictEqual(FEATURE_ACCESS_KEYS.filter((k) => off[k]), ['finance']);

const on = accountantFlags({ shares: true });
assert.deepStrictEqual(FEATURE_ACCESS_KEYS.filter((k) => on[k]), ['finance', 'shares']);

// a stored finance:false (old or hand-edited row) cannot lock the accountant out of the owner's books
assert.strictEqual(accountantFlags({ finance: false, shares: false }).finance, true);
assert.strictEqual(accountantFlags({ shares: 'true' }).shares, false, 'only a real true counts');

console.log('featureAccess tests passed');
