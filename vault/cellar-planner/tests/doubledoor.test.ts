import { describe, expect, it } from 'vitest';
import { analyseEnclosure, doorLeafCount, doorLeafWidthMm, doorSwing, goldenCase02, type Enclosure } from '../src/enclosure';
import { analyseRacks, doorLeaves, doorOpening, hitsDoorSwing, type RackRun } from '../src/placement';
import type { RackSpec } from '../src/rack';
import { elevationView, planView, type Prim } from '../src/views';
import { deserializeApp, sampleProject, serializeApp } from '../src/app/model';

// A double door: two equal leaves that together fill the opening, each hinged at an outer edge and meeting in the middle. The single door is
// unchanged (Golden #02: 970 mm). Rack sizes are INVENTED.
const spec = (over: Partial<RackSpec> = {}): RackSpec => ({ unitWidthMm: 800, unitDepthMm: 350, unitHeightMm: 2000, rowPitchMm: 100, bottlesPerRow: 8, orientation: 'NECK_OUT', postsPerUnit: 2, rowsPerUnit: null, ...over });
const run = (id: string, wall: RackRun['wall'], startMm: number, units: number): RackRun => ({ id, wall, startMm, units, spec: spec(), bottle: 'BORDEAUX' });
const polys = (p: Prim[]) => p.filter((x): x is Extract<Prim, { kind: 'poly' }> => x.kind === 'poly');
const rects = (p: Prim[]) => p.filter((x): x is Extract<Prim, { kind: 'rect' }> => x.kind === 'rect');

const single = goldenCase02();
const double: Enclosure = { ...single, door: { ...single.door, widthMm: 1500, leaves: 2 } };
const doubleIn: Enclosure = { ...double, door: { ...double.door, swing: 'IN' } };

describe('door leaves', () => {
  it('an unset or 1 leaf count is a single door; 2 is a double', () => {
    expect(doorLeafCount(single)).toBe(1);
    expect(doorLeafCount({ ...single, door: { ...single.door, leaves: 1 } })).toBe(1);
    expect(doorLeafCount(double)).toBe(2);
    expect(doorLeafWidthMm(single)).toBe(970);
    expect(doorLeafWidthMm(double)).toBe(750);
  });
  it('each leaf sweeps half the opening, so a double door sweeps two 750 mm arcs, not one 1500 mm arc', () => {
    expect(doorSwing(double).radiusMm).toBe(750);
    const o = doorOpening(double);
    const leaves = doorLeaves(double);
    expect(leaves).toHaveLength(2);
    expect(leaves.map((l) => l.hingeMm).sort((a, b) => a - b)).toEqual([o.aMm, o.bMm]);
    expect(leaves.every((l) => l.radiusMm === 750 && l.otherMm === (o.aMm + o.bMm) / 2)).toBe(true);
  });
  it('the single door is exactly as before: one leaf the full width, hinged where the hinge setting says', () => {
    expect(doorLeaves(single)).toEqual([{ hingeMm: 890, otherMm: 1860, radiusMm: 970 }]);
    expect(doorLeaves({ ...single, door: { ...single.door, hinge: 'RIGHT' } })).toEqual([{ hingeMm: 1860, otherMm: 890, radiusMm: 970 }]);
  });
});

describe('checks', () => {
  it('a double door too narrow to walk through is an error; at 800 it is fine', () => {
    expect(analyseEnclosure({ ...double, door: { ...double.door, widthMm: 700 } }).issues.map((i) => i.code)).toContain('DOUBLE_DOOR_TOO_NARROW');
    expect(analyseEnclosure({ ...double, door: { ...double.door, widthMm: 800 } }).issues.map((i) => i.code)).not.toContain('DOUBLE_DOOR_TOO_NARROW');
    expect(analyseEnclosure(single).issues.map((i) => i.code)).not.toContain('DOUBLE_DOOR_TOO_NARROW');
  });
  it('a 1500 mm double door fits the 2850 mm wall and the information note names the per-leaf radius', () => {
    expect(analyseEnclosure(double).issues.map((i) => i.code)).not.toContain('DOOR_TOO_WIDE');
    expect(analyseEnclosure(doubleIn).issues.find((i) => i.code === 'DOOR_SWINGS_IN')?.message).toMatch(/750 mm radius/);
  });
  it('an inward double door keeps clear a 750 mm quarter circle at EACH end of the opening, and the middle is free', () => {
    const o = doorOpening(doubleIn); // 1500 wide centred on 2850: 675 to 2175 outer, 625 to 2125 inside
    const atHinge = { x0: o.aMm, x1: o.aMm + 100, y0: 1565 - 100, y1: 1565 }; // a block touching the west hinge
    expect(hitsDoorSwing(doubleIn, atHinge)).toBe(true);
    const middleNearWall = { x0: (o.aMm + o.bMm) / 2 - 20, x1: (o.aMm + o.bMm) / 2 + 20, y0: 1565 - 40, y1: 1565 }; // at the meeting point, right at the wall
    expect(hitsDoorSwing(doubleIn, middleNearWall)).toBe(true); // both quarter circles reach the wall at the middle
    const deepMiddle = { x0: (o.aMm + o.bMm) / 2 - 20, x1: (o.aMm + o.bMm) / 2 + 20, y0: 1565 - 800, y1: 1565 - 780 }; // beyond a 750 mm radius
    expect(hitsDoorSwing(doubleIn, deepMiddle)).toBe(false);
    expect(hitsDoorSwing(double, atHinge)).toBe(false); // outward: nothing sweeps inside
  });
  it('a rack run across the wider opening is flagged, one beside it is not', () => {
    const o = doorOpening(double);
    const codes = (r: RackRun[]) => analyseRacks(double, r).issues.map((i) => i.code);
    expect(codes([run('on', 'SOUTH', o.aMm - 100, 1)])).toContain('RUN_ON_DOOR');
    // the free wall west of the opening is 625 mm inside, so a 600 mm unit fits beside it and an 800 mm unit does not
    expect(codes([{ ...run('beside', 'SOUTH', 0, 1), spec: spec({ unitWidthMm: 600 }) }])).not.toContain('RUN_ON_DOOR');
    expect(codes([run('too-wide', 'SOUTH', 0, 1)])).toContain('RUN_ON_DOOR');
  });
});

describe('the drawings', () => {
  it('the plan draws two arcs for a double door and one for a single', () => {
    const arcs = (e: Enclosure) => polys(planView(e, [], analyseRacks(e, []))).filter((x) => x.dash && x.tone === 'door');
    expect(arcs(single)).toHaveLength(1);
    expect(arcs(double)).toHaveLength(2);
  });
  it('the plan opening is the full 1500 mm', () => {
    expect(rects(planView(double, [], analyseRacks(double, []))).find((r) => r.tone === 'door')).toMatchObject({ w: 1500 });
  });
  it('the elevation labels a double door, draws a diagonal on each leaf and a line where they meet', () => {
    const south = elevationView(double, 'SOUTH');
    expect(rects(south).find((r) => r.label === 'DOUBLE DOOR')).toMatchObject({ w: 1500, h: 2120 });
    expect(polys(south).filter((x) => x.dash && x.tone === 'door')).toHaveLength(2);
    expect(rects(elevationView(single, 'SOUTH')).find((r) => r.label === 'DOOR')).toBeTruthy();
    expect(polys(elevationView(single, 'SOUTH')).filter((x) => x.dash && x.tone === 'door')).toHaveLength(1);
  });
});

describe('saving', () => {
  it('a double door survives the saved-file round trip; a file with no leaves count opens as a single door', () => {
    const p = sampleProject();
    const withDouble = { ...p, enclosure: { ...p.enclosure, door: { ...p.enclosure.door, widthMm: 1500, leaves: 2 as const } } };
    expect(deserializeApp(serializeApp(withDouble)).enclosure.door).toMatchObject({ widthMm: 1500, leaves: 2 });
    expect(doorLeafCount(deserializeApp(serializeApp(p)).enclosure)).toBe(1);
  });
});
