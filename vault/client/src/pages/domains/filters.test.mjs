// node client/src/pages/domains/filters.test.mjs   (instant filters on the generated names)
import assert from 'node:assert';
import { BLANK_FILTERS, applyFilters, activeFilters, countLine, matches } from './filters.mjs';

const R = (tld, available) => ({ tld, available });
const card = (name, over = {}) => ({ name, style: 'invented', syllables: 2, spell: { score: 10 }, domains: { results: [R('com', true), R('com.au', true), R('org', false), R('io', null)] }, ...over });
const pool = [
  card('lumera', { syllables: 3 }),
  card('tasmin'),
  card('harbourlight', { style: 'compound', syllables: 3, spell: { score: 40 }, domains: { results: [R('com', false), R('com.au', true)] } }),
  card('bree', { syllables: 1 }),
  card('thestaircasesuitcase', { own: true, label: 'The Staircase Suitcase', syllables: 6, domains: { results: [R('com', false)] } }),
];
const names = (f, shortlist) => applyFilters(pool, { ...BLANK_FILTERS, ...f }, shortlist).map((c) => c.name);

assert.deepStrictEqual(names({}), ['lumera', 'tasmin', 'harbourlight', 'bree', 'thestaircasesuitcase'], 'no filters shows everything');
// the person's own names are never filtered out, however strict the filters
assert.deepStrictEqual(names({ maxLetters: 4, endings: ['org'], styles: ['metaphor'], startsWith: 'z', avoidLetters: 'e', hideHardSpelling: true, shortlistedOnly: true }), ['thestaircasesuitcase']);
// length and syllables
assert.deepStrictEqual(names({ maxLetters: 6 }), ['lumera', 'tasmin', 'bree', 'thestaircasesuitcase']);
assert.deepStrictEqual(names({ maxSyllables: 2 }), ['tasmin', 'bree', 'thestaircasesuitcase']);
// an ending must be positively free: taken and unknown both fail
assert.deepStrictEqual(names({ endings: ['com'] }), ['lumera', 'tasmin', 'bree', 'thestaircasesuitcase']);
assert.deepStrictEqual(names({ endings: ['io'] }), ['thestaircasesuitcase'], 'unknown is not free');
assert.deepStrictEqual(names({ endings: ['org'] }), ['thestaircasesuitcase'], 'taken is not free');
assert.deepStrictEqual(names({ endings: ['com', 'com.au'] }), ['lumera', 'tasmin', 'bree', 'thestaircasesuitcase']);
// style, first letters, letters to avoid
assert.deepStrictEqual(names({ styles: ['compound'] }), ['harbourlight', 'thestaircasesuitcase']);
assert.deepStrictEqual(names({ startsWith: 'l, ta' }), ['lumera', 'tasmin', 'thestaircasesuitcase']);
assert.deepStrictEqual(names({ avoidLetters: 'a, b' }), ['thestaircasesuitcase']);
assert.deepStrictEqual(names({ avoidLetters: '  ' }).length, 5, 'blank text is no filter');
// hard to spell
assert.deepStrictEqual(names({ hideHardSpelling: true }), ['lumera', 'tasmin', 'bree', 'thestaircasesuitcase']);
// shortlisted only
assert.deepStrictEqual(names({ shortlistedOnly: true }, ['tasmin']), ['tasmin', 'thestaircasesuitcase']);
// filters combine
assert.deepStrictEqual(names({ endings: ['com'], maxSyllables: 2, startsWith: 't' }), ['tasmin', 'thestaircasesuitcase']);
// the count line says what is showing and why
assert.strictEqual(countLine(5, 5, BLANK_FILTERS), '5 of 5 shown');
assert.strictEqual(countLine(2, 5, { ...BLANK_FILTERS, maxLetters: 6, endings: ['com.au'], hideHardSpelling: true }), '2 of 5 shown (up to 6 letters, .com.au free, easy to spell)');
assert.deepStrictEqual(activeFilters({ ...BLANK_FILTERS, maxSyllables: 1, startsWith: 'b, st', avoidLetters: 'xz', shortlistedOnly: true }), ['up to 1 syllable', 'starting b or st', 'without x, z', 'shortlisted only']);
assert.deepStrictEqual(activeFilters(null), []);
assert.strictEqual(matches(card('x'), null), true);
assert.deepStrictEqual(applyFilters(null, BLANK_FILTERS), []);

console.log('filters tests passed');
