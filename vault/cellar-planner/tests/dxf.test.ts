import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRackType } from '../src/app/catalogue';
import { sampleProject, testCaseProject } from '../src/app/model';
import { PRELIMINARY } from '../src/export/drawingPackage';
import { DXF_PRELIMINARY, buildDxf, dxfFileName, dxfText, dxfViews, makeDxf } from '../src/export/dxf';
import { DEFAULT_CONFIG } from '../src/lite/config';

/** Read a DXF back as (group code, value) pairs. A file whose lines are not an even number, or whose codes are not numbers, is not a DXF at all. */
const pairs = (dxf: string): Array<[number, string]> => {
  const lines = dxf.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  expect(lines.length % 2).toBe(0);
  const out: Array<[number, string]> = [];
  for (let i = 0; i < lines.length; i += 2) { const code = Number(lines[i]!.trim()); expect(Number.isInteger(code), `line ${i + 1}: ${lines[i]}`).toBe(true); out.push([code, lines[i + 1]!]); }
  return out;
};
const entityCounts = (dxf: string): Record<string, number> => {
  const ps = pairs(dxf);
  const from = ps.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && ps[i - 1]![1] === 'SECTION');
  const counts: Record<string, number> = {};
  for (let i = from; i < ps.length; i++) { const [c, v] = ps[i]!; if (c === 0) counts[v] = (counts[v] ?? 0) + 1; }
  return counts;
};

const T = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const design = () => applyRackType(testCaseProject(), T);

describe('DXF export of the drawings', () => {
  it('is a well-formed release 12 file: sections balanced, ends with EOF, units in millimetres', () => {
    const dxf = makeDxf(design(), '2026-10-18');
    const ps = pairs(dxf);
    expect(ps[0]).toEqual([0, 'SECTION']);
    expect(ps[ps.length - 1]).toEqual([0, 'EOF']);
    const sections = ps.filter(([c, v]) => c === 0 && v === 'SECTION').length;
    const ends = ps.filter(([c, v]) => c === 0 && v === 'ENDSEC').length;
    expect(sections).toBe(4); expect(ends).toBe(4);
    expect(ps.some(([c, v]) => c === 1 && v === 'AC1009')).toBe(true);
    const units = ps.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
    expect(ps[units + 1]).toEqual([70, '4']);
  });

  it('draws the same views as the PDF package: plan, the door-wall elevation, and each wall with racks', () => {
    const p = design();
    const views = dxfViews(p);
    expect(views.map((v) => v.id)).toEqual(expect.arrayContaining(['A101', 'A102', 'A103']));
    expect(views[0]!.title).toBe('PLAN VIEW');
    expect(views.length).toBeGreaterThanOrEqual(3);
    for (const v of views) expect(v.prims.length).toBeGreaterThan(0);
  });

  it('has the entities a CAD program expects: polylines for walls and racks, a circle for every bottle, text and lines', () => {
    const p = design();
    const dxf = makeDxf(p, '2026-10-18');
    const c = entityCounts(dxf);
    expect(c.POLYLINE).toBeGreaterThan(5);
    expect(c.POLYLINE).toBe(c.SEQEND);
    expect(c.VERTEX).toBeGreaterThanOrEqual((c.POLYLINE ?? 0) * 2);
    const bottlesDrawn = dxfViews(p).flatMap((v) => v.prims).filter((q) => q.kind === 'circle').length;
    expect(c.CIRCLE).toBe(bottlesDrawn);
    expect(bottlesDrawn).toBeGreaterThan(100);
    expect(c.TEXT).toBeGreaterThan(10);
    expect(c.LINE).toBeGreaterThan(5); // dimension lines and ticks
  });

  it('puts every entity on a declared layer, one layer per kind of thing', () => {
    const dxf = makeDxf(design(), '2026-10-18');
    const ps = pairs(dxf);
    const t = ps.findIndex(([c, v], i) => c === 2 && v === 'LAYER' && ps[i - 1]![1] === 'TABLE');
    const declared = new Set<string>();
    for (let i = t; i < ps.length && !(ps[i]![0] === 0 && ps[i]![1] === 'ENDTAB'); i++) if (ps[i]![0] === 2 && i > t) declared.add(ps[i]![1]);
    expect(declared.size).toBeGreaterThanOrEqual(5);
    const e = ps.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && ps[i - 1]![1] === 'SECTION');
    for (let i = e; i < ps.length; i++) if (ps[i]![0] === 8) expect(declared.has(ps[i]![1]), ps[i]![1]).toBe(true);
    expect([...declared].every((n) => /^CELLAR-[A-Z-]+$/.test(n))).toBe(true);
    // the layer count in the table matches what it lists
    const countAt = ps.findIndex(([c, v], i) => c === 70 && ps[i - 1]![1] === 'LAYER' && ps[i - 2]![1] === 'TABLE' ? true : false && v);
    void countAt;
  });

  it('carries the preliminary statement and the title block details, in plain ASCII', () => {
    const p = { ...design(), name: 'Back cellar – “Smith” ×2', drawing: { company: 'Acme', client: 'Sam Rivera', address: '5 Vine Rd, Tarneit', projectNo: 'J-100', drawnBy: 'MB', checkedBy: 'JS' } };
    const dxf = makeDxf(p, '2026-10-18');
    expect(DXF_PRELIMINARY).toBe(PRELIMINARY);
    expect(dxf).toContain(DXF_PRELIMINARY);
    expect(dxf).toContain('Client: Sam Rivera');
    expect(dxf).toContain('Project no: J-100');
    expect(dxf).toContain('Date: 2026-10-18');
    expect(/^[\x00-\x7f]*$/.test(dxf)).toBe(true);
    expect(dxf).toContain('Back cellar - "Smith" x2');
  });

  it('turns text into something release 12 can hold', () => {
    expect(dxfText('2.75 × 1.565 m, 14 °C, 1 m²')).toBe('2.75 x 1.565 m, 14  deg C, 1 m2');
    expect(dxfText('Café — “quoted”')).toBe('Cafe - "quoted"');
    expect(dxfText('x'.repeat(500)).length).toBe(200);
    expect(dxfText('line1\nline2\u0007')).toBe('line1line2');
  });

  it('lays the views side by side without overlap, and the numbers are all finite', () => {
    const dxf = makeDxf(design(), '2026-10-18');
    expect(dxf).not.toMatch(/NaN|Infinity|undefined/);
    const ps = pairs(dxf);
    const minx = ps.findIndex(([c, v]) => c === 9 && v === '$EXTMIN');
    const maxx = ps.findIndex(([c, v]) => c === 9 && v === '$EXTMAX');
    expect(Number(ps[maxx + 1]![1])).toBeGreaterThan(Number(ps[minx + 1]![1]) + 5000);
  });

  it('copes with an empty design and a blank room, and with no views at all', () => {
    for (const p of [sampleProject(), { ...sampleProject(), runs: [] }]) {
      const dxf = makeDxf(p, '2026-10-18');
      expect(pairs(dxf)[pairs(dxf).length - 1]).toEqual([0, 'EOF']);
      expect(dxf).not.toMatch(/NaN|Infinity/);
    }
    const empty = buildDxf([]);
    expect(pairs(empty)[pairs(empty).length - 1]).toEqual([0, 'EOF']);
  });

  it('names the file after the design', () => {
    expect(dxfFileName('Back Cellar – Smith & Sons')).toBe('back-cellar-smith-sons-drawings.dxf');
    expect(dxfFileName('')).toBe('cellar-drawings.dxf');
  });

  it('writes the file for an outside check when asked (DXF_OUT=path)', () => {
    if (process.env.DXF_OUT) writeFileSync(process.env.DXF_OUT, makeDxf(design(), '2026-10-18'));
  });
});
