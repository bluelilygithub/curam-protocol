'use strict';

// node server/services/geoCheck/proxy.test.js

const assert = require('assert');
const proxy = require('./proxy');

const SECRET_USER = 'cust-SECRETUSER';
const SECRET_PASS = 'SECRETPASS';
const env = { GEO_PROXY_SERVER: 'http://gw.example.net:823', GEO_PROXY_USERNAME_TEMPLATE: `${SECRET_USER}__cr.{country}`, GEO_PROXY_PASSWORD: SECRET_PASS };

assert.strictEqual(proxy.isConfigured({}), false);
assert.strictEqual(proxy.isConfigured({ ...env, GEO_PROXY_PASSWORD: ' ' }), false, 'a blank variable counts as missing');
assert.strictEqual(proxy.proxyFor('AU', {}), null);
assert.deepStrictEqual(proxy.proxyFor('AU', env), { server: 'http://gw.example.net:823', username: `${SECRET_USER}__cr.au`, password: SECRET_PASS });
assert.strictEqual(proxy.proxyFor('gb', { ...env, GEO_PROXY_USERNAME_TEMPLATE: 'u-cc-{COUNTRY}' }).username, 'u-cc-GB');
// IPRoyal puts the country in the password
assert.strictEqual(proxy.proxyFor('DE', { ...env, GEO_PROXY_PASSWORD: 'pw_country-{country}' }).password, 'pw_country-de');
assert.strictEqual(proxy.proxyFor('A', env), null, 'not a two-letter code');

assert.strictEqual(proxy.checkUrl({}), 'https://ipinfo.io/json');
assert.strictEqual(proxy.checkUrl({ GEO_PROXY_CHECK_URL: 'https://check.example/json' }), 'https://check.example/json');
assert.strictEqual(proxy.costPerGb({}), null);
assert.strictEqual(proxy.costPerGb({ GEO_PROXY_COST_PER_GB: '1.50' }), 1.5);
assert.strictEqual(proxy.costPerGb({ GEO_PROXY_COST_PER_GB: 'abc' }), null);

// describe() is what gets logged: never the username or password
const d = JSON.stringify(proxy.describe({ ...env, GEO_PROXY_LABEL: 'DataImpulse' }));
assert.ok(!d.includes('SECRET'), d);
assert.deepStrictEqual(JSON.parse(d), { configured: true, label: 'DataImpulse', gateway: 'gw.example.net:823' });
assert.deepStrictEqual(proxy.describe({}), { configured: false });

console.log('geoCheck proxy tests passed');
