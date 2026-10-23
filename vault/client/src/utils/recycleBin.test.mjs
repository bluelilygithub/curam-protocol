import assert from 'node:assert';
import { daysLeftText, deletedAgoText, kindsIn } from './recycleBin.mjs';

assert.strictEqual(daysLeftText(30), '30 days left');
assert.strictEqual(daysLeftText(2), '2 days left');
assert.strictEqual(daysLeftText(1), 'Last day');
assert.strictEqual(daysLeftText(0), 'Last day');
assert.strictEqual(daysLeftText(undefined), 'Last day');

const now = new Date(2026, 9, 23, 12, 0);
const ago = (ms) => new Date(now.getTime() - ms).toISOString();
assert.strictEqual(deletedAgoText(ago(20 * 1000), now), 'just now');
assert.strictEqual(deletedAgoText(ago(60 * 1000), now), '1 minute ago');
assert.strictEqual(deletedAgoText(ago(5 * 60 * 1000), now), '5 minutes ago');
assert.strictEqual(deletedAgoText(ago(60 * 60 * 1000), now), '1 hour ago');
assert.strictEqual(deletedAgoText(ago(3 * 60 * 60 * 1000), now), '3 hours ago');
assert.strictEqual(deletedAgoText(ago(30 * 60 * 60 * 1000), now), 'yesterday');
assert.strictEqual(deletedAgoText(ago(4 * 24 * 60 * 60 * 1000), now), '4 days ago');
assert.match(deletedAgoText(ago(20 * 24 * 60 * 60 * 1000), now), /\d/, 'older than two weeks shows the date');
assert.strictEqual(deletedAgoText('garbage', now), '');

assert.deepStrictEqual(kindsIn([
  { entityType: 'note', label: 'Note' }, { entityType: 'note-template', label: 'Note template' }, { entityType: 'note', label: 'Note' },
]), [{ type: 'note', label: 'Note', count: 2 }, { type: 'note-template', label: 'Note template', count: 1 }]);
assert.deepStrictEqual(kindsIn([{ entityType: 'x' }]), [{ type: 'x', label: 'x', count: 1 }], 'no label: the kind is shown');
assert.deepStrictEqual(kindsIn(undefined), []);

console.log('ok - recycle bin wording: days left, how long ago, kinds for the filter');
