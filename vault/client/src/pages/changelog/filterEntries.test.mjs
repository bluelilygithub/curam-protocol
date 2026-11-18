// node client/src/pages/changelog/filterEntries.test.mjs
import assert from 'node:assert/strict';
import { parseFilters, filtersToParams, filterEntries, areaOptions, areaParts, searchTerms, highlightParts, citationParts, isFiltered, EMPTY_FILTERS } from './filterEntries.mjs';

const at = (s) => new Date(s).toISOString(); // local time, like the page
const entries = [
  { commit: 'aaaaaa1', fullHash: 'aaaaaa1ffff', committedAt: at('2026-11-18T10:00:00'), subject: 'Finance: GST rounding', area: 'Finance', goal: 'Correct BAS totals', whatChanged: 'Rounds per line', benefit: '', concerns: 'Untested against a real BAS.', filesImpacted: ['server/routes/finance.js', 'server/db.js'] },
  { commit: 'bbbbbb2', committedAt: at('2026-11-16T09:00:00'), subject: 'Opus prices updated', area: 'Usage & Cost', goal: '', whatChanged: 'New Opus prices in the cost table', benefit: 'Correct costs', concerns: 'None noted.', filesImpacted: ['server/services/costCalculator.js'] },
  { commit: 'cccccc3', committedAt: at('2026-11-10T09:00:00'), subject: 'Shared export', area: 'Graphics, Video Tools', goal: '', whatChanged: '', benefit: '', concerns: '', filesImpacted: ['server/db.js', 'client/src/pages/GraphicsPage.jsx'] },
  { commit: 'dddddd4', committedAt: at('2026-10-30T09:00:00'), subject: 'Memory search', area: 'Memory and SERP Tracker', goal: '', whatChanged: '', benefit: '', concerns: 'Costs money', filesImpacted: [] },
];
const ids = (list) => list.map((e) => e.commit);
const F = (x) => ({ ...EMPTY_FILTERS, ...x });

// URL round trip, bad values dropped
const p = parseFilters(new URLSearchParams('q=gst&area=Finance&from=2026-11-01&to=nope&concerns=1&file=db.js'));
assert.deepEqual(p, { q: 'gst', area: 'Finance', from: '2026-11-01', to: '', concerns: true, file: 'db.js' });
assert.deepEqual(filtersToParams(p), { q: 'gst', area: 'Finance', from: '2026-11-01', concerns: '1', file: 'db.js' });
assert.deepEqual(filtersToParams(EMPTY_FILTERS), {}, 'a clear view has a clean URL');
assert.deepEqual(parseFilters(new URLSearchParams('')), { ...EMPTY_FILTERS });
assert.equal(isFiltered(EMPTY_FILTERS), false);
assert.equal(isFiltered(F({ concerns: true })), true);

// text search: every word, across subject, area, goal, whatChanged, benefit, concerns and hash
assert.deepEqual(ids(filterEntries(entries, F({ q: 'opus' }))), ['bbbbbb2']);
assert.deepEqual(ids(filterEntries(entries, F({ q: 'BAS rounds' }))), ['aaaaaa1'], 'goal + whatChanged, AND');
assert.deepEqual(ids(filterEntries(entries, F({ q: 'opus gst' }))), [], 'both words must match');
assert.deepEqual(ids(filterEntries(entries, F({ q: 'cccccc' }))), ['cccccc3'], 'commit hash');
assert.deepEqual(ids(filterEntries(entries, F({ q: 'ffff' }))), ['aaaaaa1'], 'full hash');
assert.deepEqual(ids(filterEntries(entries, F({ q: 'costs' }))), ['bbbbbb2', 'dddddd4'], 'benefit and concerns');
assert.deepEqual(ids(filterEntries(entries, F({ q: '"cost table"' }))), ['bbbbbb2'], 'quoted phrase');
assert.deepEqual(searchTerms('Opus  "cost table" opus'), ['opus', 'cost table']);

// area, from parts of combined areas
assert.deepEqual(areaParts('Memory and SERP Tracker'), ['Memory', 'SERP Tracker']);
assert.deepEqual(areaOptions(entries), ['Finance', 'Graphics', 'Memory', 'SERP Tracker', 'Usage & Cost', 'Video Tools']);
assert.deepEqual(ids(filterEntries(entries, F({ area: 'Video Tools' }))), ['cccccc3']);
assert.deepEqual(ids(filterEntries(entries, F({ area: 'finance' }))), ['aaaaaa1'], 'case does not matter');

// date range, inclusive, in local days
assert.deepEqual(ids(filterEntries(entries, F({ from: '2026-11-10', to: '2026-11-16' }))), ['bbbbbb2', 'cccccc3']);
assert.deepEqual(ids(filterEntries(entries, F({ from: '2026-11-17' }))), ['aaaaaa1']);
assert.deepEqual(ids(filterEntries(entries, F({ to: '2026-10-31' }))), ['dddddd4']);

// has concerns: not empty and not "None noted."
assert.deepEqual(ids(filterEntries(entries, F({ concerns: true }))), ['aaaaaa1', 'dddddd4']);

// file: partial path, backslashes accepted
assert.deepEqual(ids(filterEntries(entries, F({ file: 'db.js' }))), ['aaaaaa1', 'cccccc3']);
assert.deepEqual(ids(filterEntries(entries, F({ file: 'client\\src\\pages' }))), ['cccccc3']);
assert.deepEqual(ids(filterEntries(entries, F({ file: 'DB.JS', concerns: true }))), ['aaaaaa1'], 'filters combine');

// highlight
assert.deepEqual(highlightParts('New Opus prices', ['opus']), [{ text: 'New ', hit: false }, { text: 'Opus', hit: true }, { text: ' prices', hit: false }]);
assert.deepEqual(highlightParts('a.b', ['.']), [{ text: 'a', hit: false }, { text: '.', hit: true }, { text: 'b', hit: false }], 'special characters are literal');
assert.deepEqual(highlightParts('plain', []), [{ text: 'plain', hit: false }]);

// citations: known hashes become links (full or short form), unknown stay as text
assert.deepEqual(citationParts('Changed [aaaaaa1] and [AAAAAA1fff] not [9999999].', ['aaaaaa1']), [
  { text: 'Changed ' }, { hash: 'aaaaaa1' }, { text: ' and ' }, { hash: 'aaaaaa1' }, { text: ' not [9999999].' },
]);

console.log('filterEntries: all passed');
