import { describe as group, expect, it } from 'vitest';
import { align } from '../src/compare/align';
import { sectionWordDrop } from '../src/compare/postChecks';
import { annotate } from '../src/compare/pipeline';
import { describe } from '../src/report/messages';
import { CATEGORY_LABEL, type Category, type Change } from '../src/report/model';
import { SEVERITY, TIER } from '../src/report/severity';
import { DEFAULT_SETTINGS } from '../src/settings';

const CTX = { settings: DEFAULT_SETTINGS, changes: [] };
import type { Block, NormalizedDoc } from '../src/readers/types';

const ch = (o: Partial<Change>): Change => ({ id: 1, category: 'wording', severity: 'medium', location: '1. Background, para 2', ...o });

// one change for every situation the catalogue words differently
const SAMPLES: Change[] = [
  ch({ category: 'removed', severity: 'high', group: 'section', original: '2. Evidence', children: [ch({}), ch({})] }),
  ch({ category: 'removed', severity: 'high', group: 'tableRow', location: 'Table 1, row 3' }),
  ch({ category: 'removed', severity: 'high', detail: 'Image removed' }),
  ch({ category: 'removed', severity: 'high', detail: 'Heading removed', original: '2. Evidence' }),
  ch({ category: 'removed', severity: 'high' }),
  ch({ category: 'added', group: 'section', edited: '5. New ideas' }),
  ch({ category: 'added', detail: 'Image added' }),
  ch({ category: 'added' }),
  ch({ category: 'moved', location: '1. Scope, para 2 → 4. Termination, para 3' }),
  ch({ category: 'number', severity: 'high', detail: '"42%" → "24%"' }),
  ch({ category: 'wording', trivial: true, severity: 'low' }),
  ch({ category: 'wording', severity: 'high' }),
  ch({ category: 'wording' }),
  ch({ category: 'typo', severity: 'low', detail: '"recieve" → "receive"' }),
  ch({ category: 'formatting', detail: 'Heading 2 → Heading 3' }),
  ch({ category: 'formatting', severity: 'low', detail: 'bold removed ("x")' }),
  ch({ category: 'layout', severity: 'low', location: 'Page 3', detail: '2.1% of the page changed' }),
  ch({ category: 'metadata', severity: 'high', detail: 'Word count dropped by 20.9%' }),
  ch({ category: 'metadata', severity: 'high', detail: 'Section "2. Evidence" lost 40% of its words' }),
  ch({ category: 'metadata', severity: 'low', detail: 'Author changed' }),
  ...(Object.keys(CATEGORY_LABEL) as Category[]).map((category) => ch({ category, severity: 'medium' })),
];

group('message catalogue', () => {
  it('every change gets a summary, why it matters and an action', () => {
    for (const c of SAMPLES) {
      const m = describe(c);
      expect(m.summary.length, `${c.category} summary`).toBeGreaterThan(10);
      expect(m.whyItMatters.length, `${c.category} why`).toBeGreaterThan(10);
      expect(m.action.length, `${c.category} action`).toBeGreaterThan(5);
    }
  });
  it('never says a document is safe, correct or verified (addendum §0)', () => {
    for (const c of SAMPLES) expect(Object.values(describe(c)).join(' '), c.category).not.toMatch(/\b(safe|correct|verified)\b/i);
  });
  it('uses Australian spelling', () => {
    expect(SAMPLES.map((c) => Object.values(describe(c)).join(' ')).join(' ')).not.toMatch(/\b(color|organize|analyze|center|behavior|recognize)\b/i);
  });
  it('names the specific thing', () => {
    expect(describe(SAMPLES[0]).summary).toBe('The LLM removed the whole section "2. Evidence" (2 parts).');
    expect(describe(SAMPLES[4]).summary).toBe('The LLM removed a paragraph from "1. Background".');
    expect(describe(SAMPLES[9]).summary).toBe('The LLM changed a figure in "1. Background": "42%" → "24%".');
  });
});

group('tiers', () => {
  it('map red/amber/info onto the severities, with the addendum re-tiering', () => {
    expect(TIER).toEqual({ high: 'red', medium: 'amber', low: 'info' });
    expect([SEVERITY.removed, SEVERITY.removedSection, SEVERITY.removedTableRow, SEVERITY.number, SEVERITY.wordCountDrop, SEVERITY.sectionWordDrop]).toEqual(Array(6).fill('high'));
    expect([SEVERITY.wording, SEVERITY.moved, SEVERITY.structure]).toEqual(Array(3).fill('medium'));
    expect([SEVERITY.typo, SEVERITY.inlineFormat, SEVERITY.layout, SEVERITY.metadataWarning, SEVERITY.metadataInfo]).toEqual(Array(5).fill('low'));
  });
  it('annotate adds tier, message and origin', () => {
    const a = annotate({ category: 'removed', severity: 'high', location: 'X, para 1' });
    expect(a).toMatchObject({ tier: 'red', origin: 'removed', action: 'Restore this text, or accept the removal if you meant to cut it.' });
    expect(annotate({ category: 'typo', severity: 'low', location: 'x', detail: '"a" → "b"' })).toMatchObject({ tier: 'info', origin: 'changed' });
  });
});

let n = 0;
const blk = (text: string, extra: Partial<Block> = {}): Block => ({ id: `b${n}`, type: 'paragraph', text, runs: [{ text }], location: { index: n++ }, ...extra });
const docOf = (blocks: Block[]): NormalizedDoc => ({ kind: 'document', sourceType: 'md', blocks: blocks.map((b, i) => ({ ...b, location: { ...b.location, index: i } })), metadata: { fileName: 'x', fileSizeBytes: 1, lastModified: new Date(0), wordCount: 0, charCount: 0, headingCount: 0, tableCount: 0, imageCount: 0 } });
const LONG = 'Families who are forced to move often lose contact with schools, doctors and support networks, and children suffer when they change schools during the year.';
const LONG2 = 'Older renters face particular difficulty, because they are less likely to find new housing close to the family and community services they depend on.';

group('tightened paragraphs', () => {
  it('a paragraph cut down to its first words pairs as modified, not removed + added', () => {
    const ops = align(docOf([blk(LONG2)]).blocks, docOf([blk('Older renters face particular difficulty.')]).blocks);
    expect(ops.map((o) => o.kind)).toEqual(['modified']);
  });
  it('one section losing over 15% of its words is red; a removal there already explains it', () => {
    n = 0;
    const head = blk('Impact', { type: 'heading', level: 2 });
    const a = docOf([head, blk(LONG, { location: { index: 0, section: 'Impact' } }), blk(LONG2, { location: { index: 0, section: 'Impact' } })]);
    const b = docOf([head, blk('Families who are forced to move often lose contact with schools.', { location: { index: 0, section: 'Impact' } }), blk('Older renters face particular difficulty.', { location: { index: 0, section: 'Impact' } })]);
    const found = sectionWordDrop(a, b, align(a.blocks, b.blocks), CTX);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'high', detail: expect.stringMatching(/^Section "Impact" lost \d+% of its words$/) });
    const c = docOf([head, blk(LONG, { location: { index: 0, section: 'Impact' } })]);
    expect(sectionWordDrop(a, c, align(a.blocks, c.blocks), CTX)).toEqual([]);
  });
});
