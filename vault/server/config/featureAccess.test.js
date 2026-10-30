'use strict';

// node server/config/featureAccess.test.js
// An accountant login is not narrowed by the workspace's member switches: Finance always, Shares only when the owner ticked it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { accountantFlags, FEATURE_ACCESS_KEYS, FEATURE_ACCESS_DEFAULTS, FEATURE_LIFECYCLE, LIFECYCLE_VALUES, lifecycleOf } = require('./featureAccess');

const off = accountantFlags(null);
assert.strictEqual(off.finance, true, 'Finance is always on for an accountant');
assert.strictEqual(off.shares, false, 'Shares is off unless the owner ticked it');
assert.deepStrictEqual(FEATURE_ACCESS_KEYS.filter((k) => off[k]), ['finance']);

const on = accountantFlags({ shares: true });
assert.deepStrictEqual(FEATURE_ACCESS_KEYS.filter((k) => on[k]), ['finance', 'shares']);

// a stored finance:false (old or hand-edited row) cannot lock the accountant out of the owner's books
assert.strictEqual(accountantFlags({ finance: false, shares: false }).finance, true);
assert.strictEqual(accountantFlags({ shares: 'true' }).shares, false, 'only a real true counts');

// Client and server flag lists must not drift (translate/guitar once existed only on the client, so an admin could not switch them)
const clientSrc = fs.readFileSync(path.join(__dirname, '../../client/src/utils/featureAccess.js'), 'utf8');
const m = clientSrc.match(/DEFAULT_FEATURE_ACCESS\s*=\s*(\{[\s\S]*?\n\});/);
assert.ok(m, 'could not find DEFAULT_FEATURE_ACCESS in the client file');
const clientDefaults = new Function(`return (${m[1]});`)();
assert.deepStrictEqual(Object.keys(clientDefaults).sort(), [...FEATURE_ACCESS_KEYS].sort(), 'client DEFAULT_FEATURE_ACCESS keys differ from server FEATURE_ACCESS_KEYS');
for (const k of FEATURE_ACCESS_KEYS) {
  assert.strictEqual(clientDefaults[k], FEATURE_ACCESS_DEFAULTS[k], `default for "${k}" differs between client and server`);
}
const clientMenuKeys = [...clientSrc.matchAll(/\{\s*key:\s*'(\w+)'/g)].map((x) => x[1]);
for (const k of clientMenuKeys) assert.ok(FEATURE_ACCESS_KEYS.includes(k), `Feature Access menu lists "${k}" which the server does not know`);

// Lifecycle status: only real flags, only known values, same on the client, and a tool that ships switched off is never "ga"
for (const [k, v] of Object.entries(FEATURE_LIFECYCLE)) {
  assert.ok(FEATURE_ACCESS_KEYS.includes(k), `lifecycle lists "${k}" which is not a flag`);
  assert.ok(LIFECYCLE_VALUES.includes(v) && v !== 'ga', `lifecycle for "${k}" must be preview or parked (ga is the default and is left out)`);
}
assert.strictEqual(lifecycleOf('finance'), 'ga');
assert.strictEqual(lifecycleOf('cellarPlanner'), 'preview');
const lc = clientSrc.match(/FEATURE_LIFECYCLE\s*=\s*(\{[\s\S]*?\n\});/);
assert.ok(lc, 'could not find FEATURE_LIFECYCLE in the client file');
assert.deepStrictEqual(new Function(`return (${lc[1]});`)(), FEATURE_LIFECYCLE, 'client FEATURE_LIFECYCLE differs from the server list');
for (const k of FEATURE_ACCESS_KEYS) {
  if (FEATURE_ACCESS_DEFAULTS[k] === false && k !== 'memberModelSelection') assert.notStrictEqual(lifecycleOf(k), 'ga', `"${k}" ships switched off, so it cannot be ga: mark it preview or parked`);
}

console.log('featureAccess tests passed');
