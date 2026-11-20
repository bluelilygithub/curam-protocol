import { describe, expect, it } from 'vitest';
import { align } from '../src/compare/align';
import { classify, compareContent } from '../src/compare/content';
import { compareFormatting } from '../src/compare/formatting';
import { alignPages } from '../src/compare/layout';
import { normalize, ALL_RULES } from '../src/compare/normalize';
import { charDice, levenshtein, wordDice } from '../src/compare/textSim';
import { compareMetadata } from '../src/checks/metadata';
import { markdownReader } from '../src/readers/markdown';
import { textReader } from '../src/readers/text';
import type { Block, DocMetadata, Run } from '../src/readers/types';
import { SEVERITY } from '../src/report/severity';
import { DEFAULT_SETTINGS } from '../src/settings';

let n = 0;
const blk = (text: string, extra: Partial<Block> = {}): Block => ({ id: `t${n}`, type: 'paragraph', text, runs: [{ text }], location: { index: n++ }, ...extra });
const doc = (...texts: string[]) => { n = 0; return texts.map((t) => blk(t)); };
const LONG = (k: string) => `${k} paragraph that is long enough to have several distinct words in it for matching purposes`;

describe('normalize', () => {
  it('folds whitespace, quotes, dashes, NBSP and zero-width characters', () => {
    expect(normalize('  It’s “fine” — ok  now​  ', ALL_RULES)).toBe(`It's "fine" - ok now`);
  });
  it('leaves text alone when a rule is off', () => {
    expect(normalize('a  b', { ...ALL_RULES, whitespace: false })).toBe('a  b');
  });
});

describe('text similarity', () => {
  it('levenshtein / dice basics', () => {
    expect(levenshtein('receive', 'recieve')).toBe(2);
    expect(charDice('Payment Terms', 'Payment terms')).toBe(1);
    expect(wordDice('a b c d', 'a b c e')).toBe(0.75);
  });
});

describe('align', () => {
  it('pairs equal, removed, added and modified blocks in order', () => {
    const a = doc(LONG('First'), LONG('Second'), LONG('Third'));
    const b = doc(LONG('First'), LONG('Third changed'), LONG('Fourth new totally different words here'));
    const kinds = align(a, b).map((o) => o.kind);
    expect(kinds).toContain('equal');
    expect(kinds.filter((k) => k === 'removed').length + kinds.filter((k) => k === 'modified').length).toBeGreaterThan(0);
  });
  it('turns identical removed + added text into one move', () => {
    const a = doc('alpha one two three', 'beta four five six', 'gamma seven eight nine', 'delta ten eleven twelve');
    const b = doc('beta four five six', 'gamma seven eight nine', 'delta ten eleven twelve', 'alpha one two three');
    const ops = align(a, b);
    expect(ops.filter((o) => o.kind === 'moved')).toHaveLength(1);
    expect(ops.filter((o) => o.kind === 'removed' || o.kind === 'added')).toHaveLength(0);
  });
});

describe('classify', () => {
  it('single small substitution is a typo', () => expect(classify('we receive it', 'we recieve it').category).toBe('typo'));
  it('any digit change is a high-severity number change', () => expect(classify('within 30 days', 'within 60 days')).toMatchObject({ category: 'number', severity: 'high' }));
  it('other edits are wording', () => expect(classify('the quick brown fox', 'the slow red fox').category).toBe('wording'));
  it('dropping a large part of a paragraph is high severity', () => {
    const a = 'One two three four five six seven. Eight nine ten eleven twelve thirteen fourteen fifteen sixteen.';
    expect(classify(a, 'One two three four five six seven.').severity).toBe(SEVERITY.removed);
  });
  it('escapes HTML in the inline diff', () => expect(classify('<b>x</b>', '<b>y</b>').diffHtml).not.toContain('<b>'));
});

describe('formatting', () => {
  const runs = (...r: Run[]) => r;
  it('compares by character range, not run boundaries', () => {
    const a = blk('Hello world', { runs: runs({ text: 'Hel' }, { text: 'lo world' }) });
    const b = blk('Hello world', { runs: runs({ text: 'Hello world' }) });
    expect(compareFormatting(a, b)).toEqual({ structural: [], inline: [] });
  });
  it('reports bold removed on the affected words', () => {
    const a = blk('pay in 30 days', { runs: runs({ text: 'pay ' }, { text: 'in 30 days', bold: true }) });
    const b = blk('pay in 30 days');
    expect(compareFormatting(a, b).inline[0]).toBe('bold removed ("in 30 days")');
  });
  it('skips fields a reader could not supply', () => {
    const a = blk('x', { runs: [{ text: 'x', font: 'Arial' }] });
    const b = blk('x', { runs: [{ text: 'x' }] });
    expect(compareFormatting(a, b).inline).toEqual([]);
  });
  it('reports heading level as structural', () => {
    expect(compareFormatting(blk('T', { type: 'heading', level: 1 }), blk('T', { type: 'heading', level: 2 })).structural).toEqual(['Heading 1 → Heading 2']);
  });
});

describe('content', () => {
  it('counts whitespace-only differences as trivial', () => {
    const a = doc('Same  words here.'), b = doc('Same words here.');
    const { changes, trivialCount } = compareContent(align(a, b), DEFAULT_SETTINGS.trivial);
    expect(trivialCount).toBe(1);
    expect(changes.every((c) => c.trivial)).toBe(true);
  });
});

describe('metadata', () => {
  const meta = (o: Partial<DocMetadata>): DocMetadata => ({ fileName: 'a', fileSizeBytes: 1000, lastModified: new Date(0), wordCount: 100, charCount: 500, headingCount: 2, tableCount: 0, imageCount: 0, ...o });
  it('flags a word-count drop over 5% as high and a big size change', () => {
    const { changes } = compareMetadata(meta({}), meta({ wordCount: 90, fileSizeBytes: 500 }), DEFAULT_SETTINGS);
    expect(changes.find((c) => c.detail?.startsWith('Word count'))?.severity).toBe('high');
    expect(changes.some((c) => c.detail?.startsWith('File size'))).toBe(true);
  });
  it('does not flag fields neither reader supplied', () => {
    expect(compareMetadata(meta({}), meta({}), DEFAULT_SETTINGS).changes).toEqual([]);
  });
});

describe('readers', () => {
  it('markdown: headings, lists, emphasis, code, tables', async () => {
    const md = '# Title\n\nSome **bold** and [link](http://x).\n\n- one\n  - nested\n\n```js\ncode\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    const d = await markdownReader.read(new File([md], 'x.md'));
    expect(d.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'listItem', 'listItem', 'other', 'tableCell', 'tableCell', 'tableCell', 'tableCell']);
    expect(d.blocks[1].runs.find((r) => r.text === 'bold')?.bold).toBe(true);
    expect(d.blocks[3].level).toBe(2);
    expect(d.metadata.tableCount).toBe(1);
    expect(d.blocks[1].location.section).toBe('Title');
  });
  it('text: paragraphs split on blank lines', async () => {
    const d = await textReader.read(new File(['a\nwrapped\n\nb\r\n\r\nc'], 'x.txt'));
    expect(d.blocks.map((b) => b.text)).toEqual(['a\nwrapped', 'b', 'c']);
  });
});

describe('layout page alignment', () => {
  it('pairs 1:1 when counts match and by text otherwise', () => {
    const p = (number: number, text: string) => ({ number, text });
    expect(alignPages([p(1, 'a'), p(2, 'b')], [p(1, 'x'), p(2, 'y')])).toEqual([{ a: 1, b: 1 }, { a: 2, b: 2 }]);
    const r = alignPages([p(1, 'alpha beta gamma'), p(2, 'delta epsilon zeta'), p(3, 'eta theta iota')], [p(1, 'alpha beta gamma'), p(2, 'eta theta iota')]);
    expect(r).toEqual([{ a: 1, b: 1 }, { a: 2 }, { a: 3, b: 2 }]);
  });
});
