import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { chooseScale, A3, A4, type Prim } from '@planner-core/export/pdfDraw';
import { apply, setItem } from '../src/domain/commands';
import { addBed, addLawn, addPath, addService, addZone } from '../src/domain/edit';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import type { GardenProject, Structure } from '../src/domain/types';
import { plantSizeAt } from '../src/plants/growth';
import { plantById } from '../src/plants/plants';
import { buildPlantSchedule, DRAFT_NOTE } from '../src/schedule/plantSchedule';
import { makePlanPdf, notesText, paginate, planFileName, sizeText } from '../src/schedule/planPdf';
import { contentPoints, cutApprox, planSheet, refsFor, rgbOf, SAFETY_NOTE, wrapApprox, type PlanOptions } from '../src/schedule/planSheet';

let n = 0;
const ids = (): string => `x${++n}`;
const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const structure = (kind: Structure['kind'], x: number, y: number, w: number, l: number, h: number): Structure => ({ id: ids(), kind, name: kind, position: { x, y }, width: w, length: l, height: h, rotation: 0 } as Structure);

const garden = (w = 24, d = 20): GardenProject => {
  let p: GardenProject = { ...newGardenProject('Test garden', { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, 'g1'), boundary: boundaryFromPoints(rectanglePoints(w, d), 'timber_paling') };
  p = { ...p, house: { id: 'h', vertices: rect(7, 13, 17, 19).map((position, i) => ({ id: `v${i}`, position })), height: 3.2, fixtures: [] } };
  p = apply(addLawn(rect(2, 3, 14, 11), false, ids, 1), p);
  p = apply(addBed(rect(15, 2, 22, 9), false, ids, 1), p);
  p = apply(addZone(rect(0, 0, 24, 12), ids, 1), p);
  p = apply(addPath([{ x: 12, y: 0 }, { x: 12, y: 8 }], ids, 1), p);
  p = apply(addService([{ x: 1, y: 12.5 }, { x: 23, y: 12.5 }], 'water', ids, 1), p);
  for (const s of [structure('gate', 12, 0, 0.9, 0.1, 1.5), structure('shed', 21, 16, 2.4, 1.8, 2.2)]) p = apply(setItem('structures', s.id, null, s), p);
  return p;
};
const put = (p: GardenProject, plantId: string, x: number, y: number): GardenProject => { const id = ids(); return apply(setItem('plants', id, null, { id, plantId, position: { x, y } }), p); };
const withPlants = (p: GardenProject): GardenProject => {
  let q = p;
  for (const x of [16, 17.5, 19]) q = put(q, 'lavandula-angustifolia', x, 3.5);
  q = put(q, 'syzygium-smithii', 20, 12);
  q = put(q, 'callistemon-little-john', 18, 6);
  return q;
};
const opts = (p: GardenProject, o: Partial<PlanOptions> = {}): PlanOptions => ({ gardenName: p.name, place: p.location.label, date: '2026-10-19', paper: 'a4', stage: 'mature', dimensions: true, sheet: 1, sheets: 2, refs: refsFor(buildPlantSchedule(p)), ...o });
const texts = (prims: Prim[]): string[] => prims.filter((q): q is Extract<Prim, { t: 'text' }> => q.t === 'text').map((q) => q.text);

describe('the plan sheet', () => {
  it('picks the page shape that gives the bigger drawing, and the biggest standard scale that fits', () => {
    const p = withPlants(garden());
    const s = planSheet(p, opts(p));
    expect(s.denom).toBeLessThanOrEqual(200);
    expect([150, 200]).toContain(s.denom);
    expect(s.scaleLabel).toBe(`1:${s.denom}`);
    // a wide garden on a landscape page vs a tall one on a portrait page: whichever scale is bigger wins
    const wide = planSheet(garden(40, 10), opts(garden(40, 10)));
    expect(wide.width).toBeGreaterThan(wide.height);
    const tall = planSheet(garden(10, 40), opts(garden(10, 40)));
    expect(tall.height).toBeGreaterThan(tall.width);
  });

  it('A3 is bigger than A4 and gives the same or a bigger drawing', () => {
    const p = withPlants(garden());
    const a4 = planSheet(p, opts(p, { paper: 'a4' }));
    const a3 = planSheet(p, opts(p, { paper: 'a3' }));
    expect(Math.max(a3.width, a3.height)).toBeCloseTo(A3.h, 1);
    expect(Math.max(a4.width, a4.height)).toBeCloseTo(A4.h, 1);
    expect(a3.denom).toBeLessThanOrEqual(a4.denom);
    expect(a3.k).toBeGreaterThanOrEqual(a4.k);
  });

  it('everything of the garden is on the page, with the drawing inside its margins, at every size and shape of plot', () => {
    for (const [w, d] of [[24, 20], [10, 40], [60, 12], [6, 6], [100, 80]] as const) {
      const p = withPlants(garden(w, d));
      for (const paper of ['a4', 'a3'] as const) {
        const s = planSheet(p, opts(p, { paper }));
        expect(s.area.x0).toBeGreaterThanOrEqual(0); expect(s.area.x1).toBeLessThanOrEqual(s.width);
        expect(s.area.y0).toBeGreaterThanOrEqual(0); expect(s.area.y1).toBeLessThanOrEqual(s.height);
        expect(contentPoints(p, 'mature').length).toBeGreaterThan(0);
        for (const q of s.prims) {
          const pts = q.t === 'poly' ? q.pts : q.t === 'line' ? [q.a, q.b] : q.t === 'circle' ? [{ x: q.x - q.r, y: q.y - q.r }, { x: q.x + q.r, y: q.y + q.r }] : [{ x: q.x, y: q.y }];
          for (const pt of pts) {
            expect(pt.x, `${w}x${d} ${paper} x`).toBeGreaterThanOrEqual(-0.5);
            expect(pt.x, `${w}x${d} ${paper} x`).toBeLessThanOrEqual(s.width + 0.5);
            expect(pt.y, `${w}x${d} ${paper} y`).toBeGreaterThanOrEqual(-0.5);
            expect(pt.y, `${w}x${d} ${paper} y`).toBeLessThanOrEqual(s.height + 0.5);
          }
        }
      }
    }
  });

  it('the drawing is true to scale: a 24 m edge is 24 m times k points long, and the scale bar is the length it says', () => {
    const p = garden();
    const s = planSheet(p, opts(p));
    const lines = s.prims.filter((q): q is Extract<Prim, { t: 'line' }> => q.t === 'line');
    const fence = lines.filter((l) => l.width >= 1.8 && Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) > 100); // (the key has a short fence swatch)
    const lens = fence.map((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y)).sort((a, b) => a - b);
    expect(lens).toHaveLength(4);
    expect(lens[0]).toBeCloseTo(20 * s.k, 1);
    expect(lens[3]).toBeCloseTo(24 * s.k, 1);
    // the scale bar: two filled and empty boxes whose total width is the metres on its label
    const bar = s.prims.filter((q): q is Extract<Prim, { t: 'poly' }> => q.t === 'poly' && q.pts.length === 4 && Math.abs(q.pts[2].y - q.pts[0].y - 4) < 1e-6);
    expect(bar).toHaveLength(2);
    const barW = bar[1].pts[1].x - bar[0].pts[0].x;
    const label = texts(s.prims).find((t) => /^\d+ m$/.test(t));
    expect(label).toBeDefined();
    expect(barW).toBeCloseTo(Number(label!.replace(' m', '')) * s.k, 1);
    expect(barW).toBeLessThanOrEqual(120);
  });

  it('every plant is drawn at its mature canopy size and numbered with its schedule number', () => {
    const p = withPlants(garden());
    const s = planSheet(p, opts(p));
    const schedule = buildPlantSchedule(p);
    const circles = s.prims.filter((q): q is Extract<Prim, { t: 'circle' }> => q.t === 'circle' && q.r > 1.2 && q.opacity === 0.45);
    // 5 plants + 1 legend swatch
    expect(circles.length).toBe(p.plants.length + 1);
    const lav = plantById('lavandula-angustifolia')!;
    const expectR = Math.max(0.15, plantSizeAt(lav, 'mature').canopyRadius) * s.k;
    expect(circles.some((c) => Math.abs(c.r - expectR) < 1e-6)).toBe(true);
    const labels = texts(s.prims);
    for (const r of schedule.rows) expect(labels.filter((t) => t === r.ref).length, r.ref).toBe(r.qty);
    // every number on the plan is in the schedule, and every plant is numbered
    const refs = new Set(schedule.rows.map((r) => r.ref));
    for (const id of p.plants.map((q) => q.id)) expect(refsFor(schedule).has(id)).toBe(true);
    expect([...refsFor(schedule).values()].every((v) => refs.has(v))).toBe(true);
  });

  it('plants drawn "as planted" are smaller than at mature size', () => {
    const p = withPlants(garden());
    const mature = planSheet(p, opts(p, { stage: 'mature' }));
    const seedling = planSheet(p, opts(p, { stage: 'planted' }));
    const size = (s: ReturnType<typeof planSheet>): number => Math.max(...s.prims.filter((q): q is Extract<Prim, { t: 'circle' }> => q.t === 'circle' && q.opacity === 0.45).map((q) => q.r));
    expect(size(seedling)).toBeLessThan(size(mature));
    expect(texts(seedling.prims).join(' ')).toMatch(/as planted/);
    expect(texts(mature.prims).join(' ')).toMatch(/at mature size/);
  });

  it('a plant too small for its label inside gets the label above it', () => {
    let p = garden();
    p = put(p, 'dichondra-repens', 5, 5); // groundcover: a tiny canopy
    const s = planSheet(p, opts(p, { stage: 'planted' }));
    const ref = buildPlantSchedule(p).rows[0].ref;
    const label = s.prims.find((q): q is Extract<Prim, { t: 'text' }> => q.t === 'text' && q.text === ref)!;
    const dot = s.prims.find((q): q is Extract<Prim, { t: 'circle' }> => q.t === 'circle' && q.r === 0.9)!;
    expect(label.y).toBeGreaterThan(dot.y + 2);
  });

  it('the page carries the title block, scale, date, sheet number, north arrow, key and the two footnotes that must never be lost', () => {
    const p = withPlants(garden());
    const s = planSheet(p, opts(p));
    const t = texts(s.prims).join(' | ');
    expect(t).toContain('Test garden');
    expect(t).toContain('Brisbane QLD');
    expect(t).toContain(`Scale 1:${s.denom}`);
    expect(t).toContain('2026-10-19');
    expect(t).toContain('Sheet 1 of 2');
    expect(t).toContain('N');
    for (const k of ['Lawn', 'Garden bed', 'Path', 'House', 'Structure', 'Fence', 'Service line', 'Plant,']) expect(t, k).toContain(k);
    const foot = texts(s.prims).filter((x) => x.length > 20).join(' ');
    expect(foot.replace(/\s+/g, ' ')).toContain('Dial Before You Dig');
    expect(foot.replace(/\s+/g, ' ')).toContain('draft and has not been verified');
  });

  it('the north arrow points where the garden\'s north points', () => {
    const p0 = withPlants(garden());
    const arrow = (northDeg: number): { tip: { x: number; y: number }; base: { x: number; y: number } } => {
      const p = { ...p0, northDeg };
      const s = planSheet(p, opts(p));
      const poly = s.prims.filter((q): q is Extract<Prim, { t: 'poly' }> => q.t === 'poly' && q.pts.length === 4 && q.fill?.[0] === 0.1 && Math.abs(q.pts[0].y - q.pts[1].y) > 1e-6)[0]; // (the scale bar's boxes are level rectangles; the arrow is not)
      return { tip: poly.pts[0], base: poly.pts[2] };
    };
    const up = arrow(0);
    expect(up.tip.y).toBeGreaterThan(up.base.y); // north up: the tip is above the tail
    expect(Math.abs(up.tip.x - up.base.x)).toBeLessThan(1e-6);
    const right = arrow(90); // north to the right
    expect(right.tip.x).toBeGreaterThan(right.base.x);
    expect(Math.abs(right.tip.y - right.base.y)).toBeLessThan(1e-6);
    const down = arrow(180);
    expect(down.tip.y).toBeLessThan(down.base.y);
  });

  it('boundary lengths are labelled when asked, and not when not', () => {
    const p = garden();
    const on = texts(planSheet(p, opts(p, { dimensions: true })).prims).filter((t) => /^\d+\.\d\d m$/.test(t));
    expect(on.sort()).toEqual(['20.00 m', '20.00 m', '24.00 m', '24.00 m']);
    expect(texts(planSheet(p, opts(p, { dimensions: false })).prims).filter((t) => /^\d+\.\d\d m$/.test(t))).toEqual([]);
  });

  it('beds, lawns, the house, structures, the path and the service are all on the sheet; the key lists only what is there', () => {
    const p = garden();
    const s = planSheet(p, opts(p));
    expect(s.prims.filter((q) => q.t === 'poly').length).toBeGreaterThan(8);
    expect(texts(s.prims)).toContain('HOUSE');
    expect(texts(s.prims)).toContain('shed');
    const bare = newGardenProject('Bare', { label: 'x', lat: -27, lng: 153, state: 'QLD' }, 'b');
    const t = texts(planSheet(bare, opts(bare, { refs: new Map() })).prims).join(' | ');
    expect(t).toContain('Nothing has been drawn yet.');
    expect(t).not.toContain('Lawn');
  });

  it('an empty garden is still a valid sheet', () => {
    const bare = newGardenProject('Bare', { label: 'x', lat: -27, lng: 153, state: 'QLD' }, 'b');
    const s = planSheet(bare, opts(bare, { refs: new Map() }));
    expect(s.prims.length).toBeGreaterThan(5);
    expect(s.denom).toBeGreaterThan(0);
  });

  it('a very long garden name is cut so it cannot run into the scale', () => {
    const p = { ...garden(), name: 'The extremely long name of a garden that a person typed in without thinking about the title block' };
    const s = planSheet(p, opts(p, { gardenName: p.name }));
    const name = s.prims.find((q): q is Extract<Prim, { t: 'text' }> => q.t === 'text' && q.size === 14)!;
    expect(name.text.endsWith('...')).toBe(true);
    expect(name.text.length).toBeLessThan(p.name.length);
  });

  it('text helpers: wrap at word breaks, cut with "...", and colours convert', () => {
    const lines = wrapApprox(SAFETY_NOTE + ' ' + DRAFT_NOTE, 6.2, 400);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(`${SAFETY_NOTE} ${DRAFT_NOTE}`);
    expect(cutApprox('short', 14, 300)).toBe('short');
    expect(cutApprox('x'.repeat(100), 14, 100).endsWith('...')).toBe(true);
    expect(rgbOf('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(rgbOf('#fff')).toEqual([1, 1, 1]);
    expect(chooseScale(1, 1, 500, 500).denom).toBeLessThanOrEqual(25);
  });
});

describe('the PDF', () => {
  it('has the plan sheet first and, with the schedule, one or more schedule pages, at the right sizes', async () => {
    const p = withPlants(garden());
    const bytes = await makePlanPdf(p, { paper: 'a4', stage: 'mature', dimensions: true, includeSchedule: true, date: '2026-10-19' });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    const [a, b] = doc.getPages();
    expect(Math.max(a.getWidth(), a.getHeight())).toBeCloseTo(A4.h, 1);
    expect([b.getWidth(), b.getHeight()].map((v) => Math.round(v))).toEqual([Math.round(A4.w), Math.round(A4.h)]);
    expect(doc.getTitle()).toBe('Test garden - planting plan');
    expect(doc.getCreator()).toBe('Vault Garden Planner');
  });

  it('A3 makes an A3 plan sheet; leaving the schedule out makes a one-page plan', async () => {
    const p = withPlants(garden());
    const a3 = await PDFDocument.load(await makePlanPdf(p, { paper: 'a3', stage: 'mature', dimensions: false, includeSchedule: false, date: '2026-10-19' }));
    expect(a3.getPageCount()).toBe(1);
    expect(Math.max(a3.getPage(0).getWidth(), a3.getPage(0).getHeight())).toBeCloseTo(A3.h, 1);
  });

  it('an empty garden still makes a one-page PDF (and no schedule pages, even if asked)', async () => {
    const bare = newGardenProject('Bare', { label: 'x', lat: -27, lng: 153, state: 'QLD' }, 'b');
    const doc = await PDFDocument.load(await makePlanPdf(bare, { paper: 'a4', stage: 'mature', dimensions: true, includeSchedule: true, date: '2026-10-19' }));
    expect(doc.getPageCount()).toBe(1);
  });

  it('a big garden (many kinds of plant, long notes) runs onto more schedule pages, and the sheet numbers agree', async () => {
    let p = garden();
    const kinds = ['lavandula-angustifolia', 'syzygium-smithii', 'callistemon-little-john', 'ficus-carica', 'dichondra-repens', 'grevillea-robyn-gordon'];
    // many distinct plants: every plant in the library once, with a long note on each
    const { PLANTS } = await import('../src/plants/plants');
    PLANTS.slice(0, 90).forEach((rec, i) => { const id = ids(); p = apply(setItem('plants', id, null, { id, plantId: rec.id, position: { x: 1 + (i % 20), y: 1 + Math.floor(i / 20) * 3 }, note: 'a long note about where this was bought and why it was chosen for this spot, to make the row tall' }), p); });
    void kinds;
    const doc = await PDFDocument.load(await makePlanPdf(p, { paper: 'a4', stage: 'mature', dimensions: true, includeSchedule: true, date: '2026-10-19' }));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);
  });

  it('pagination keeps every row once, in order, and leaves room for the totals on the last page', () => {
    const heights = Array.from({ length: 40 }, () => 30);
    const pages = paginate(heights, 842, 22, 58);
    expect(pages.flat()).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(pages.length).toBeGreaterThan(1);
    const usable = 842 - 46 - 52 - 22 - 18;
    for (const pg of pages) expect(pg.reduce((s, i) => s + heights[i], 0)).toBeLessThanOrEqual(usable + 1e-9);
    const last = pages[pages.length - 1];
    expect(last.reduce((s, i) => s + heights[i], 0) + 58).toBeLessThanOrEqual(usable + 1e-9);
    expect(paginate([], 842, 22, 58)).toEqual([[]]);
  });

  it('the schedule cells carry the sizes, cautions, weed status and notes', () => {
    const p = put(garden(), 'ficus-carica', 5, 5);
    const r = buildPlantSchedule(p).rows[0];
    expect(sizeText(r)).toMatch(/m high, .* m wide/);
    expect(notesText(r)).toMatch(/Toxic to pets/);
    expect(notesText(r)).toMatch(/Unknown in QLD \(not checked\)/);
  });

  it('file names come from the garden name', () => {
    expect(planFileName("Michael's Backyard (2026)!")).toBe('michael-s-backyard-2026-planting-plan.pdf');
    expect(planFileName('')).toBe('garden-planting-plan.pdf');
  });
});
