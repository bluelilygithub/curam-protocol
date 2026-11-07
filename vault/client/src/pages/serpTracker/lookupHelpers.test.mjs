// node client/src/pages/serpTracker/lookupHelpers.test.mjs   (pure; expected values worked out by hand)
import assert from 'node:assert/strict';
import { readsText, safeHref, positionText, costText, toggleOne, toggleAll, pruneSelection, deletedMessage, groupLayout, layoutName, estimateCost, pageText } from './lookupHelpers.mjs';

// links: only http(s)
assert.equal(safeHref('https://www.wiwc.com.au/a'), 'https://www.wiwc.com.au/a');
assert.equal(safeHref('http://x.com'), 'http://x.com/');
for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x', 'notaurl', '', null, undefined]) assert.equal(safeHref(bad), null, String(bad));

// position text: a real position, "not in top N", or no site; never "#0"
assert.equal(positionText({ myStatus: 'ranked', myPosition: 3 }), '#3');
assert.equal(positionText({ myStatus: 'ranked', myPosition: 118, myPage: 12 }), '#118 (page 12)');
assert.equal(positionText({ myStatus: 'ranked', myPosition: 10, myPage: 1 }), '#10'); // page 1 is not worth saying
assert.equal(positionText({ myStatus: 'not_in_top_20', myPosition: null }), 'Not in top 20');
assert.equal(positionText({ myStatus: 'not_in_top_100', myPosition: null, checked: 13, complete: false }), 'Not in first 13'); // DataForSEO gave 13 of the 100 asked for
assert.equal(positionText({ myStatus: 'not_in_top_100', myPosition: null, checked: 97, complete: true }), 'Not in top 100');
assert.equal(positionText({ myStatus: 'not_in_top_20', myPosition: null }), 'Not in top 20'); // an older lookup with no coverage recorded
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

// the estimate before a search: 0.002 per 10 results + 0.002 for the AI summary (server price list), never a guess when prices are missing
const pr = { perTenResultsUsd: 0.002, aiOverviewUsd: 0.002 };
const nearly = (a, b) => Math.abs(a - b) < 1e-9;
assert.ok(nearly(estimateCost(10, true, pr), 0.004));
assert.ok(nearly(estimateCost(100, false, pr), 0.02));
assert.ok(nearly(estimateCost(200, true, pr), 0.042));
assert.equal(estimateCost(10, true, null), null);
assert.equal(estimateCost(10, true, {}), null);

// which page: 10 a page
assert.equal(pageText(3), 'page 1');
assert.equal(pageText(10), 'page 1');
assert.equal(pageText(11), 'page 2');
assert.equal(pageText(118), 'page 12');
assert.equal(pageText(null), '');
assert.equal(pageText(0), '');

// how many times a search was read
assert.equal(readsText(undefined), '');
assert.equal(readsText([{ position: 3, organic: 9 }]), '', 'a single read says nothing extra');
assert.match(readsText([{ position: null, organic: 9 }, { position: null, organic: 9 }, { position: null, organic: 9 }]), /Read 3 times and the site was not found on any of them/);
assert.match(readsText([{ position: null, organic: 9 }, { position: 4, organic: 9 }]), /Read 2 times: the site was found on 1 of them, and the best position \(#4\)/);
assert.match(readsText([{ position: 6, organic: 9 }, { position: 2, organic: 9 }, { position: null, organic: 9 }]), /found on 2 of them.*#2/);

console.log('lookupHelpers.test.mjs: all passed');
