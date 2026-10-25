// node client/src/pages/graphics/historyStore.test.mjs   (npm run test:graphics-history)
// The pure parts of the Recent results store. The IndexedDB part needs a browser.
import assert from 'assert';
import { planPrune, signatureOf, timeAgo, dataUrlToBlob } from './historyStore.mjs';

const MB = 1024 * 1024;
const e = (id, createdAt, bytes = MB) => ({ id, createdAt, bytes });

// Under the limits: nothing goes.
assert.deepStrictEqual(planPrune([e(1, 1), e(2, 2)], { maxItems: 5, maxBytes: 10 * MB }), []);

// Too many: the oldest go, the newest stay.
assert.deepStrictEqual(planPrune([e(1, 10), e(2, 20), e(3, 30), e(4, 40)], { maxItems: 2, maxBytes: 100 * MB }).sort(), [1, 2]);

// Too big in total: oldest go until it fits.
assert.deepStrictEqual(planPrune([e(1, 10, 6 * MB), e(2, 20, 6 * MB), e(3, 30, 6 * MB)], { maxItems: 10, maxBytes: 13 * MB }), [1]);

// A newest entry on its own bigger than the whole allowance is dropped too, never left to fill the store.
assert.deepStrictEqual(planPrune([e(1, 10, 20 * MB)], { maxItems: 10, maxBytes: 13 * MB }), [1]);

// Order of the input does not matter.
assert.deepStrictEqual(planPrune([e(3, 30), e(1, 10), e(2, 20)], { maxItems: 1, maxBytes: 100 * MB }).sort(), [1, 2]);

// Same picture = same fingerprint; a different one differs.
const a = `data:image/png;base64,${'A'.repeat(200)}`;
const b = `data:image/png;base64,${'A'.repeat(199)}B`;
assert.strictEqual(signatureOf(a), signatureOf(a));
assert.notStrictEqual(signatureOf(a), signatureOf(b));

// Friendly times.
const now = 1_000_000_000_000;
assert.strictEqual(timeAgo(now - 10_000, now), 'just now');
assert.strictEqual(timeAgo(now - 5 * 60_000, now), '5 min ago');
assert.strictEqual(timeAgo(now - 3 * 3_600_000, now), '3 h ago');
assert.strictEqual(timeAgo(now - 86_400_000, now), '1 day ago');
assert.strictEqual(timeAgo(now - 3 * 86_400_000, now), '3 days ago');
assert.strictEqual(timeAgo(now + 5000, now), 'just now'); // clock a little off

// A data URL becomes a Blob of the right type and size.
const blob = dataUrlToBlob(`data:image/webp;base64,${Buffer.from('hello world').toString('base64')}`);
assert.strictEqual(blob.type, 'image/webp');
assert.strictEqual(blob.size, 11);

console.log('graphics history: ok');
