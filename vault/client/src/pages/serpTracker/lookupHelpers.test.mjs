// node client/src/pages/serpTracker/lookupHelpers.test.mjs   (pure; expected values worked out by hand)
import assert from 'node:assert/strict';
import { safeHref, positionText, costText, toggleOne, toggleAll, pruneSelection, deletedMessage, groupLayout, layoutName } from './lookupHelpers.mjs';

// links: only http(s)
assert.equal(safeHref('https://www.wiwc.com.au/a'), 'https://www.wiwc.com.au/a');
assert.equal(safeHref('http://x.com'), 'http://x.com/');
for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'notaurl', '', null, undefined]) assert.equal(safeHref(bad), null, String(bad));

// position text: a real position, "not in top N", or no site; never "#0"
assert.equal(positionText({ myStatus: 'ranked', myPosition: 3 }), '#3');
assert.equal(positionText({ myStatus: 'not_in_top_20', myPosition: null }), 'Not in top 20');
assert.equal(positionText({ myStatus: null }), 'No site set');
assert.equal(positionText(null), 'No site set');
assert.equal(positionText({ myStatus: 'weird' }), 'Not ranked');

// cost
assert.equal(costText(0), 'US$0.00');
assert.equal(costText(0.0123), 'US$0.0123');
assert.equal(costText(0.0123456), 'US$0.0123');
assert.equal(costText(0.5), 'US$0.50');
assert.equal(costText('x'), '—');

// selection: one at a time, select all, all again = none, a partial pick then select all = all
let sel = new Set();
sel = toggleOne(sel, 2); assert.deepEqual([...sel], [2]);
sel = toggleOne(sel, 5); assert.deepEqual([...sel].sort(), [2, 5]);
sel = toggleOne(sel, 2); assert.deepEqual([...sel], [5]);
assert.deepEqual([...toggleAll(sel, [2, 5, 9])].sort((a, b) => a - b), [2, 5, 9]); // partial -> all
assert.equal(toggleAll(new Set([2, 5, 9]), [2, 5, 9]).size, 0); // all -> none
assert.equal(toggleAll(new Set(), []).size, 0); // an empty list never "selects" anything
assert.deepEqual([...pruneSelection(new Set([1, 2, 3]), [2, 3, 4])].sort(), [2, 3]);

assert.equal(deletedMessage(1), '1 lookup deleted. Kept 30 days.');
assert.equal(deletedMessage(3), '3 lookups deleted. Kept 30 days.');

// layout grouping: neighbours of one kind merge, order is kept
assert.deepEqual(
  groupLayout([{ type: 'paid' }, { type: 'ai_overview' }, { type: 'organic' }, { type: 'organic' }, { type: 'people_also_ask' }, { type: 'organic' }]),
  [{ name: 'Ads', count: 1 }, { name: 'AI summary', count: 1 }, { name: 'Results', count: 2 }, { name: 'People also ask', count: 1 }, { name: 'Results', count: 1 }],
);
assert.equal(layoutName('some_new_thing'), 'some new thing');
assert.deepEqual(groupLayout(null), []);

console.log('lookupHelpers.test.mjs: all passed');
