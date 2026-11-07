'use strict';

// node server/services/serpTracker/reads.test.js
const assert = require('assert');
const { isFound, positionOf, readRecord, betterRead, needsAnotherRead, summariseReads } = require('./reads');

const ranked = (pos, organic = 10) => ({ organicCount: organic, mine: { status: 'ranked', bestPosition: pos } });
const missed = (organic = 10) => ({ organicCount: organic, mine: { status: 'not_in_top_10', bestPosition: null } });
const noSite = { organicCount: 10, mine: null };

assert.strictEqual(isFound(ranked(3)), true);
assert.strictEqual(isFound(missed()), false);
assert.strictEqual(isFound(noSite), false, 'no site given is not a find');
assert.strictEqual(isFound(null), false);
assert.strictEqual(positionOf(ranked(7)), 7);
assert.strictEqual(positionOf(missed()), null, 'a miss is null, never 0');
assert.deepStrictEqual(readRecord(ranked(2, 9)), { position: 2, organic: 9 });
assert.deepStrictEqual(readRecord(missed(14)), { position: null, organic: 14 });
assert.deepStrictEqual(readRecord(null), { position: null, organic: 0 });

// the best position wins; a find beats a miss whatever the size of the answer; between equals the fuller answer wins
assert.strictEqual(betterRead(ranked(2), null), true, 'the first read is kept');
assert.strictEqual(betterRead(ranked(2), missed(50)), true, 'a find beats a bigger miss');
assert.strictEqual(betterRead(missed(50), ranked(9, 5)), false, 'a miss never replaces a find');
assert.strictEqual(betterRead(ranked(2), ranked(5)), true);
assert.strictEqual(betterRead(ranked(5), ranked(2)), false);
assert.strictEqual(betterRead(missed(14), missed(8)), true, 'between two misses the fuller answer');
assert.strictEqual(betterRead(missed(8), missed(14)), false);
assert.strictEqual(betterRead(ranked(4, 12), ranked(4, 9)), true, 'same position: the fuller read');

// another read: only to look for a site that no read has found yet
const r = (p) => ({ position: p, organic: 10 });
assert.strictEqual(needsAnotherRead({ hasSite: false, reads: [r(null)], maxReads: 3 }), false, 'nothing to look for');
assert.strictEqual(needsAnotherRead({ hasSite: true, reads: [r(4)], maxReads: 3 }), false, 'a find is trusted');
assert.strictEqual(needsAnotherRead({ hasSite: true, reads: [r(null)], maxReads: 3 }), true, 'a miss is read again');
assert.strictEqual(needsAnotherRead({ hasSite: true, reads: [r(null), r(null)], maxReads: 3 }), true);
assert.strictEqual(needsAnotherRead({ hasSite: true, reads: [r(null), r(null), r(null)], maxReads: 3 }), false, 'the limit stops it');
assert.strictEqual(needsAnotherRead({ hasSite: true, reads: [r(null), r(6)], maxReads: 3 }), false, 'found on the second read: done');

// what the page says
assert.deepStrictEqual(summariseReads([r(3)]), { total: 1, found: 1, best: 3, firm: false, text: '' }, 'one read says nothing extra');
assert.deepStrictEqual(summariseReads([r(null), r(5), r(2)]), { total: 3, found: 2, best: 2, firm: false, text: 'Read 3 times: found on 2, best position #2.' });
assert.deepStrictEqual(summariseReads([r(null), r(null), r(null)]), { total: 3, found: 0, best: null, firm: true, text: 'Read 3 times: not found on any of them.' });
assert.deepStrictEqual(summariseReads([r(null)]), { total: 1, found: 0, best: null, firm: false, text: '' }, 'one miss is not a firm "not found"');
assert.deepStrictEqual(summariseReads(undefined), { total: 0, found: 0, best: null, firm: false, text: '' });

console.log('reads.test.js: all passed');
