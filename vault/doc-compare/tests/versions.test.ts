import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { describe, expect, it } from 'vitest';
import { compareDocs } from '../src/compare/pipeline';
import { sectionGroups, stillCheck } from '../src/compare/sections';
import { markdownReader } from '../src/readers/markdown';
import { buildReportPdf } from '../src/report/pdfExport';
import { memoryChecks, upsertCheck } from '../src/review/savedChecks';
import { DEFAULT_SETTINGS, VERSIONS_SIMILARITY } from '../src/settings';

// use case 10: a long version for government and a short one for industry (addendum §0.2)
const LONG = `# Housing submission

## Background

Rents in Sydney rose by 14% in the twelve months to June 2023, the fastest rise in more than a decade for private renters.

## Evidence

One tenant told us, "We moved three times in two years because every lease ended with a rent increase."

Our caseworkers recorded 318 notices to vacate in 2023, and most were issued without any reason being given.

## Legislative detail

Section 84 of the Residential Tenancies Act allows a lease to end without grounds at the end of a fixed term.

## Recommendations

End no-grounds evictions for all residential leases, with a fair process for landlords who need to sell.
`;
const SHORT = `# Housing submission

## Background

Rents in Sydney rose by 15% over the year to June 2023, the fastest rise in more than a decade.

## What we saw

One tenant told us, "We moved three times in two years because every lease ended with a rent increase."

Our caseworkers recorded 318 notices to vacate in 2023, and most were issued without any reason being given.

## Recommendations

End no-grounds evictions for all residential leases, with a fair process for landlords who need to sell.

## For industry

Landlords will still be able to end a lease for clear reasons such as selling the property or moving in.
`;
const read = (text: string, name: string) => markdownReader.read(new File([text], name));

describe('intentionally different versions', () => {
  it('groups the sections: in both, worded differently (also when renamed), only in A, only in B', async () => {
    const g = sectionGroups(await read(LONG, 'a.md'), await read(SHORT, 'b.md'));
    const by = (t: string) => g.find((x) => x.title === t)!;
    expect(by('Recommendations').status).toBe('both');
    expect(by('Background')).toMatchObject({ status: 'reworded' });
    expect(by('Background').similarity).toBeGreaterThan(30);
    expect(by('Evidence')).toMatchObject({ status: 'both', titleB: 'What we saw' });
    expect(by('Legislative detail')).toMatchObject({ status: 'onlyA', wordsB: 0 });
    expect(by('For industry')).toMatchObject({ status: 'onlyB', wordsA: 0 });
  });

  it('the comparison carries the sections only in this mode, and still lists numbers and quotes', async () => {
    const [a, b] = [await read(LONG, 'a.md'), await read(SHORT, 'b.md')];
    expect(compareDocs(a, b, DEFAULT_SETTINGS).sections).toBeUndefined();
    const r = compareDocs(a, b, DEFAULT_SETTINGS, true);
    expect(r.sections?.length).toBe(6);
    expect(stillCheck(r.changes).map((c) => c.category)).toContain('number');
    expect(VERSIONS_SIMILARITY).toBe(30);
  });

  it('the report is a Version comparison: no verdict and no watermark', async () => {
    const [a, b] = [await read(LONG, 'a.md'), await read(SHORT, 'b.md')];
    const r = compareDocs(a, b, DEFAULT_SETTINGS, true);
    const pdf = await buildReportPdf({
      result: r, layoutChanges: [], layout: { pages: [] }, sim: { score: 70, headingScore: 1, overlapScore: 1, structureScore: 1, reasons: [] },
      override: false, settings: { similarityThreshold: 60, layoutPixelRatio: 0.005 }, fileNames: ['long.md', 'short.md'], all: r.changes, visible: r.changes, filtersNote: '', landscape: false, versions: true,
    });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf.output('arraybuffer')) }).promise;
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => (i as TextItem).str).join(' '));
    expect(pages[0]).toMatch(/Version comparison/);
    expect(pages[0]).toMatch(/Only in A/);
    expect(pages[0]).toMatch(/Still check: \d+ number or quote change/);
    expect(pages.join(' ')).not.toMatch(/Submission check|Not ready to submit|UNRESOLVED ISSUES/);
  });

  it('a saved check remembers it was a version comparison, and carries no verdict', async () => {
    const store = memoryChecks();
    const f = (n: string) => new File(['x'], n);
    const c = await upsertCheck(store, { pairKey: 'k', label: 'Gov vs industry', original: f('a.md'), edited: f('b.md'), versions: true });
    expect(c.versions).toBe(true);
    await store.put({ ...c, verdict: 'red' });
    expect((await upsertCheck(store, { pairKey: 'k', label: '', original: f('a.md'), edited: f('b.md'), versions: true })).verdict).toBeUndefined();
  });
});
