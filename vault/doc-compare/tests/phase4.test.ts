import { beforeAll, describe, expect, it } from 'vitest';
import { numberLabel } from '../src/checks/numbering';
import { AU_TO_US, US_TO_AU } from '../src/checks/spelling';
import { acronymDefinitions, findTerms } from '../src/checks/terms';
import { compareDocs } from '../src/compare/pipeline';
import { readPair } from '../src/compare/read';
import { summarySentence } from '../src/review/verdict';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { buildFixtures } from './fixtures/generate.mjs';

type Fixture = Awaited<ReturnType<typeof buildFixtures>>[number];
let fixtures: Fixture[] = [];
beforeAll(async () => { fixtures = await buildFixtures(); }, 60000);
const file = (f: { name: string; bytes: Uint8Array }) => new File([f.bytes.slice()], f.name, { lastModified: Date.UTC(2026, 0, 1) });
const read = (name: string) => { const f = fixtures.find((x) => x.name === name)!; return readPair(file(f.original), file(f.edited)); };
const run = async (name: string, s: Partial<Settings> = {}) => { const [a, b] = await read(name); return { a, b, r: compareDocs(a, b, { ...DEFAULT_SETTINGS, ...s }) }; };

describe('readers: footnotes and numbering', () => {
  it.each(['docx', 'md', 'pdf'])('reads the footnote and the mark that points to it (%s)', async (type) => {
    const [a] = await read(`uc08-footnote-removed.${type}`);
    expect(a.notes).toHaveLength(1);
    expect(a.notes![0]).toMatchObject({ kind: 'footnote', label: '1', text: 'Private rental data from the NSW Rental Bond Board, June 2023.' });
    expect(a.blocks.find((b) => b.notes?.includes(a.notes![0].id))?.text).toMatch(/^These figures cover/);
    expect(a.notesBestEffort ?? false).toBe(type === 'pdf');
  });
  it.each(['docx', 'md'])('renders automatic list numbers (%s)', async (type) => {
    const [a, b] = await read(`uc10-list-renumbered.${type}`);
    expect(a.blocks.filter((x) => x.number).map((x) => x.number)).toEqual(['1.', '2.', '3.']);
    expect(b.blocks.filter((x) => x.number).map((x) => x.number)).toEqual(['1.', '2.']);
  });
});

describe('numbers at the start of a paragraph', () => {
  it('reads list labels, captions and leaves years alone', () => {
    expect(numberLabel('2023 was a hard year').num).toBeUndefined();
    expect(numberLabel('12 months later').num).toBeUndefined();
    expect(numberLabel('3. Fund tenant advocacy').num).toMatchObject({ kind: 'decimal', parts: [3] });
    expect(numberLabel('2.4 Costs').num).toMatchObject({ kind: 'decimal', parts: [2, 4] });
    expect(numberLabel('(iv) the fourth').num).toMatchObject({ kind: 'roman', parts: [4] });
    expect(numberLabel('(c) the third').num).toMatchObject({ kind: 'alpha', parts: [3] });
    expect(numberLabel('Figure 3: Rents').num).toMatchObject({ kind: 'figure', label: 'Figure 3' });
  });
  it('a paragraph that only changed its number is renumbering, not a changed figure', async () => {
    const { r } = await run('uc10-renumbered.docx');
    expect(r.changes.some((c) => c.category === 'number')).toBe(false);
    expect(r.changes.find((c) => c.category === 'numbering')?.children).toHaveLength(1);
  });
});

describe('spelling list', () => {
  it('has about 300 or more pairs, and no word on both sides', () => {
    expect(AU_TO_US.size).toBeGreaterThanOrEqual(300);
    for (const w of AU_TO_US.keys()) expect(US_TO_AU.has(w), w).toBe(false);
    expect(AU_TO_US.get('organisations')).toBe('organizations');
    expect(AU_TO_US.get('colourful')).toBe('colorful');
    expect(AU_TO_US.get('analysed')).toBe('analyzed');
    for (const ambiguous of ['program', 'programme', 'licence', 'license', 'practise', 'judgement', 'enquiry']) expect(AU_TO_US.has(ambiguous) || US_TO_AU.has(ambiguous), ambiguous).toBe(false);
  });
  it('a document with no clear standard is not checked', async () => {
    const { r } = await run('uc04-invented-claims.md');
    expect(r.changes.some((c) => c.category === 'spelling')).toBe(false);
  });
  it('reports one grouped amber change with a child per word', async () => {
    const { r } = await run('uc12-spelling-switched.md');
    const s = r.changes.find((c) => c.category === 'spelling')!;
    expect(s).toMatchObject({ severity: 'medium', tier: 'amber' });
    expect(s.children).toHaveLength(9);
    expect(s.summary).toBe('The LLM switched the spelling from Australian to US in 9 places (9 words).');
  });
});

describe('terminology', () => {
  it('finds acronyms with their expansion, defined terms and repeated phrases', () => {
    expect([...acronymDefinitions('This submission from the Tenants Advice Network (TAN) responds.')]).toEqual([['TAN', 'Tenants Advice Network']]);
    expect(acronymDefinitions('the rules (ABC) apply').size).toBe(0);
  });
  it('a glossary term the edited version drops is reported', async () => {
    const [a] = await read('uc12-defined-term-replaced.md');
    expect(findTerms(a, ['private rental market']).find((t) => t.kind === 'glossary')).toBeTruthy();
    const { r } = await run('uc01-caveat-dropped.md', { glossary: ['private rental market'] });
    expect(r.changes.find((c) => c.category === 'terminology')?.detail).toBe('Glossary term "private rental market" is no longer used (1× in the original)');
  });
});

describe('references in the results', () => {
  it('the verdict sentence counts references and citations', async () => {
    const { r } = await run('uc08-reference-removed.md');
    expect(summarySentence(r.changes)).toBe('The LLM removed 1 reference. 1 citation no longer points to the right source.');
  });
  it('an added reference counts as a claim', async () => {
    const { r } = await run('uc08-reference-invented.md');
    expect(summarySentence(r.changes)).toBe('The LLM added 1 claim that needs checking.');
  });
  it('a removed reference is one card, not also a removed paragraph', async () => {
    const { r } = await run('uc08-reference-removed.docx');
    expect(r.changes.filter((c) => c.category === 'removed')).toHaveLength(0);
  });
  it('File details count references and footnotes', async () => {
    const { r } = await run('uc08-reference-removed.md');
    expect(r.metadata.find((m) => m.label === 'References')).toMatchObject({ original: '2', edited: '1' });
    const f = await run('uc08-footnote-removed.docx');
    expect(f.r.metadata.find((m) => m.label === 'Footnotes and endnotes')).toMatchObject({ original: '1', edited: '0' });
  });
  it('footnotes count towards the word total unless Settings says not to', async () => {
    const on = (await run('uc08-footnote-removed.docx')).r.words!;
    const off = (await run('uc08-footnote-removed.docx', { includeFootnotes: false })).r.words!;
    expect(on.original - off.original).toBe(11); // the footnote is 11 words
    expect(on.edited).toBe(off.edited);
  });
});
