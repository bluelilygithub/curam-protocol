'use strict';

/**
 * Bank lexicon + alias merge smoke.
 * Run: node server/services/documentRedaction/bankLexicon.test.js
 */

const assert = require('assert');
const {
  findBankFamily,
  bankEntityKey,
  extractBankNameCandidates,
  summarizeBriefIntents,
} = require('./bankLexicon');
const {
  mergeAndDeduplicateCandidates,
  expandOccurrencesWithIr,
  entityKeyFor,
} = require('./mergeCandidates');
const { extractPatternCandidates } = require('./patternCandidates');

assert.strictEqual(bankEntityKey('Macquarie'), bankEntityKey('Macquarie Bank'));
assert.strictEqual(entityKeyFor('NAB'), entityKeyFor('National Australia Bank'));
assert.ok(findBankFamily('CommBank'));

const brief = summarizeBriefIntents('Please redact all bank names and financial figures');
assert.ok(brief.intents.some((i) => /Bank/i.test(i)));
assert.ok(brief.summary.includes('Bank'));

const ir = {
  paragraphs: [
    {
      paragraphId: 'body-p-0',
      part: 'body',
      xmlPath: 'word/document.xml',
      text: 'NAB and Macquarie Bank vs Macquarie and CommBank rates differ from ANZ.',
    },
  ],
};

const banks = extractBankNameCandidates(ir, 'job1', {
  newId: () => `id-${Math.random()}`,
  locateInParagraph: (p, start, end, quote) => ({
    part: p.part,
    paragraphId: p.paragraphId,
    xmlPath: p.xmlPath,
    startOffset: start,
    endOffset: end,
    quote,
  }),
  normalizeCategoryLabel: (c) => (c === 'bank_name' ? 'Bank name' : c),
});

assert.ok(banks.length >= 4, `expected multiple bank families, got ${banks.length}`);
const mac = banks.find((b) => b.entityKey === 'bank:macquarie');
assert.ok(mac, 'macquarie family');
assert.ok(mac.surfaceForms.some((f) => /macquarie/i.test(f)));

const patterns = extractPatternCandidates(ir, 'job1');
const bankPatterns = patterns.filter((c) => c.categoryLabel === 'Bank name');
assert.ok(bankPatterns.length >= 3, 'pattern pass includes banks');

const merged = mergeAndDeduplicateCandidates(bankPatterns, 'job1');
const macMerged = merged.filter((c) => c.entityKey === 'bank:macquarie');
assert.strictEqual(macMerged.length, 1, 'Macquarie aliases merge to one candidate');

const expanded = expandOccurrencesWithIr(merged, ir, () => []);
const macExp = expanded.find((c) => c.entityKey === 'bank:macquarie');
assert.ok(macExp.occurrenceCount >= 2, 'Macquarie + Macquarie Bank both located');

console.log('bankLexicon.test.js OK');
