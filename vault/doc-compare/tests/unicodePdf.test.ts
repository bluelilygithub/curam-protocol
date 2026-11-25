import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it, vi } from 'vitest';
import { buildAuthorPdf } from '../src/report/authorReport';
import type { Change, ComparisonResult } from '../src/report/model';
import { buildReportPdf } from '../src/report/pdfExport';

// Both exported PDFs print every character (Unicode fonts, src/report/pdfFonts.ts): no "?" stand-ins.
const NAME = 'Zoë Müller and José Łukasz Dvořák';
const ORIGINAL = `“The project” — led by ${NAME} — covers 张伟的研究 and ‘café’ costs.`;
const EDITED = `“The project” – led by ${NAME} – covers 张伟的研究报告 and ‘café’ costs.`;
const MUST_PRINT = ['“The project”', '—', '–', 'Zoë Müller', 'José Łukasz Dvořák', '张伟的研究', '‘café’'];

const changes: Change[] = [
  { id: 1, category: 'wording', severity: 'medium', location: 'Résumé — para 1', original: ORIGINAL, edited: EDITED, summary: `Wording changed in “Résumé” for ${NAME}`, diffHtml: `<del>“The project” —</del><ins>“The project” –</ins> led by ${NAME} covers 张伟的研究<ins>报告</ins> and ‘café’ costs.` },
  { id: 2, category: 'removed', severity: 'high', location: '第二节 — para 2', original: `删除的段落：${ORIGINAL}`, summary: 'A paragraph was removed' },
];
const result: ComparisonResult = { changes, trivialCount: 0, metadata: [{ label: 'Author', original: NAME, edited: '张伟', difference: 'changed — “author”', flagged: true }] } as ComparisonResult;
const reportInput = {
  result, layoutChanges: [], layout: { pages: [] }, sim: { score: 90, headingScore: 1, overlapScore: 1, structureScore: 1, reasons: [] },
  override: false, settings: { similarityThreshold: 60, layoutPixelRatio: 0.005 }, fileNames: ['Zoë’s plan.docx', '张伟 — edited.docx'] as [string, string],
  all: changes, visible: changes, filtersNote: '', landscape: false,
};
const authorInput = { changes, trivialCount: 0, fileNames: ['Zoë’s plan.docx', '张伟 — edited.docx'] as [string, string], similarity: 90, override: false };

async function pdfText(bytes: ArrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) text += (await (await doc.getPage(p)).getTextContent()).items.map((i) => (i as TextItem).str).join('') + '\n';
  return text;
}
const raw = (bytes: ArrayBuffer) => new TextDecoder('latin1').decode(bytes.slice(0)); // a copy: pdf.js detaches the buffer it reads

describe('Unicode in the exported PDFs', () => {
  for (const [name, build] of [['comparison report', () => buildReportPdf(reportInput)], ['review for the author', () => buildAuthorPdf(authorInput)]] as const) {
    it(`${name}: curly quotes, dashes, accented names and Chinese print, with no "?"`, async () => {
      const bytes = (await build()).output('arraybuffer');
      const fonts = raw(bytes);
      const text = await pdfText(bytes);
      for (const s of MUST_PRINT) expect(text).toContain(s);
      expect(text).not.toContain('?');
      expect(fonts).toMatch(/BaseFont \/DCSans/);
      expect(fonts).toMatch(/BaseFont \/DCFallback/); // the Chinese is drawn in the CJK font, not as empty boxes
    });
  }

  it('a Latin-only report does not embed the CJK font', async () => {
    const latin: Change[] = [{ id: 1, category: 'wording', severity: 'medium', location: 'Scope', original: '“Zoë” — café', edited: '“Zoë” – café' }];
    const bytes = (await buildAuthorPdf({ ...authorInput, changes: latin, fileNames: ['a.docx', 'b.docx'] })).output('arraybuffer');
    expect(raw(bytes)).toMatch(/BaseFont \/DCSans/);
    expect(raw(bytes)).not.toMatch(/BaseFont \/DCFallback/);
    expect(await pdfText(bytes)).toContain('“Zoë” — café');
  });

  it('long Chinese text wraps inside the page instead of running off it', async () => {
    const long: Change[] = [{ id: 1, category: 'removed', severity: 'high', location: '第一节', original: '这是一个很长的中文段落，用来检查换行是否正确。'.repeat(20) }];
    const doc = await buildAuthorPdf({ ...authorInput, changes: long });
    const lines = doc.splitTextToSize(long[0].original!, 400) as string[];
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(doc.getTextWidth(l)).toBeLessThanOrEqual(400);
  });

  it('a long Chinese paragraph in the changes table leaves the other text columns readable', async () => {
    const rows: Change[] = [
      { id: 1, category: 'removed', severity: 'high', location: '第二节', original: '这是一个很长的中文段落，用来检查换行是否正确。'.repeat(8) },
      { id: 2, category: 'number', severity: 'high', location: 'Costs', original: 'Costs were thirty dollars in the first year of the programme.', edited: 'Costs were sixty dollars in the first year of the programme, a large rise.' },
    ];
    const doc = await buildReportPdf({ ...reportInput, all: rows, visible: rows });
    const cols = (doc as unknown as { lastAutoTable: { columns: { width: number }[] } }).lastAutoTable.columns;
    expect(cols[4].width).toBeGreaterThan(40); // Edited; without the CJK break marks it is squeezed to about one letter (10pt)
  });

  it('making both PDFs makes no network calls (the fonts are bundled)', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call during PDF export'); });
    const xhrSpy = vi.fn(() => { throw new Error('network call during PDF export'); });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    try {
      await buildReportPdf(reportInput);
      await buildAuthorPdf(authorInput);
    } finally { vi.unstubAllGlobals(); }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });
});
