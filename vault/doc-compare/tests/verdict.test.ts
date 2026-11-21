import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it } from 'vitest';
import { annotate } from '../src/compare/pipeline';
import { buildReportPdf } from '../src/report/pdfExport';
import { authorItems } from '../src/report/authorReport';
import type { Change } from '../src/report/model';
import { memoryStore } from '../src/review/decisions';
import { ACCURACY_NOTE, VERDICT_TEXT, decisionsSummary, itemKey, progress, reviewItems, summarySentence, verdictOf, type Decisions } from '../src/review/verdict';

let id = 0;
const ch = (o: Partial<Change>): Change => ({ ...annotate({ category: 'wording', severity: 'medium', location: '1. Background, para 2', ...o } as Change), id: ++id }) as Change;
const at = '2026-11-21T00:00:00.000Z';

const removed = ch({ category: 'removed', severity: 'high', original: 'A caveat about the data.' });
const number = ch({ category: 'number', severity: 'high', detail: '"42%" → "24%"', original: 'Around 42% of households', edited: 'Around 24% of households' });
const reworded = ch({ category: 'wording', severity: 'medium', original: 'a b c', edited: 'a x c' });
const reworded2 = ch({ category: 'wording', severity: 'medium', location: '2. Evidence, para 1', original: 'd e f', edited: 'd y f' });
const typo = ch({ category: 'typo', severity: 'low', detail: '"recieve" → "receive"' });
const trivial = ch({ category: 'wording', severity: 'low', trivial: true });
const CHANGES = [typo, reworded, removed, trivial, number, reworded2];

describe('review queue', () => {
  it('lists red then amber; info and trivial stay under Show all changes', () => {
    expect(reviewItems(CHANGES).map((i) => i.change.id)).toEqual([removed.id, number.id, reworded.id, reworded2.id]);
  });
  it('item keys are stable across re-runs (they do not use the change number)', () => {
    expect(itemKey({ ...removed, id: 99 })).toBe(itemKey(removed));
    expect(itemKey(removed)).not.toBe(itemKey(number));
  });
});

describe('verdict transitions as decisions are made', () => {
  const k = (c: Change) => itemKey(c);
  it('red while a red item is open or marked Fix later, then amber, then green', () => {
    const d: Decisions = {};
    expect(verdictOf(reviewItems(CHANGES, d))).toBe('red');
    d[k(removed)] = { decision: 'restore', decidedAt: at };
    expect(verdictOf(reviewItems(CHANGES, d))).toBe('red'); // the number change is still open
    d[k(number)] = { decision: 'later', decidedAt: at };
    expect(verdictOf(reviewItems(CHANGES, d))).toBe('red'); // Fix later keeps it red
    d[k(number)] = { decision: 'accept', decidedAt: at };
    expect(verdictOf(reviewItems(CHANGES, d))).toBe('amber');
    d[k(reworded)] = { decision: 'accept', decidedAt: at };
    d[k(reworded2)] = { decision: 'accept', decidedAt: at };
    expect(verdictOf(reviewItems(CHANGES, d))).toBe('green');
    expect(progress(reviewItems(CHANGES, d))).toEqual({ decided: 4, total: 4, openRed: 0 });
  });
  it('only info changes: green', () => expect(verdictOf(reviewItems([typo, trivial]))).toBe('green'));
});

describe('wording', () => {
  it('the summary sentence counts what happened', () => {
    expect(summarySentence(CHANGES)).toBe('The LLM removed 1 paragraph, changed 1 figure and reworded 2 paragraphs.');
    expect(summarySentence([typo])).toBe('The LLM made no changes that need your attention.');
    const drop = ch({ category: 'metadata', severity: 'high', detail: 'Word count dropped by 8.0%' });
    const sect = ch({ category: 'metadata', severity: 'high', detail: 'Section "2. Evidence" lost 40% of its words' });
    expect(summarySentence([removed, drop])).toBe('The LLM removed 1 paragraph. The edited version is also 8% shorter overall.');
    expect(summarySentence([removed, drop, sect])).toBe('The LLM removed 1 paragraph. The edited version is also 8% shorter overall, and 1 section lost more than 15% of its words.');
    expect(summarySentence([reworded, sect])).toBe('The LLM reworded 1 paragraph. Also, 1 section lost more than 15% of its words.');
  });
  it('no verdict wording says safe, correct or verified (addendum §9)', () => {
    const all = [...Object.values(VERDICT_TEXT).map((v) => v.title), ACCURACY_NOTE, summarySentence(CHANGES), summarySentence([]), decisionsSummary(reviewItems(CHANGES))].join(' ');
    expect(all).not.toMatch(/\b(safe|correct|verified)\b/i);
  });
  it('decisions summary', () => {
    expect(decisionsSummary(reviewItems(CHANGES, { [itemKey(removed)]: { decision: 'restore', decidedAt: at }, [itemKey(number)]: { decision: 'later', decidedAt: at } })))
      .toBe('1 to restore, 1 left to fix later, 2 not yet decided');
  });
});

describe('decisions survive a reload', () => {
  it('saved decisions load back for the same pair of files', async () => {
    const s = memoryStore();
    await s.save('pair:a:b', { [itemKey(removed)]: { decision: 'accept', decidedAt: at } });
    expect((await s.load('pair:a:b'))[itemKey(removed)]?.decision).toBe('accept');
    expect(await s.load('pair:a:c')).toEqual({});
  });
});

async function pdfText(bytes: ArrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => (i as TextItem).str).join(' '));
  return pages;
}
const report = (decisions: Decisions) => buildReportPdf({
  result: { changes: CHANGES, trivialCount: 1, metadata: [] }, layoutChanges: [], layout: { pages: [] }, sim: { score: 90, headingScore: 1, overlapScore: 1, structureScore: 1, reasons: [] },
  override: false, settings: { similarityThreshold: 60, layoutPixelRatio: 0.005 }, fileNames: ['a.docx', 'b.docx'], all: CHANGES, visible: CHANGES, filtersNote: '', landscape: false, decisions,
});

describe('the report', () => {
  it('page 1 has the verdict, sentence, accuracy note and decisions; then Full detail', async () => {
    const pages = await pdfText(report({}).output('arraybuffer'));
    expect(pages[0]).toMatch(/Not ready to submit/);
    expect(pages[0]).toMatch(/The LLM removed 1 paragraph/);
    expect(pages[0]).toMatch(/doesn't check whether the content is accurate/);
    expect(pages[0]).toMatch(/Not decided/);
    expect(pages.join(' ')).toMatch(/Full detail/);
  });
  it('every page carries the watermark while a red item is open, and none once all red items are decided', async () => {
    const open = await pdfText(report({}).output('arraybuffer'));
    for (const p of open) expect(p).toMatch(/UNRESOLVED ISSUES - NOT READY TO SUBMIT/);
    const later = await pdfText(report({ [itemKey(removed)]: { decision: 'restore', decidedAt: at }, [itemKey(number)]: { decision: 'later', decidedAt: at } }).output('arraybuffer'));
    for (const p of later) expect(p).toMatch(/UNRESOLVED ISSUES/);
    const done = await pdfText(report({ [itemKey(removed)]: { decision: 'restore', decidedAt: at }, [itemKey(number)]: { decision: 'accept', decidedAt: at } }).output('arraybuffer'));
    for (const p of done) expect(p).not.toMatch(/UNRESOLVED ISSUES/);
    expect(done[0]).toMatch(/Review recommended/);
  });
  it('the review for the author leaves out accepted changes', () => {
    expect(authorItems(CHANGES, { [itemKey(reworded)]: { decision: 'accept', decidedAt: at } }).map((c) => c.id)).not.toContain(reworded.id);
    expect(authorItems(CHANGES, { [itemKey(removed)]: { decision: 'restore', decidedAt: at } }).map((c) => c.id)).toContain(removed.id);
  });
});
