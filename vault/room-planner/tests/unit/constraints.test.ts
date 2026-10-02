import { describe, expect, it } from 'vitest';
import {
  ARC_MAX_ERROR, ARC_MAX_STEP_RAD, arcSegmentCount, checkDoorVsDoor, checkFixtureInWall, checkFurnitureVsDoor, clearanceZones,
  doorShapes, wallGeometry,
} from '../../src/engine';
import type { Fixture } from '../../src/engine';
import { makeDoor, makeInstance, makeRoom } from '../helpers';

const room = makeRoom(); // 4 x 5, wall w1 runs (0,0) -> (4,0), interior up (+y)
const deg = (d: number) => (d * Math.PI) / 180;
const tiny = (id: string, x: number, y: number, s = 0.04) => makeInstance({ id, position: { x, y }, width: s, length: s, height: 0.9 });
const hits = (door: Fixture, chair: ReturnType<typeof tiny>) =>
  checkFurnitureVsDoor(chair, door, doorShapes(room, door)!).map((v) => `${v.type}:${v.severity}`);

describe('wall geometry', () => {
  it('derives direction, length and the interior normal (left of a CCW boundary)', () => {
    const g = wallGeometry(room, 'w1')!;
    expect(g.length).toBe(4);
    expect(g.dir).toEqual({ x: 1, y: 0 });
    expect(g.normal).toEqual({ x: -0, y: 1 });
  });
  it('unknown wall -> undefined', () => {
    expect(wallGeometry(room, 'nope')).toBeUndefined();
  });
});

describe('fixture-in-wall (C8, §4 vertical validity)', () => {
  const win = (over: Partial<Fixture> = {}): Fixture => ({
    id: 'win', type: 'window', wallId: 'w1', offsetAlongWall: 2, width: 1.2, height: 1.2, elevation: 0.9, ...over,
  });
  it('fully inside the segment is valid', () => {
    expect(checkFixtureInWall(room, win())).toEqual([]);
  });
  it('edge exactly 50 mm from the wall end is valid; 49 mm is not', () => {
    expect(checkFixtureInWall(room, win({ offsetAlongWall: 0.65 }))).toEqual([]); // lo = 0.05
    expect(checkFixtureInWall(room, win({ offsetAlongWall: 0.649 })).map((v) => v.type)).toEqual(['fixture_out_of_wall']);
    expect(checkFixtureInWall(room, win({ offsetAlongWall: 3.35 }))).toEqual([]); // hi = 3.95
    expect(checkFixtureInWall(room, win({ offsetAlongWall: 3.351 })).map((v) => v.type)).toEqual(['fixture_out_of_wall']);
  });
  it('centred offset measured from the START vertex: offset below half-width overlaps the end margin', () => {
    expect(checkFixtureInWall(room, win({ offsetAlongWall: 0.3 }))).toHaveLength(1);
  });
  it('completely outside the segment', () => {
    expect(checkFixtureInWall(room, win({ offsetAlongWall: 9 }))).toHaveLength(1);
    expect(checkFixtureInWall(room, win({ offsetAlongWall: -1 }))).toHaveLength(1);
  });
  it('fixture wider than L - 0.1 m cannot be placed', () => {
    expect(checkFixtureInWall(room, win({ width: 3.95, offsetAlongWall: 2 }))).toHaveLength(1);
    expect(checkFixtureInWall(room, win({ width: 3.9, offsetAlongWall: 2 }))).toEqual([]); // exactly L - 0.1
  });
  it('vertical: window taller than the wall', () => {
    expect(checkFixtureInWall(room, win({ height: 3, elevation: 0.9 })).map((v) => v.type)).toEqual(['fixture_out_of_wall']);
  });
  it('vertical: negative elevation', () => {
    expect(checkFixtureInWall(room, win({ elevation: -0.1 }))).toHaveLength(1);
  });
  it('vertical: a door must sit at elevation 0', () => {
    expect(checkFixtureInWall(room, makeDoor({ id: 'd', elevation: 0.1 }))).toHaveLength(1);
    expect(checkFixtureInWall(room, makeDoor({ id: 'd' }))).toEqual([]);
  });
  it('a fixture on an unknown wall is out of wall', () => {
    expect(checkFixtureInWall(room, win({ wallId: 'ghost' }))).toHaveLength(1);
  });
  it('violations are hard and name the fixture and wall', () => {
    const [v] = checkFixtureInWall(room, win({ offsetAlongWall: 9 }));
    expect(v.severity).toBe('hard');
    expect(v.involvedFixtureIds).toEqual(['win']);
    expect(v.involvedWallIds).toEqual(['w1']);
  });
});

describe('arc discretization (Phase 1 §7)', () => {
  it.each([[0.9], [0.05], [1.2], [10]])('radius %s respects both limits', (r) => {
    const angle = Math.PI / 2;
    const n = arcSegmentCount(angle, r);
    const step = angle / n;
    expect(step).toBeLessThanOrEqual(ARC_MAX_STEP_RAD + 1e-12);
    expect(r * (1 - Math.cos(step / 2))).toBeLessThanOrEqual(ARC_MAX_ERROR + 1e-12);
  });
  it('known counts: r=0.9 -> 24 (error limit binds), r=0.05 -> 18 (5° limit binds)', () => {
    expect(arcSegmentCount(Math.PI / 2, 0.9)).toBe(24);
    expect(arcSegmentCount(Math.PI / 2, 0.05)).toBe(18);
  });
});

describe('door swing geometry', () => {
  // door centre (2,0), width 0.9, left hinge => hinge (2.45, 0); right hinge => (1.55, 0)
  it('hinge point comes from the wall, offset and hinge side', () => {
    expect(doorShapes(room, makeDoor({ id: 'd', hingeSide: 'left' }))!.hinge.x).toBeCloseTo(2.45, 12);
    expect(doorShapes(room, makeDoor({ id: 'd', hingeSide: 'right' }))!.hinge.x).toBeCloseTo(1.55, 12);
  });
  it('windows have no swing; unknown wall has none', () => {
    expect(doorShapes(room, { id: 'w', type: 'window', wallId: 'w1', offsetAlongWall: 2, width: 1, height: 1, elevation: 1 })).toBeUndefined();
    expect(doorShapes(room, makeDoor({ id: 'd', wallId: 'x' }))).toBeUndefined();
  });
  it('clear: nothing in the swing -> no violation', () => {
    expect(hits(makeDoor({ id: 'd' }), tiny('c', 3.5, 3))).toEqual([]);
  });
  it('intersecting the leaf sweep -> hard door_swing', () => {
    expect(hits(makeDoor({ id: 'd' }), tiny('c', 2.0, 0.25))).toEqual(['door_swing:hard']);
  });
  it('90 degrees: an object on the far side of the hinge is clear', () => {
    expect(hits(makeDoor({ id: 'd' }), tiny('c', 2.9, 0.2))).toEqual([]); // polar 24 deg from the hinge, outside 90..180
  });
  it('180 degrees: the same object is now inside the sweep', () => {
    expect(hits(makeDoor({ id: 'd', swingAngle: Math.PI }), tiny('c', 2.9, 0.2))).toEqual(['door_swing:hard']);
  });
  it('75 degrees: 5 degrees outside the sweep is clear, 5 degrees inside is blocked', () => {
    const door = makeDoor({ id: 'd', swingAngle: deg(75) }); // sweep covers polar 105..180 about (2.45, 0)
    expect(hits(door, tiny('c', 2.45 + 0.5 * Math.cos(deg(100)), 0.5 * Math.sin(deg(100)), 0.02))).toEqual([]);
    expect(hits(door, tiny('c', 2.45 + 0.5 * Math.cos(deg(110)), 0.5 * Math.sin(deg(110)), 0.02))).toEqual(['door_swing:hard']);
  });
  it('hinge side: with a 50 degree swing the same object is blocked by a right hinge but not a left one', () => {
    const chair = tiny('c', 2.3, 0.35);
    expect(hits(makeDoor({ id: 'd', swingAngle: deg(50), hingeSide: 'left' }), chair)).toEqual([]);
    expect(hits(makeDoor({ id: 'd', swingAngle: deg(50), hingeSide: 'right' }), chair)).toEqual(['door_swing:hard']);
  });
  it('access zone: beyond the leaf radius -> hard fixture_access (not door_swing)', () => {
    const door = makeDoor({ id: 'd', accessZoneDepth: 0.5 });
    // centre at polar 135 deg, r = 1.0 from the hinge; all corners are at r >= 0.929 > 0.9 and <= 1.07 < 1.4
    const c = tiny('c', 2.45 + Math.cos(deg(135)), Math.sin(deg(135)), 0.1);
    expect(hits(door, c)).toEqual(['fixture_access:hard']);
  });
  it('no access zone depth -> no access violation', () => {
    const c = tiny('c', 2.45 + Math.cos(deg(135)), Math.sin(deg(135)), 0.1);
    expect(hits(makeDoor({ id: 'd' }), c)).toEqual([]);
  });
  it('elevated object above the door head is not blocked (vertical interval)', () => {
    const c = makeInstance({ id: 'c', position: { x: 2, y: 0.25 }, width: 0.04, length: 0.04, elevation: 2.1, height: 0.5 });
    expect(checkFurnitureVsDoor(c, makeDoor({ id: 'd' }), doorShapes(room, makeDoor({ id: 'd' }))!)).toEqual([]);
  });
  it('door-vs-door overlap is a SOFT violation naming both fixtures', () => {
    const a = makeDoor({ id: 'a', offsetAlongWall: 2, hingeSide: 'left' });
    const b = makeDoor({ id: 'b', offsetAlongWall: 1, width: 0.8, hingeSide: 'right', accessZoneDepth: 0.3 });
    const out = checkDoorVsDoor(a, doorShapes(room, a)!, b, doorShapes(room, b)!);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'door_swing', severity: 'soft', involvedFixtureIds: ['a', 'b'] });
  });
  it('doors far apart do not conflict', () => {
    const a = makeDoor({ id: 'a', offsetAlongWall: 1 });
    const b = makeDoor({ id: 'b', offsetAlongWall: 3.2 });
    expect(checkDoorVsDoor(a, doorShapes(room, a)!, b, doorShapes(room, b)!)).toEqual([]);
  });
});

describe('clearance zone geometry (Spec §3)', () => {
  const sofa = makeInstance({ id: 's', position: { x: 3, y: 3 }, width: 2, length: 0.9, height: 0.85 });
  it('front zone extends `offset` from the front edge in the local frame', () => {
    const [z] = clearanceZones(sofa, [{ side: 'front', offset: 0.75, severity: 'hard' }]);
    const want = [{ x: 2, y: 3.45 }, { x: 4, y: 3.45 }, { x: 4, y: 4.2 }, { x: 2, y: 4.2 }];
    z.polygon.forEach((p, i) => {
      expect(p.x).toBeCloseTo(want[i].x, 9);
      expect(p.y).toBeCloseTo(want[i].y, 9);
    });
  });
  it("'all' yields four edge rectangles; zero offset yields none", () => {
    expect(clearanceZones(sofa, [{ side: 'all', offset: 0.5, severity: 'soft' }])).toHaveLength(4);
    expect(clearanceZones(sofa, [{ side: 'front', offset: 0, severity: 'soft' }])).toHaveLength(0);
  });
  it('rotated 90 degrees: the front zone faces world -X', () => {
    const rotated = makeInstance({ id: 's', position: { x: 5, y: 4.5 }, width: 2, length: 0.9, rotation: Math.PI / 2 });
    const [z] = clearanceZones(rotated, [{ side: 'front', offset: 0.75, severity: 'hard' }]);
    const xs = z.polygon.map((p) => p.x);
    const ys = z.polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(3.8, 9);
    expect(Math.max(...xs)).toBeCloseTo(4.55, 9);
    expect(Math.min(...ys)).toBeCloseTo(3.5, 9);
    expect(Math.max(...ys)).toBeCloseTo(5.5, 9);
  });
  it('side-specific policies: left and right are the local -X / +X faces', () => {
    const [l] = clearanceZones(sofa, [{ side: 'left', offset: 0.3, severity: 'soft' }]);
    const [r] = clearanceZones(sofa, [{ side: 'right', offset: 0.3, severity: 'soft' }]);
    expect(Math.min(...l.polygon.map((p) => p.x))).toBeCloseTo(1.7, 9);
    expect(Math.max(...r.polygon.map((p) => p.x))).toBeCloseTo(4.3, 9);
  });
});
