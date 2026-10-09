import { describe, expect, it } from 'vitest';
import { analyseApp, fullRuns, sampleProject, testCaseProject, type AppProject } from '../src/app/model';
import { BOTTLES, WALLS, defaultLite, liteToProject } from '../src/lite/settings';
import { badRunIds, boundsOf, bottlesOnWall, rackFaceView, rackWallSummary, type Prim } from '../src/views';

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

describe('the bottle count in words, and the picture agrees with it', () => {
  const sum = (p: AppProject) => (['NORTH', 'EAST', 'SOUTH', 'WEST'] as const).map((w) => {
    const { prims, a, runs } = view(p, w);
    return { w, drawn: circles(prims).length, said: rackWallSummary(a.racks, runs, w) };
  });
  it('says the north wall in words: count, units, per unit, rows of', () => {
    const { a, runs } = view(testCaseProject(), 'NORTH');
    expect(rackWallSummary(a.racks, runs, 'NORTH').text).toBe('North wall: 560 bottles in 4 units (140 a unit: 20 rows of 7).');
  });
  it('uses the singular for one unit, and says plainly when a wall has no racks', () => {
    const { a, runs } = view(testCaseProject(), 'EAST');
    expect(rackWallSummary(a.racks, runs, 'EAST').text).toBe('East wall: 140 bottles in 1 unit (140 a unit: 20 rows of 7).');
    const none = { ...testCaseProject(), runs: [] };
    const v = view(none, 'EAST');
    expect(rackWallSummary(v.a.racks, v.runs, 'EAST').text).toBe('East wall: no racks.');
  });
  it('for the Test case, the words and the circles agree on every wall and add up to the total', () => {
    const rows = sum(testCaseProject());
    for (const r of rows) expect(r.drawn, r.w).toBe(r.said.bottles);
    expect(rows.reduce((n, r) => n + r.said.bottles, 0)).toBe(1120);
  });
  it('and for every bottle style, door wall and door type the lite tool can make (circles = words = total)', () => {
    for (const bottle of BOTTLES) for (const doorWall of WALLS) for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) {
      const p = liteToProject({ ...defaultLite(), bottle, doorWall, doorStyle });
      const rows = sum(p);
      const total = analyseApp(p).racks.total;
      const counted = rows.reduce((n, r) => n + r.said.bottles, 0);
      for (const r of rows) expect(r.drawn, `${bottle} ${doorWall} ${doorStyle} ${r.w}`).toBe(r.said.bottles + r.said.uncountedBottles);
      expect(counted, `${bottle} ${doorWall} ${doorStyle}`).toBe(total.status === 'OK' ? total.capacity : -1);
    }
  });
  it('a run with an error is named as not counted, and its bottles are not in the count', () => {
    const magnum = { ...testCaseProject(), bottle: 'MAGNUM' as const };
    const { a, runs } = view(magnum, 'NORTH');
    const s = rackWallSummary(a.racks, runs, 'NORTH');
    expect(s.bottles).toBe(0);
    expect(s.uncountedBottles).toBeGreaterThan(0);
    expect(s.text).toMatch(/not counted/);
  });
  it('a unit with values missing says no bottles are counted for it', () => {
    const missing = { ...sampleProject(), runs: [{ id: 'r1', wall: 'NORTH' as const, startMm: 0, units: 2 }], rackSpec: { ...sampleProject().rackSpec, unitWidthMm: 600, unitDepthMm: 350 } };
    const { a, runs } = view(missing, 'NORTH');
    expect(rackWallSummary(a.racks, runs, 'NORTH').text).toMatch(/2 units with rack values not set, so no bottles counted/);
  });
});
