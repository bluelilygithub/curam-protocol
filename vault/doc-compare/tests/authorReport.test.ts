import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { beforeAll, describe, expect, it } from 'vitest';
import { compareDocs } from '../src/compare/pipeline';
import { readPair } from '../src/compare/read';
import { actionFor, authorItems, buildAuthorPdf } from '../src/report/authorReport';
import type { Change } from '../src/report/model';
import { DEFAULT_SETTINGS } from '../src/settings';
import { buildFixtures } from './fixtures/generate.mjs';

type Fixture = Awaited<ReturnType<typeof buildFixtures>>[number];
let fixtures: Fixture[] = [];
beforeAll(async () => { fixtures = await buildFixtures(); }, 60000);

const file = (f: { name: string; bytes: Uint8Array }) => new File([f.bytes.slice()], f.name);
async function changesOf(name: string) {
  const f = fixtures.find((x) => x.name === name)!;
  const [a, b] = await readPair(file(f.original), file(f.edited));
  return { r: compareDocs(a, b, DEFAULT_SETTINGS), names: [f.original.name, f.edited.name] as [string, string] };
}
async function pdfText(bytes: ArrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) text += (await (await doc.getPage(p)).getTextContent()).items.map((i) => (i as TextItem).str).join(' ') + '\n';
  return { text, pages: doc.numPages };
}

const ch = (o: Partial<Change>): Change => ({ id: 1, category: 'wording', severity: 'medium', location: 'Scope, para 1', ...o });

describe('actionFor', () => {
  it('says what to do for each kind of change', () => {
    // addendum §2: the wording now comes from messages.ts and offers "accept the removal" (was "(2 items, listed below)")
    expect(actionFor(ch({ category: 'removed', severity: 'high', group: 'section', original: '4. Termination', children: [ch({}), ch({})] }))).toMatch(/^Restore the missing section "4\. Termination" and everything under it, or accept the removal/);
    expect(actionFor(ch({ category: 'removed', severity: 'high', group: 'tableRow' }))).toMatch(/missing table row/);
    expect(actionFor(ch({ category: 'removed', severity: 'high' }))).toMatch(/^Restore this text/);
    expect(actionFor(ch({ category: 'added' }))).toMatch(/^Confirm this added text/);
    expect(actionFor(ch({ category: 'number', severity: 'high', detail: '"30" → "60"' }))).toBe('Check the changed figure: "30" → "60". Restore the original value unless the change was intended.');
    expect(actionFor(ch({ category: 'wording', severity: 'high' }))).toMatch(/dropped/);
    expect(actionFor(ch({ category: 'typo', severity: 'low', detail: '"recieve" → "receive"' }))).toMatch(/spelling change/);
    expect(actionFor(ch({ category: 'formatting', severity: 'low', detail: 'bold removed ("x")' }))).toMatch(/bold removed/);
    expect(actionFor(ch({ category: 'moved', location: 'A → B' }))).toMatch(/put it back/);
  });
});

describe('authorItems', () => {
  it('lists every real change most serious first, without trivial ones or informational file details', () => {
    const list = authorItems([
      ch({ id: 1, category: 'typo', severity: 'low' }),
      ch({ id: 2, category: 'wording', severity: 'low', trivial: true }),
      ch({ id: 3, category: 'removed', severity: 'high' }),
      ch({ id: 4, category: 'metadata', severity: 'low', detail: 'Author changed' }),
      ch({ id: 5, category: 'metadata', severity: 'high', detail: 'Word count dropped by 20%' }),
      ch({ id: 6, category: 'wording', severity: 'medium' }),
    ]);
    expect(list.map((c) => c.id)).toEqual([3, 5, 6, 1]);
  });
});

describe('the PDF', () => {
  it('a removed section: summary, Must fix, the instruction and the missing text', async () => {
    const { r, names } = await changesOf('section-removed.docx');
    const doc = await buildAuthorPdf({ changes: r.changes, trivialCount: r.trivialCount, fileNames: names, similarity: 83, override: false });
    const { text, pages } = await pdfText(doc.output('arraybuffer'));
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(text).toMatch(/Review of the edited document/);
    expect(text).toMatch(/Must fix \(\d+\)/);
    expect(text).toMatch(/Restore the missing section "4\. Termination"/);
    expect(text).toMatch(/On termination the Client pays/);
    expect(text.match(/On termination the Client pays/g)).toHaveLength(1); // the section's contents are listed once
    expect(text).toMatch(/Page 1 of \d+/);
  });
  it('a number change shows the old and new value and both are in the word diff', async () => {
    const { r, names } = await changesOf('number-changed.md');
    const { text } = await pdfText((await buildAuthorPdf({ changes: r.changes, trivialCount: r.trivialCount, fileNames: names, similarity: 99, override: false })).output('arraybuffer'));
    expect(text).toMatch(/Check the changed figure: "30" → "60"/);
    expect(text).not.toMatch(/\?/);
    expect(text).toMatch(/\b30\b[\s\S]*\b60\b/);
  });
  it('identical files: says nothing needs action', async () => {
    const { r, names } = await changesOf('identical.txt');
    const { text } = await pdfText((await buildAuthorPdf({ changes: r.changes, trivialCount: r.trivialCount, fileNames: names, similarity: 100, override: false })).output('arraybuffer'));
    expect(text).toMatch(/No changes need action/);
  });
  it('a long document wraps onto more pages', async () => {
    const many: Change[] = Array.from({ length: 60 }, (_, i) => ch({ id: i + 1, category: 'removed', severity: 'high', original: 'A long missing paragraph. '.repeat(30) }));
    const { pages } = await pdfText((await buildAuthorPdf({ changes: many, trivialCount: 0, fileNames: ['a.docx', 'b.docx'], similarity: 90, override: false })).output('arraybuffer'));
    expect(pages).toBeGreaterThan(5);
  });
});
