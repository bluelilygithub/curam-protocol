// node client/src/pages/dnsLookup/compare.test.mjs   (npm run test:dns-lookup)
import assert from 'assert';
import { compareResults } from './compare.mjs';

const a = [
  { type: 'A', records: [{ value: '1.2.3.4', ttl: 300 }, { value: '5.6.7.8', ttl: 300 }] },
  { type: 'MX', records: [{ value: 'mx.example.com', priority: 10 }] },
  { type: 'TXT', records: [] },
  { type: 'NS', records: [], error: 'The resolver did not answer in time.' },
];
const b = [
  { type: 'A', records: [{ value: '5.6.7.8', ttl: 120 }, { value: '1.2.3.4', ttl: 120 }] }, // other order, other TTL: same
  { type: 'MX', records: [{ value: 'mx.example.com', priority: 20 }] },                   // other priority: differs
  { type: 'TXT', records: [] },
  { type: 'NS', records: [{ value: 'ns1.example.com' }] },
];
const out = Object.fromEntries(compareResults(a, b).map((r) => [r.type, r]));
assert.strictEqual(out.A.same, true);
assert.strictEqual(out.MX.same, false);
assert.strictEqual(out.TXT.same, true, 'both empty is the same');
assert.strictEqual(out.NS.same, null, 'an error means no comparison');
assert.ok(out.NS.error);
console.log('dnsLookup compare tests passed');
