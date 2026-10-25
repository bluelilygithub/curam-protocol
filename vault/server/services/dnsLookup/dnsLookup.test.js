'use strict';

// node server/services/dnsLookup/dnsLookup.test.js   (npm run test:dns-lookup). No network: only the pure parts.

const assert = require('assert');
const { normalizeInput } = require('./lookup');
const { emailChecks, spfLookupCount } = require('./emailChecks');

// input clean-up
assert.deepStrictEqual(normalizeInput('Example.COM'), { name: 'example.com' });
assert.deepStrictEqual(normalizeInput('https://www.example.com/path?q=1#x'), { name: 'www.example.com' });
assert.deepStrictEqual(normalizeInput('example.com:8080'), { name: 'example.com' });
assert.deepStrictEqual(normalizeInput('example.com.'), { name: 'example.com' });
assert.deepStrictEqual(normalizeInput('someone@example.com'), { name: 'example.com' });
assert.deepStrictEqual(normalizeInput('1.1.1.1'), { ip: '1.1.1.1' });
assert.deepStrictEqual(normalizeInput('[2606:4700:4700::1111]'), { ip: '2606:4700:4700::1111' });
assert.deepStrictEqual(normalizeInput('bücher.example'), { name: 'xn--bcher-kva.example' });
assert.ok(normalizeInput('').error);
assert.ok(normalizeInput('localhost').error, 'a single word is not a domain');
assert.ok(normalizeInput('bad name.com').error);
assert.ok(normalizeInput(`${'a'.repeat(64)}.com`).error, 'label over 63 characters');

// email checks
const find = (list, id) => list.find((f) => f.id === id);
assert.strictEqual(find(emailChecks({}), 'mx').level, 'bad');
assert.strictEqual(find(emailChecks({}), 'spf').level, 'warn');
assert.strictEqual(find(emailChecks({}), 'dmarc').level, 'warn');

const cf = [{ value: 'route1.mx.cloudflare.net', priority: 1 }, { value: 'route2.mx.cloudflare.net', priority: 2 }];
const good = emailChecks({
  mx: cf,
  txt: [{ value: 'v=spf1 include:_spf.mx.cloudflare.net ~all' }, { value: 'google-site-verification=abc' }],
  dmarc: [{ value: 'v=DMARC1; p=quarantine; rua=mailto:a@b.c' }],
});
assert.strictEqual(find(good, 'mx').level, 'good');
assert.ok(find(good, 'mx-cloudflare'), 'Cloudflare routing is called out');
assert.strictEqual(find(good, 'spf').level, 'good');
assert.strictEqual(find(good, 'dmarc').level, 'good');

assert.ok(find(emailChecks({ mx: [...cf, { value: 'mail.other.com', priority: 5 }] }), 'mx-mixed'));
assert.strictEqual(find(emailChecks({ txt: [{ value: 'v=spf1 -all' }, { value: 'v=spf1 ~all' }] }), 'spf').level, 'bad');
assert.strictEqual(find(emailChecks({ txt: [{ value: 'v=spf1 +all' }] }), 'spf').level, 'bad');
assert.strictEqual(find(emailChecks({ txt: [{ value: 'v=spf1 include:a.com' }] }), 'spf').level, 'warn');
assert.strictEqual(find(emailChecks({ dmarc: [{ value: 'v=DMARC1; p=none' }] }), 'dmarc').level, 'info');

const many = `v=spf1 ${Array.from({ length: 11 }, (_, i) => `include:s${i}.com`).join(' ')} -all`;
assert.strictEqual(spfLookupCount(many), 11);
assert.ok(find(emailChecks({ txt: [{ value: many }] }), 'spf-lookups'), 'over ten lookups is flagged');

console.log('dnsLookup tests passed');
