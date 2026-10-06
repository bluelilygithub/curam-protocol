import { describe, expect, it } from 'vitest';
import { analyseApp, fullRuns, sampleProject, testCaseProject, type AppProject } from '../src/app/model';
import { badRunIds, boundsOf, bottlesOnWall, rackFaceView, type Prim } from '../src/views';

// The Test case's rack values are best guesses (invented). The enclosure is Golden #02 (2750 x 1565 x 2150 inside).
const view = (p: AppProject, wall: Parameters<typeof rackFaceView>[3]) => {
  const a = analyseApp(p);
  const runs = fullRuns(p);
  return { prims: rackFaceView(p.enclosure, runs, a.racks, wall, p.bottle, { badRuns: badRunIds(a.racks.issues) }), a, runs };
};
const circles = (prims: Prim[]) => prims.filter((x): x is Extract<Prim, { kind: 'circle' }> => x.kind === 'circle');
const rects = (prims: Prim[]) => prims.filter((x): x is Extract<Prim, { kind: 'rect' }> => x.kind === 'rect');
const texts = (prims: Prim[]) => prims.filter((x): x is Extract<Prim, { kind: 'text' }> => x.kind === 'text').map((x) => x.text);

describe('the racks seen from inside', () => {
  const p = testCaseProject();

  it('draws one circle for every bottle the wall holds: the north wall is 4 units x 20 rows x 7 = 560', () => {
    const { prims, a, runs } = view(p, 'NORTH');
    expect(circles(prims)).toHaveLength(560);
    expect(bottlesOnWall(a.racks, runs, 'NORTH')).toBe(560);
  });
  it('every wall\'s circles add up to the total the checks panel shows (1120)', () => {
    const n = (['NORTH', 'EAST', 'SOUTH', 'WEST'] as const).reduce((sum, w) => sum + circles(view(p, w).prims).length, 0);
    expect(n).toBe(1120);
    expect(analyseApp(p).racks.total).toMatchObject({ capacity: 1120 });
  });
  it('bottles are drawn at their true size: a Bordeaux bottle is 76 mm across', () => {
    for (const c of circles(view(p, 'NORTH').prims)) expect(c.r).toBe(38);
  });
  it('rows are one row pitch (100 mm) apart, standing on the floor of a 2150 mm inside', () => {
    const first = circles(view(p, 'NORTH').prims).filter((c) => Math.abs(c.cx - 600 / 7 / 2) < 1e-6).map((c) => c.cy).sort((x, y) => y - x);
    expect(first).toHaveLength(20);
    expect(first[0]).toBe(2150 - 50);
    expect(first[1]).toBe(2150 - 150);
    expect(first[19]).toBe(2150 - 1950);
  });
  it('the 7 bottles of a row are spread evenly across the 600 mm unit, and the next unit starts at 600', () => {
    const row = circles(view(p, 'NORTH').prims).filter((c) => c.cy === 2100).map((c) => c.cx).sort((x, y) => x - y);
    expect(row).toHaveLength(28);
    expect(row[0]).toBeCloseTo(600 / 7 / 2, 6);
    expect(row[1] - row[0]).toBeCloseTo(600 / 7, 6);
    expect(row[7]).toBeCloseTo(600 + 600 / 7 / 2, 6);
  });
  it('every bottle is inside the enclosure', () => {
    const b = boundsOf(circles(view(p, 'NORTH').prims));
    expect(b.x0).toBeGreaterThanOrEqual(0);
    expect(b.x1).toBeLessThanOrEqual(2750);
    expect(b.y0).toBeGreaterThanOrEqual(0);
    expect(b.y1).toBeLessThanOrEqual(2150);
  });

  it('facing the south wall from inside the plan is mirrored: the unit at the west end is on the viewer\'s right; the door opening is drawn in its place', () => {
    const { prims } = view(p, 'SOUTH');
    const units = rects(prims).filter((r) => r.tone === 'rack' && r.label);
    expect(units.map((r) => r.x).sort((a, b) => a - b)).toEqual([290, 2150]); // 2750 - 1860 - 600 and 2750 - 0 - 600
    const door = rects(prims).find((r) => r.label === 'DOOR')!;
    expect(door).toMatchObject({ x: 890, w: 970, h: 2120 });
  });
  it('the other walls have no door shape', () => {
    expect(rects(view(p, 'NORTH').prims).some((r) => r.label === 'DOOR')).toBe(false);
  });
  it('a wall with no racks is the empty inside face with its two dimensions', () => {
    const empty = { ...p, runs: p.runs.filter((r) => r.wall !== 'EAST') };
    const prims = view(empty, 'EAST').prims;
    expect(circles(prims)).toHaveLength(0);
    expect(prims.filter((x) => x.kind === 'dim')).toHaveLength(2);
  });

  it('runs the tool says cannot be built are drawn in the issue tone and labelled "not counted", matching the total', () => {
    const magnum = { ...p, bottle: 'MAGNUM' as const };
    const { prims } = view(magnum, 'NORTH');
    expect(circles(prims).every((c) => c.tone === 'rackIssue' && c.r === 57.5)).toBe(true);
    expect(rects(prims).find((r) => r.tone === 'rackIssue' && r.label)?.label).toMatch(/not counted \(has an error\)/);
    expect(analyseApp(magnum).racks.total).toMatchObject({ capacity: 0 });
  });

  it('a unit with values still missing is an outline only: no bottles are guessed into it', () => {
    const missing = { ...sampleProject(), runs: [{ id: 'r1', wall: 'NORTH' as const, startMm: 0, units: 2 }], rackSpec: { ...sampleProject().rackSpec, unitWidthMm: 600, unitDepthMm: 350 } };
    const { prims } = view(missing, 'NORTH');
    expect(circles(prims)).toHaveLength(0);
    expect(rects(prims).filter((r) => r.dash && r.label === 'r1: not set')).toHaveLength(2);
  });
  it('with no unit width at all it says so rather than drawing a zero-width rack', () => {
    const blank = { ...sampleProject(), runs: [{ id: 'r1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    const { prims } = view(blank, 'NORTH');
    expect(circles(prims)).toHaveLength(0);
    expect(texts(prims)).toContain('r1: unit width not set');
  });

  it('label-forward bottles lie side-on: drawn as rectangles, not circles, and never wider than their slot', () => {
    const lf = { ...p, rackSpec: { ...p.rackSpec, orientation: 'LABEL_FORWARD' as const, bottlesPerRowLabelForward: 2 } };
    const { prims } = view(lf, 'NORTH');
    expect(circles(prims)).toHaveLength(0);
    const bottles = rects(prims).filter((r) => r.tone === 'bottle');
    expect(bottles).toHaveLength(4 * 20 * 2);
    for (const r of bottles) { expect(r.h).toBe(76); expect(r.w).toBeLessThanOrEqual(300 + 1e-6); expect(r.w).toBeLessThanOrEqual((600 / 2) * 0.96 + 1e-6); }
  });
  it('a stated number of rows spreads them evenly up the unit', () => {
    const rows = { ...p, rackSpec: { ...p.rackSpec, rowsPerUnit: 10, unitHeightMm: 2000, rowPitchMm: null } };
    const ys = [...new Set(circles(view(rows, 'NORTH').prims).map((c) => c.cy))].sort((a, b) => b - a);
    expect(ys).toHaveLength(10);
    expect(ys[0]).toBe(2150 - 100);
    expect(ys[1] - ys[0]).toBe(-200);
  });
});
