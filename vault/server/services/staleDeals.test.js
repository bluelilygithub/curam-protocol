'use strict';
// node server/services/staleDeals.test.js  (the rule is pure; the run is exercised with a fake pool and a fake capture)
const assert = require('assert');
const { staleSuggestion, runStaleDealCheck, daysSince, STALE_DAYS } = require('./staleDeals');

const now = new Date('2026-11-09T12:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const deal = (over = {}) => ({ id: 7, userId: 1, clientId: 3, title: 'Website retainer', stage: 'proposal', value: '1500', clientName: 'BTMB pty ltd', lastActivity: daysAgo(30), ...over });

assert.strictEqual(daysSince(daysAgo(30), now), 30);
assert.strictEqual(daysSince(daysAgo(-3), now), 0, 'a date in the future is never negative');

const s = staleSuggestion(deal(), now);
assert.ok(s, 'a deal quiet for 30 days is stale');
assert.strictEqual(s.category, 'alert');
assert.strictEqual(s.source, 'staleDeals');
assert.strictEqual(s.userId, 1);
assert.strictEqual(s.context, '/clients/3');
assert.match(s.title, /Website retainer.*30 days/);
assert.match(s.body, /BTMB pty ltd/);
assert.match(s.body, /proposal/);
assert.match(s.body, /\$1,500/);

assert.strictEqual(staleSuggestion(deal({ lastActivity: daysAgo(STALE_DAYS - 1) }), now), null, 'one day short is not stale');
assert.ok(staleSuggestion(deal({ lastActivity: daysAgo(STALE_DAYS) }), now), 'exactly the limit is stale');
assert.strictEqual(staleSuggestion(deal({ lastActivity: null }), now), null, 'no date, no card');
assert.ok(!/\$/.test(staleSuggestion(deal({ value: null }), now).body), 'no value, no dollar amount');

// one fingerprint per deal, stable between runs, different between deals
assert.strictEqual(staleSuggestion(deal(), now).fingerprint, staleSuggestion(deal({ lastActivity: daysAgo(40) }), new Date(now.getTime() + 86400000)).fingerprint);
assert.notStrictEqual(staleSuggestion(deal(), now).fingerprint, staleSuggestion(deal({ id: 8 }), now).fingerprint);

(async () => {
  const rows = [deal({ id: 1 }), deal({ id: 2, lastActivity: daysAgo(2) }), deal({ id: 3, lastActivity: daysAgo(90) })];
  const captured = [];
  const out = await runStaleDealCheck({ pool: { query: async () => ({ rows }) }, now, captureFn: async (p) => { captured.push(p); } });
  assert.deepStrictEqual(out, { checked: 3, stale: 2 });
  assert.strictEqual(captured.length, 2);
  assert.ok(captured.every((c) => c.source === 'staleDeals'));
  console.log('staleDeals tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
