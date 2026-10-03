// Fly-through path (Spec Addition A1, C3). Expectations are hand-derived; see tests/scenarios/NOTES.md "Fly-through (M4.5)".
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pointInPolygonInclusive, type Room, type SavedView, type Vec2 } from '../../src/engine';
import {
  AUTO_DWELL, autoStops, buildTour, catmullRom, EYE_HEIGHT, MAX_LEG_SECONDS, MIN_LEG_SECONDS, roomCentroid, SAVED_DWELL, sampleTour,
  stopAt, tourFromStops,
} from '../../src/render3d/tour';
import { makeDoor, makeRoom, rectVertices, ringWalls } from '../helpers';

const view = (id: string, x: number, y: number, z: number): SavedView => ({
  id, name: `View ${id}`, cameraPosition: [x, y, z], target: [2, 1, 2.5], projection: 'perspective', zoom: 1,
});
const inside = (room: Room, p: [number, number, number]): boolean => pointInPolygonInclusive({ x: p[0], y: p[2] }, room.vertices.map((v) => v.position), 0);
const withDoor = (): Room => makeRoom({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1, width: 0.9, height: 2.04 })] });
const lShape = (): Room => {
  const vs = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]].map(([x, y], i) => ({ id: `v${i + 1}`, position: { x, y } }));
  return makeRoom({ vertices: vs, walls: ringWalls(vs), fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1 })] });
};

describe('automatic stops', () => {
  // 4 x 5 room, door on w1 (y = 0, interior normal +y) centred at x = 1. Entrance = door centre + 0.6 m inside = (1, 0.6) at eye height,
  // looking at the centroid (2, 2.5) at 1.0 m. Corner stand points are inset 0.45 m along the corner bisector (0.318 m on each axis).
  // Corners within 1.5 m of the entrance are skipped (the (0,0) corner is 0.74 m away); of the other three, the farthest are used,
  // ordered counter-clockwise around the centre starting from the entrance: (4,0), (4,5), (0,5).
  it('is: overview, entrance, then three far-corner diagonals around the room', () => {
    const stops = autoStops(withDoor());
    expect(stops.map((s) => s.label)).toEqual(['Overview', 'Entrance', 'Corner view', 'Corner view', 'Corner view']);
    expect(stops[1].position[0]).toBeCloseTo(1, 12);
    expect(stops[1].position[1]).toBe(EYE_HEIGHT);
    expect(stops[1].position[2]).toBeCloseTo(0.6, 12);
    expect(stops[1].target).toEqual([2, 1, 2.5]);
    const k = 0.45 * Math.SQRT1_2; // 0.31820
    expect(stops[2].position[0]).toBeCloseTo(4 - k, 9); // corner (4, 0)
    expect(stops[2].position[2]).toBeCloseTo(k, 9);
    expect(stops[3].position[0]).toBeCloseTo(4 - k, 9); // corner (4, 5)
    expect(stops[3].position[2]).toBeCloseTo(5 - k, 9);
    expect(stops[4].position[0]).toBeCloseTo(k, 9); // corner (0, 5)
    expect(stops[4].position[2]).toBeCloseTo(5 - k, 9);
    // look across the room: target = centre + 0.25 x (centre - stand point)
    expect(stops[3].target[0]).toBeCloseTo(2 + 0.25 * (2 - (4 - k)), 9);
    expect(stops[3].target[2]).toBeCloseTo(2.5 + 0.25 * (2.5 - (5 - k)), 9);
  });

  it('the overview is outside and above the room; every other stop is inside it at eye height', () => {
    const room = withDoor();
    const [overview, ...rest] = autoStops(room);
    expect(overview.position[1]).toBeGreaterThan(room.wallHeight);
    for (const s of rest) { expect(inside(room, s.position)).toBe(true); expect(s.position[1]).toBe(EYE_HEIGHT); }
  });

  it('works with no door (the entrance becomes a corner view) and is deterministic', () => {
    const room = makeRoom();
    const a = autoStops(room);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(autoStops(room)));
    for (const s of a.slice(1)) expect(inside(room, s.position)).toBe(true);
  });

  it('works for an L-shaped room: only convex corners, all inside', () => {
    const room = lShape();
    const stops = autoStops(room).slice(1);
    expect(stops.length).toBeGreaterThanOrEqual(3);
    for (const s of stops) expect(inside(room, s.position)).toBe(true);
    // the reflex corner (3, 3) is never a stand point: nothing stands within 0.2 m of it
    for (const s of stops.slice(1)) expect(Math.hypot(s.position[0] - 3, s.position[2] - 3)).toBeGreaterThan(0.2);
  });

  it('roomCentroid of a 4 x 5 rectangle is (2, 2.5); of the L it is the area centroid', () => {
    expect(roomCentroid(makeRoom())).toEqual({ x: 2, y: 2.5 });
    // L: 6x3 block (area 18, centroid (3, 1.5)) + 3x3 block (area 9, centroid (1.5, 4.5)) -> ((18*3 + 9*1.5)/27, (18*1.5 + 9*4.5)/27) = (2.5, 2.5)
    const c = roomCentroid(lShape());
    expect(c.x).toBeCloseTo(2.5, 9);
    expect(c.y).toBeCloseTo(2.5, 9);
  });
});

describe('stops from saved views', () => {
  it('two or more saved views are the tour, in order, and nothing is added', () => {
    const t = buildTour(withDoor(), [view('a', 9, 8, 9), view('b', -3, 7, 8)]);
    expect(t.stops.map((s) => s.label)).toEqual(['View a', 'View b']);
    expect(t.stops.every((s) => s.source === 'saved' && s.dwell === SAVED_DWELL)).toBe(true);
  });
  it('a single saved view is kept as the first stop and the rest are automatic (no second overview)', () => {
    const t = buildTour(withDoor(), [view('a', 9, 8, 9)]);
    expect(t.stops[0].label).toBe('View a');
    expect(t.stops.slice(1).map((s) => s.label)).toEqual(['Entrance', 'Corner view', 'Corner view', 'Corner view']);
    expect(t.stops.slice(1).every((s) => s.dwell === AUTO_DWELL)).toBe(true);
  });
  it('the saved camera is used exactly', () => {
    const t = buildTour(withDoor(), [view('a', 8.375, 7.675, 9.325), view('b', 1, 2, 3)]);
    expect(sampleTour(t, 0).position).toEqual([8.375, 7.675, 9.325]);
  });
});

describe('timeline', () => {
  const t = buildTour(withDoor(), [], true);
  it('rests at every stop, travels every leg (including back to the first when looping), and legs are clamped to 3-8 s', () => {
    const dwells = t.segments.filter((s) => s.kind === 'dwell');
    const legs = t.segments.filter((s) => s.kind === 'travel');
    expect(dwells).toHaveLength(t.stops.length);
    expect(legs).toHaveLength(t.stops.length); // looping: n legs
    for (const l of legs) { expect(l.t1 - l.t0).toBeGreaterThanOrEqual(MIN_LEG_SECONDS); expect(l.t1 - l.t0).toBeLessThanOrEqual(MAX_LEG_SECONDS); }
    expect(t.duration).toBeCloseTo(t.segments[t.segments.length - 1].t1, 12);
    expect(buildTour(withDoor(), [], false).segments.filter((s) => s.kind === 'travel')).toHaveLength(t.stops.length - 1);
  });
  it('segments are contiguous from 0', () => {
    let at = 0;
    for (const s of t.segments) { expect(s.t0).toBeCloseTo(at, 12); at = s.t1; }
  });
  it('t = 0 is the first stop; each stop is reached exactly at the end of its leg', () => {
    expect(sampleTour(t, 0).position).toEqual(t.stops[0].position);
    for (const s of t.segments.filter((x) => x.kind === 'travel')) {
      const next = t.stops[(s.from + 1) % t.stops.length];
      const p = sampleTour(t, s.t1 - 1e-9).position;
      for (let i = 0; i < 3; i++) expect(p[i]).toBeCloseTo(next.position[i], 5);
    }
  });
  it('a looping tour wraps; a one-pass tour holds the last stop', () => {
    expect(sampleTour(t, t.duration + 1).position).toEqual(sampleTour(t, 1).position);
    const one = buildTour(withDoor(), [], false);
    const last = one.stops[one.stops.length - 1];
    expect(sampleTour(one, one.duration + 50).position).toEqual(last.position);
  });
  it('the camera never moves faster than 4 m/s (eased legs peak at 1.5 x the average speed)', () => {
    let prev = sampleTour(t, 0).position;
    for (let s = 0.02; s < t.duration; s += 0.02) {
      const p = sampleTour(t, s).position;
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) / 0.02).toBeLessThan(4);
      prev = p;
    }
  });
  it('stopAt names the stop at or heading to', () => {
    expect(stopAt(t, 0)).toBe(0);
    const firstLeg = t.segments.find((s) => s.kind === 'travel')!;
    expect(stopAt(t, (firstLeg.t0 + firstLeg.t1) / 2)).toBe(1);
  });
  it('a one-stop tour is just a rest', () => {
    const one = tourFromStops([t.stops[0]], true);
    expect(one.segments).toHaveLength(1);
    expect(sampleTour(one, 123).position).toEqual(t.stops[0].position);
  });
  it('catmullRom passes through its end points and a straight line stays straight', () => {
    const a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [1, 0, 0], c: [number, number, number] = [2, 0, 0], d: [number, number, number] = [3, 0, 0];
    expect(catmullRom(a, b, c, d, 0)).toEqual(b);
    expect(catmullRom(a, b, c, d, 1)[0]).toBeCloseTo(2, 12);
    expect(catmullRom(a, b, c, d, 0.5)[1]).toBeCloseTo(0, 12);
  });
  it('sampling an empty tour is an error', () => {
    expect(() => sampleTour(tourFromStops([], true), 0)).toThrow();
  });
});

describe('paths stay inside rooms', () => {
  const interiorLegs = (room: Room): Array<[number, number]> => {
    const t = buildTour(room, [], true);
    return t.segments.filter((s) => s.kind === 'travel' && s.from >= 1 && (s.from + 1) % t.stops.length >= 1).map((s) => [s.t0, s.t1]);
  };
  it('between the interior stops the camera stays inside a rectangular room (any size, any door)', () => {
    fc.assert(fc.property(
      fc.double({ min: 3, max: 12, noNaN: true }), fc.double({ min: 3, max: 12, noNaN: true }), fc.double({ min: 0.1, max: 0.9, noNaN: true }),
      (w, l, frac) => {
        const W = Math.round(w * 100) / 100;
        const vs = rectVertices(W, Math.round(l * 100) / 100);
        const room = makeRoom({
          vertices: vs, walls: ringWalls(vs),
          fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: Math.max(0.55, Math.min(W - 0.55, W * frac)), width: 0.9 })],
        });
        const t = buildTour(room, [], true);
        for (const [t0, t1] of interiorLegs(room)) {
          for (let s = t0; s <= t1; s += (t1 - t0) / 40) if (!inside(room, sampleTour(t, s).position)) return false;
        }
        return true;
      },
    ), { numRuns: 100, seed: 20261005 });
  });
  it("the owner's cut-corner room (7 corners, one door) gets a full tour that stays inside", () => {
    const pts: Vec2[] = [{ x: -0.9, y: 4.5 }, { x: -0.9, y: 1.5 }, { x: 0, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 5 }, { x: 0.108, y: 5 }, { x: -0.9, y: 4.954 }];
    const vs = pts.map((position, i) => ({ id: `v${i + 1}`, position }));
    const room = makeRoom({ vertices: vs, walls: ringWalls(vs), fixtures: [makeDoor({ id: 'd', wallId: 'w2', offsetAlongWall: 0.569, width: 0.82, height: 2.04 })] });
    const t = buildTour(room, [], true);
    expect(t.stops.length).toBeGreaterThanOrEqual(4);
    for (const s of t.stops.slice(1)) expect(inside(room, s.position)).toBe(true);
    for (const [t0, t1] of interiorLegs(room)) {
      for (let s = t0; s <= t1; s += (t1 - t0) / 40) expect(inside(room, sampleTour(t, s).position)).toBe(true);
    }
  });
});
