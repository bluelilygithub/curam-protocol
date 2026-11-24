'use strict';
// node server/services/ticketEmails.test.js — the pure parts of Related emails: search words, Gmail queries, ranking, input checks.
const assert = require('node:assert/strict');
const { keywords, buildQueries, rank, cleanEmail } = require('./ticketEmails');

assert.deepEqual(keywords('Fix the invoice template for Acme again ASAP'), ['invoice', 'template', 'acme']);
assert.deepEqual(keywords('Acme\'s login page broken'), ['acme', 'login', 'page', 'broken']);
assert.deepEqual(keywords('a b to'), []);

let q = buildQueries({ title: 'Invoice totals wrong', addresses: ['jo@acme.com'], domains: ['acme.com'] });
assert.equal(q.queries.length, 2);
assert.equal(q.queries[0], '(from:jo@acme.com OR to:jo@acme.com OR from:@acme.com OR to:@acme.com) (invoice OR totals OR wrong) newer_than:1y');
assert.equal(q.queries[1], '(from:jo@acme.com OR to:jo@acme.com OR from:@acme.com OR to:@acme.com) newer_than:1y');
assert.deepEqual(buildQueries({ title: 'Invoice totals' }).queries, ['(invoice OR totals) newer_than:1y']);
assert.deepEqual(buildQueries({ title: 'to do' }).queries, []);

const hits = [
  { threadId: 'a1', subject: 'Lunch', snippet: 'see you', date: '2026-11-20T00:00:00Z' },
  { threadId: 'b2', subject: 'Invoice', snippet: 'totals look off', date: '2026-11-01T00:00:00Z' },
  { threadId: 'c3', subject: 'Invoice 42', snippet: 'paid', date: '2026-11-10T00:00:00Z' },
];
const words = ['invoice', 'totals'];
assert.deepEqual(rank(hits, words, { hasClient: true }).map((h) => h.threadId), ['b2', 'c3', 'a1']); // client mail: all kept, best first
assert.deepEqual(rank(hits, words, { hasClient: false }).map((h) => h.threadId), ['b2']); // no client: must mention both words

assert.equal(cleanEmail({ threadId: '../../etc' }), null);
assert.equal(cleanEmail({ threadId: '18c2f0a9b1d2e3f4', status: 'deleted' }).status, 'suggested');
assert.equal(cleanEmail({ threadId: '18c2f0a9b1d2e3f4', subject: 'x'.repeat(999) }).subject.length, 300);

console.log('ticketEmails.test.js: all passed');
