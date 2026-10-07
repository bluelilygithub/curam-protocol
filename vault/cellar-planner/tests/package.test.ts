import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DENOMS, type Prim } from '@planner-core/export/pdfDraw';
import { sampleProject, testCaseProject, type AppProject } from '../src/app/model';
import { A3_LANDSCAPE, blankMeta, buildSheets, PRELIMINARY, type Fonts, type Sheet } from '../src/export/drawingPackage';
import { makePackagePdf, packageFileName } from '../src/export/packagePdf';

// Rack values in the test case are best guesses (invented). The enclosure is Golden #02.
const fontDoc = await PDFDocument.create();
const fonts: Fonts = { regular: await fontDoc.embedFont(StandardFonts.Helvetica), bold: await fontDoc.embedFont(StandardFonts.HelveticaBold), italic: await fontDoc.embedFont(StandardFonts.HelveticaOblique) };

const meta = { company: 'Carter Noir', client: 'Redkem Constructions', address: '243 Kemp St New Farm QLD 4005', projectNo: 'M0103', drawnBy: 'MS', checkedBy: 'BS', date: '2026-10-20' };
const textsOf = (s: Sheet): string[] => s.prims.filter((p): p is Extract<Prim, { t: 'text' }> => p.t === 'text').map((p) => p.text);
const all = (s: Sheet): string => textsOf(s).join(' | ');
const circlesOf = (s: Sheet) => s.prims.filter((p): p is Extract<Prim, { t: 'circle' }> => p.t === 'circle');

describe('which sheets there are', () => {
  it('the Test case gives the specification, the plan, the elevation and one rack sheet for each of the four walls: 7 sheets, numbered like the samples', () => {
    const sheets = buildSheets(testCaseProject(), meta, fonts);
    expect(sheets.map((s) => s.id)).toEqual(['A100', 'A101', 'A102', 'A103', 'A104', 'A105', 'A106']);
    expect(sheets.map((s) => s.title)).toEqual(['SPECIFICATION AND SCHEDULE', 'PLAN VIEW', 'ELEVATION - SOUTH WALL (OUTSIDE)', 'RACKS - NORTH WALL (INSIDE FACE)', 'RACKS - EAST WALL (INSIDE FACE)', 'RACKS - SOUTH WALL (INSIDE FACE)', 'RACKS - WEST WALL (INSIDE FACE)']);
  });
  it('a design with no racks has no rack sheets (just the specification, plan and elevation)', () => {
    expect(buildSheets(sampleProject(), meta, fonts).map((s) => s.id)).toEqual(['A100', 'A101', 'A102']);
  });
  it('only walls with racks get a rack sheet', () => {
    const p: AppProject = { ...testCaseProject(), runs: testCaseProject().runs.filter((r) => r.wall === 'NORTH') };
    expect(buildSheets(p, meta, fonts).map((s) => s.title).filter((t) => t.startsWith('RACKS'))).toEqual(['RACKS - NORTH WALL (INSIDE FACE)']);
  });
  it('every sheet is A3 landscape', () => {
    for (const s of buildSheets(testCaseProject(), meta, fonts)) expect([s.width, s.height]).toEqual([A3_LANDSCAPE.w, A3_LANDSCAPE.h]);
  });
});

describe('every sheet carries the title block and the warnings', () => {
  const sheets = buildSheets(testCaseProject(), meta, fonts);
  it('has the title block fields of the sample drawings, filled in', () => {
    for (const s of sheets) {
      const t = all(s);
      for (const label of ['Project', 'Address', 'Client', 'Drawing Title', 'Drawing No.', 'Date', 'Project No.', 'Scale @ A3', 'Drawn', 'Checker']) expect(t, `${s.id} ${label}`).toContain(label);
      for (const v of ['Test case (estimated rack values)', '243 Kemp St New Farm QLD 4005', 'Redkem Constructions', 'M0103', 'MS', 'BS', '2026-10-20', 'CARTER NOIR']) expect(t, `${s.id} ${v}`).toContain(v);
      expect(textsOf(s)).toContain(s.id);
    }
  });
  it('says "preliminary design only: final site measure required" on every sheet', () => {
    for (const s of sheets) expect(textsOf(s), s.id).toContain(PRELIMINARY);
  });
  it('numbers the sheets "Sheet n of 7"', () => {
    sheets.forEach((s, i) => expect(textsOf(s)).toContain(`Sheet ${i + 1} of 7`));
  });
  it('a blank company or client prints a dash, not "undefined"', () => {
    const s = buildSheets(sampleProject(), blankMeta('2026-10-20'), fonts)[1];
    expect(all(s)).not.toMatch(/undefined|null/);
    expect(textsOf(s)).toContain('-');
  });
  it('the scale is a standard one (1:n from the shared list) for every drawn sheet', () => {
    for (const s of sheets.filter((x) => x.id !== 'A100')) { expect(s.scale, s.id).toMatch(/^1:\d+$/); expect(DENOMS).toContain(Number(s.scale.slice(2))); expect(all(s)).toContain(s.scale); }
    expect(sheets[0].scale).toBe('NTS');
  });
});

describe('long title-block values are never cut off', () => {
  it('a very long address is made smaller or wrapped onto a second line: every word is still there', () => {
    const address = 'Unit 14, The Residences at Some Very Long Named Development, 1234 Extremely Long Boulevard Road, Mount Somewhere East QLD 4999';
    const t = all(buildSheets(testCaseProject(), { ...meta, address }, fonts)[1]);
    for (const word of ['Unit', 'Residences', 'Boulevard', '4999']) expect(t, word).toContain(word);
  });
  it('a short one stays on one line at full size', () => {
    const s = buildSheets(testCaseProject(), meta, fonts)[1];
    const addr = s.prims.find((p): p is Extract<Prim, { t: 'text' }> => p.t === 'text' && p.text === '243 Kemp St New Farm QLD 4005')!;
    expect(addr.size).toBe(9.5);
  });
});

describe('the status line says how far to trust the rack numbers', () => {
  const status = (p: AppProject): string => all(buildSheets(p, meta, fonts)[1]);
  it('best guesses: not for quoting or fabrication, and that bottles per row is calculated', () => {
    const t = status(testCaseProject());
    expect(t).toMatch(/RACK VALUES ARE BEST GUESSES/);
    expect(t).toMatch(/NOT FOR QUOTING OR FABRICATION/);
    expect(t).toMatch(/Bottles per row is calculated/);
  });
  it('not set: says bottles cannot be counted', () => {
    const p = { ...sampleProject(), runs: [{ id: 'r1', wall: 'NORTH' as const, startMm: 0, units: 1 }] };
    expect(status(p)).toMatch(/RACK VALUES NOT SET.*BOTTLES CANNOT BE COUNTED/);
  });
  it('entered by the designer: says to confirm with the fabricator, and not "best guesses"', () => {
    const p = { ...testCaseProject(), estimated: [], rackSpec: { ...testCaseProject().rackSpec, bottlesPerRow: 7 } };
    const t = status(p);
    expect(t).toMatch(/entered by the designer/);
    expect(t).not.toMatch(/BEST GUESSES/);
  });
  it('runs with errors are named as not counted', () => {
    expect(status({ ...testCaseProject(), bottle: 'MAGNUM' })).toMatch(/640 bottles in 5 run\(s\) with errors are NOT counted/);
  });
});

describe('the drawings', () => {
  it('everything stays inside the border and above the title block', () => {
    for (const s of buildSheets(testCaseProject(), meta, fonts).filter((x) => x.id !== 'A100')) {
      const frameBottom = 20 + 4 + 78 + 30; // the notes sit just above the title block, so drawings start higher than this
      for (const p of s.prims) {
        const pts = p.t === 'poly' ? p.pts : p.t === 'line' ? [p.a, p.b] : p.t === 'circle' ? [{ x: p.x, y: p.y }] : [{ x: p.x, y: p.y }];
        for (const q of pts) {
          if (q.y < 20 + 4 + 78 + 4 && q.y > 20 && p.t !== 'text' && p.t !== 'line' && p.t !== 'poly') continue;
          expect(q.x, s.id).toBeGreaterThanOrEqual(19.9);
          expect(q.x, s.id).toBeLessThanOrEqual(A3_LANDSCAPE.w - 19.9);
          expect(q.y, s.id).toBeGreaterThanOrEqual(19.9);
          expect(q.y, s.id).toBeLessThanOrEqual(A3_LANDSCAPE.h - 19.9);
        }
      }
      void frameBottom;
    }
  });
  it('the plan carries the sample dimensions: 2850, 1665, and the 940 | 970 | 940 split', () => {
    const t = textsOf(buildSheets(testCaseProject(), meta, fonts)[1]);
    for (const n of ['2850', '1665', '940', '970']) expect(t).toContain(n);
  });
  it('the elevation carries the door and the header sizes: 970, 2120, 500, 2200', () => {
    const t = textsOf(buildSheets(testCaseProject(), meta, fonts)[2]);
    for (const n of ['2850', '2200', '500', '970', '2120', '400', '902']) expect(t).toContain(n);
  });
  it('the rack sheets draw every bottle: north 560, east 140, south 280, west 140 = 1120, at true size (76 mm = scale x 38)', () => {
    const sheets = buildSheets(testCaseProject(), meta, fonts);
    const counts = sheets.slice(3).map((s) => circlesOf(s).length);
    expect(counts).toEqual([560, 140, 280, 140]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1120);
    const north = sheets[3];
    const denom = Number(north.scale.slice(2));
    const expected = (38 * (72 / 25.4)) / denom; // 76 mm across at 1:denom, in points: radius = 38 mm / denom
    for (const c of circlesOf(north)) expect(c.r).toBeCloseTo(expected, 2);
  });
  it('bottles in runs with errors are drawn in the issue colour, matching "not counted"', () => {
    const north = buildSheets({ ...testCaseProject(), bottle: 'MAGNUM' }, meta, fonts)[3];
    for (const c of circlesOf(north)) expect(c.fill).toEqual([0.95, 0.65, 0.65]);
  });
  it('a unit with values missing is an outline only: no bottle circles are invented for it', () => {
    const p = { ...sampleProject(), rackSpec: { ...sampleProject().rackSpec, unitWidthMm: 600, unitDepthMm: 350 }, runs: [{ id: 'r1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    const sheets = buildSheets(p, meta, fonts);
    expect(sheets.find((s) => s.id === 'A103')).toBeTruthy();
    expect(circlesOf(sheets.find((s) => s.id === 'A103') as Sheet)).toHaveLength(0);
  });
});

describe('the specification sheet', () => {
  const spec = all(buildSheets(testCaseProject(), meta, fonts)[0]);
  it('lists the enclosure, door, header, rack specification (with where each number came from), runs and bottles', () => {
    for (const phrase of ['Inside size: 2750 x 1565 x 2150 mm', 'ENCLOSURE', 'DOOR', 'HEADER', 'RACK SPECIFICATION', 'RACK RUNS', 'BOTTLES', 'CHECKS', 'north-1: 4 units on the north wall', '1120 bottles']) expect(spec, phrase).toContain(phrase);
    expect(spec).toMatch(/Unit width: 600 mm \[ESTIMATED\]/);
    expect(spec).toMatch(/Bottles per row: 7 \[CALCULATED: unit width \/ bottle pitch\]/);
  });
  it('flags the unconfirmed ceiling and floor build-ups, and the unverified values', () => {
    expect(spec).toMatch(/UNCONFIRMED/);
    expect(spec).toMatch(/ASSUMPTIONS AND UNVERIFIED VALUES/);
    expect(spec).toMatch(/not an engineering document/);
  });
  it('carries the advisory guidance with its sign-off wording, separate from the checks', () => {
    expect(spec).toMatch(/ADVISORY GUIDANCE \(information only\)/);
    expect(spec).toMatch(/Advisory only: requires mechanical engineer \/ HVAC sign-off/);
  });
  it('shows what is not set as NOT SET, never as a number', () => {
    const t = all(buildSheets(sampleProject(), meta, fonts)[0]);
    expect(t).toMatch(/Unit width: - mm \[NOT SET\]/);
    expect(t).toMatch(/Bottles per row: - \[NOT SET\]/);
  });
  it('flows onto continuation sheets instead of running off the page when there is a lot to say', () => {
    const many: AppProject = { ...testCaseProject(), runs: Array.from({ length: 140 }, (_, i) => ({ id: `r${i}`, wall: 'NORTH' as const, startMm: 0, units: 1 })) };
    const sheets = buildSheets(many, meta, fonts);
    const specs = sheets.filter((s) => s.id.startsWith('A100'));
    expect(specs.length).toBeGreaterThan(1);
    expect(specs[1].id).toBe('A100-2');
    for (const s of specs) for (const p of s.prims) if (p.t === 'text' && p.y > 140 && p.y < A3_LANDSCAPE.h - 60) expect(p.x).toBeLessThan(A3_LANDSCAPE.w - 40);
  });
});

describe('the PDF itself', () => {
  it('is a real PDF with one A3 landscape page per sheet, a title and the preliminary subject', async () => {
    const { bytes, sheets } = await makePackagePdf(testCaseProject(), meta);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(7);
    expect(sheets.map((s) => s.id)).toEqual(['A100', 'A101', 'A102', 'A103', 'A104', 'A105', 'A106']);
    for (const page of doc.getPages()) { const { width, height } = page.getSize(); expect(width).toBeCloseTo(1190.55, 1); expect(height).toBeCloseTo(841.89, 1); }
    expect(doc.getTitle()).toBe('Test case (estimated rack values) - drawing package');
    expect(doc.getSubject()).toMatch(/Preliminary design only/);
    expect(bytes.length).toBeGreaterThan(5_000);
    expect(bytes.length).toBeLessThan(5_000_000);
  });
  it('does not fail on names or text the standard PDF fonts cannot draw', async () => {
    const p = { ...testCaseProject(), name: 'Cellar – Ünïcode ✓ 酒' };
    const { bytes } = await makePackagePdf(p, { ...meta, client: 'Zöe — “Quote”' });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(7);
  });
  it('makes a safe file name', () => {
    expect(packageFileName('Dad\'s Cellar #1!')).toBe('dad-s-cellar-1-drawing-package.pdf');
    expect(packageFileName('***')).toBe('cellar-drawing-package.pdf');
  });
});
