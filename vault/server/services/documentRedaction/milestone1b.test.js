'use strict';

/**
 * Prompt 1.5 — pattern currency/% coverage + category-agnostic merge.
 * Run: node server/services/documentRedaction/milestone1b.test.js
 */

const assert = require('assert');
const JSZip = require('jszip');
const { parseDocxBuffer, findOccurrences } = require('./docxParse');
const { extractPatternCandidates } = require('./patternCandidates');
const {
  mergeAndDeduplicateCandidates,
  expandOccurrencesWithIr,
  entityKeyFor,
  normalizeEntity,
  isPlaceholderReplacement,
} = require('./mergeCandidates');
const { normalizeCategoryLabel, pickPreferredCategory } = require('./categories');

async function buildDocx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  </Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  </Relationships>`);
  const body = paragraphs.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('');
  zip.folder('word').file('document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

const DOLLARS = [
  '$1,173,624', '$1,196,242', '$1,159,488',
  '$10,000', '$500,000', '$12,400',
  '$2,450.75', '$99', '$1,000,000', '$850,000',
  '$3,210', '$45,000', '$67,890', '$100,000',
  '$250,000', '$7,500', '$15,750', '$22,000',
  '$333,333', '$999,999',
];

const PERCENTS = [
  '5.29%', '4.5%', '6%', '3.25%', '7.10%',
  '2.00%', '8.75%', '1.5%', '9.99%', '0.25%',
];

async function testPatternExhaustiveCurrencyAndPercents() {
  const lines = [
    `Bank capacities: ${DOLLARS.slice(0, 10).join(' | ')}`,
    `More figures: ${DOLLARS.slice(10).join(' · ')}`,
    `Stress rates: ${PERCENTS.join(' / ')}`,
  ];
  const ir = await parseDocxBuffer(await buildDocx(lines));
  const patterns = extractPatternCandidates(ir, 'job-figures');

  const patternOnly = patterns.filter((c) => c.source === 'deterministic' && c.sourceLabel === 'pattern-match');
  assert.ok(patternOnly.length > 0, 'pattern-match candidates should exist');

  const foundDollars = new Set(
    patternOnly
      .filter((c) => String(c.surfaceForms?.[0] || '').includes('$'))
      .map((c) => c.surfaceForms[0]),
  );
  const foundPercents = new Set(
    patternOnly
      .filter((c) => String(c.surfaceForms?.[0] || '').includes('%'))
      .map((c) => c.surfaceForms[0].replace(/\s+/g, '')),
  );

  const missingDollars = DOLLARS.filter((d) => !foundDollars.has(d));
  const missingPercents = PERCENTS.filter((p) => !foundPercents.has(p));

  assert.strictEqual(
    missingDollars.length,
    0,
    `pattern-match missed dollars: ${missingDollars.join(', ')} (found ${foundDollars.size}/${DOLLARS.length})`,
  );
  assert.strictEqual(
    missingPercents.length,
    0,
    `pattern-match missed percents: ${missingPercents.join(', ')} (found ${foundPercents.size}/${PERCENTS.length})`,
  );

  // Merge with empty LLM list — all should remain pattern-match
  const merged = mergeAndDeduplicateCandidates(patternOnly, 'job-figures');
  const mergedDollars = DOLLARS.filter((d) => merged.some((c) => (c.surfaceForms || []).includes(d) || c.entityText === d));
  assert.strictEqual(mergedDollars.length, DOLLARS.length, 'merged list must keep every dollar from pattern-match');

  return {
    patternCount: patternOnly.length,
    dollarCount: foundDollars.size,
    percentCount: foundPercents.size,
    mergedCount: merged.length,
  };
}

function testCategoryAgnosticMergeQaExamples() {
  // BEFORE bug: same value under two categories → 2 candidates
  // AFTER: exactly 1, specific category wins, placeholder replacement discarded
  const examples = [
    {
      value: '$1,173,624',
      a: { categoryLabel: 'financial figure', suggestedReplacement: '$[redacted]' },
      b: { categoryLabel: 'Capacity Amount', suggestedReplacement: '$1,100,000' },
      expectCategory: 'Capacity amount',
      expectReplacement: '$1,100,000',
    },
    {
      value: '$10,000',
      a: { categoryLabel: 'financial figure', suggestedReplacement: '$X,XXX' },
      b: { categoryLabel: 'Credit Card Limit', suggestedReplacement: '$9,500' },
      expectCategory: 'Credit card limit',
      expectReplacement: '$9,500',
    },
    {
      value: '$500,000',
      a: { categoryLabel: 'Loan Amount', suggestedReplacement: '$480,000' },
      b: { categoryLabel: 'financial figure', suggestedReplacement: '$NNN,NNN' },
      expectCategory: 'Loan amount',
      expectReplacement: '$480,000',
    },
  ];

  const beforeCounts = {};
  const after = {};

  for (const ex of examples) {
    const loc = {
      part: 'body',
      paragraphId: 'body-p-0',
      runId: 'body-p-0-r-0',
      startOffset: 0,
      endOffset: ex.value.length,
      quote: ex.value,
    };
    const stubs = [
      {
        id: 'a',
        source: 'local_llm',
        sourceLabel: 'llm',
        categoryLabel: ex.a.categoryLabel,
        surfaceForms: [ex.value],
        locations: [loc],
        confidence: 0.7,
        suggestedReplacement: ex.a.suggestedReplacement,
        rationale: `generic ${ex.a.categoryLabel}`,
      },
      {
        id: 'b',
        source: 'local_llm',
        sourceLabel: 'llm',
        categoryLabel: ex.b.categoryLabel,
        surfaceForms: [ex.value],
        locations: [loc],
        confidence: 0.9,
        suggestedReplacement: ex.b.suggestedReplacement,
        rationale: `specific ${ex.b.categoryLabel}`,
      },
    ];

    // Simulate old key behaviour count
    const oldKeys = new Set(stubs.map((c) => {
      const n = String(c.surfaceForms[0]).toLowerCase();
      const cat = String(c.categoryLabel || '').toLowerCase().replace(/\s+/g, '_');
      return `${cat}::${n}`;
    }));
    beforeCounts[ex.value] = oldKeys.size;

    const merged = mergeAndDeduplicateCandidates(stubs, 'job-qa');
    assert.strictEqual(
      merged.length,
      1,
      `${ex.value} should merge to 1 candidate, got ${merged.length}`,
    );
    const c = merged[0];
    assert.strictEqual(c.categoryLabel, ex.expectCategory, `${ex.value} category`);
    assert.strictEqual(c.suggestedReplacement, ex.expectReplacement, `${ex.value} replacement`);
    assert.ok(
      String(c.rationale || '').includes('|'),
      `${ex.value} should pipe-join rationales: ${c.rationale}`,
    );
    assert.ok(!isPlaceholderReplacement(c.suggestedReplacement), 'must not keep placeholder');
    after[ex.value] = {
      count: merged.length,
      categoryLabel: c.categoryLabel,
      suggestedReplacement: c.suggestedReplacement,
      entityKey: c.entityKey,
      rationale: c.rationale,
    };
  }

  return { beforeCounts, after };
}

function testCategoryCasingNormalization() {
  const variants = [
    ['bank name', 'Bank name'],
    ['Bank Name', 'Bank name'],
    ['interest rate', 'Interest rate'],
    ['Interest Rate', 'Interest rate'],
    ['Interest rate', 'Interest rate'],
    ['banking product', 'Banking product'],
    ['Banking Product', 'Banking product'],
    ['Banking product', 'Banking product'],
  ];
  for (const [raw, expected] of variants) {
    assert.strictEqual(normalizeCategoryLabel(raw), expected, raw);
  }
  assert.strictEqual(
    pickPreferredCategory('financial figure', 'Capacity Amount'),
    'Capacity amount',
  );
  assert.strictEqual(entityKeyFor('$1,173,624', 'Financial figure'), entityKeyFor('$1,173,624', 'Capacity amount'));
  assert.strictEqual(normalizeEntity('$1,173,624'), 'amt:1173624');
  assert.strictEqual(normalizeEntity('5.29%'), 'pct:5.29%');
}

async function testPatternPlusLlmSameAmountMergesOnce() {
  const ir = await parseDocxBuffer(await buildDocx([
    'Capacity A $1,173,624 Capacity B $1,196,242 Capacity C $1,159,488',
  ]));
  const patterns = extractPatternCandidates(ir, 'job-mix');
  const llmStub = [{
    id: 'llm-cap',
    source: 'local_llm',
    sourceLabel: 'llm',
    categoryLabel: 'Capacity Amount',
    surfaceForms: ['$1,173,624'],
    locations: findOccurrences(ir, '$1,173,624').slice(0, 1),
    confidence: 0.92,
    suggestedReplacement: '$1,100,000',
    rationale: 'Bank capacity cell',
  }, {
    id: 'llm-fin',
    source: 'local_llm',
    sourceLabel: 'llm',
    categoryLabel: 'financial figure',
    surfaceForms: ['$1,173,624'],
    locations: findOccurrences(ir, '$1,173,624').slice(0, 1),
    confidence: 0.6,
    suggestedReplacement: '$[redacted]',
    rationale: 'Generic amount',
  }];

  let merged = mergeAndDeduplicateCandidates([...patterns, ...llmStub], 'job-mix');
  merged = expandOccurrencesWithIr(merged, ir, findOccurrences);

  const hits1173 = merged.filter((c) => (c.surfaceForms || []).some((s) => s.includes('1,173,624')));
  assert.strictEqual(hits1173.length, 1, `expected 1 candidate for $1,173,624, got ${hits1173.length}`);
  assert.strictEqual(hits1173[0].categoryLabel, 'Capacity amount');
  assert.strictEqual(hits1173[0].suggestedReplacement, '$1,100,000');

  // Pattern-only amounts LLM missed must still be present
  for (const miss of ['$1,196,242', '$1,159,488']) {
    const hit = merged.find((c) => (c.surfaceForms || []).includes(miss) || c.entityText === miss);
    assert.ok(hit, `pattern should have caught LLM-missed ${miss}`);
    assert.ok(
      hit.source === 'deterministic' || hit.sourceLabel === 'pattern-match',
      `${miss} should be pattern-match sourced, got ${hit.source}/${hit.sourceLabel}`,
    );
  }

  return {
    totalMerged: merged.length,
    patternLabelCount: merged.filter((c) => c.sourceLabel === 'pattern-match').length,
    example1173: {
      categoryLabel: hits1173[0].categoryLabel,
      replacement: hits1173[0].suggestedReplacement,
      sourceLabel: hits1173[0].sourceLabel,
    },
  };
}

async function run() {
  testCategoryCasingNormalization();
  const figures = await testPatternExhaustiveCurrencyAndPercents();
  const qa = testCategoryAgnosticMergeQaExamples();
  const mix = await testPatternPlusLlmSameAmountMergesOnce();

  console.log('OK milestone1b tests');
  console.log(JSON.stringify({
    bug1_patternFigures: figures,
    bug2_qaMerge: qa,
    bug1_and_2_mixed: mix,
    bug4_note: 'Known-alias unification (Macquarie vs Macquarie Bank, CommBank vs Commonwealth Bank, BOQ vs Bank of Queensland) is NOT fixed here — follow-up entity-resolution ticket.',
  }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
