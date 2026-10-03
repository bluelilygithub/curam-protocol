// Walk mode (Spec Addition A1, C4). Expectations are hand-derived; see tests/scenarios/NOTES.md "Walk mode (M4.5)".
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distToPolygonBoundary, footprintOf, pointInPolygonInclusive, type FurnitureInstance, type Room, type Vec2 } from '../../src/engine';
import {
  blockingFootprints, HEAD_HEIGHT, isWalkable, KNEE_HEIGHT, MAX_PITCH, nearestWalkable, NO_INPUT, RUN_SPEED, stepWalk, TURN_RATE, WALK_EYE,
  WALK_RADIUS, WALK_SPEED, walkPose, walkStart, walkStep, type WalkState,
} from '../../src/render3d/walk';
import { makeDoor, makeInstance, makeRoom, rectVertices, ringWalls } from '../helpers';

const R = WALK_RADIUS;
const item = (id: string, x: number, y: number, w: number, l: number, h: number, o: Partial<FurnitureInstance> = {}): FurnitureInstance =>
  makeInstance({ id, position: { x, y }, width: w, length: l, height: h, ...o });
const roomWith = (...furniture: FurnitureInstance[]): Room => makeRoom({ furniture });
const lShape = (furniture: FurnitureInstance[] = []): Room => {
  const vs = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]].map(([x, y], i) => ({ id: `v${i + 1}`, position: { x, y } }));
  return makeRoom({ vertices: vs, walls: ringWalls(vs), furniture });
};

describe('walls (4 x 5 room, inside faces at x = 0 and 4, y = 0 and 5)', () => {
  const room = makeRoom();
  it('walking straight into a wall stops one radius short of its inside face', () => {
    const p = walkStep(room, { x: 2, y: 2.5 }, { x: 5, y: 0 });
    expect(p.x).toBeCloseTo(4 - R, 9);
    expect(p.y).toBeCloseTo(2.5, 9);
  });
  it('walking along a wall at an angle slides: x is held at 3.75, y carries on the full 1 m', () => {
    const p = walkStep(room, { x: 3.7, y: 2 }, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(3.75, 9);
    expect(p.y).toBeCloseTo(3, 9);
  });
  it('a corner stops the walker one radius from both walls', () => {
    const p = walkStep(room, { x: 3, y: 4 }, { x: 5, y: 5 });
    expect(p.x).toBeCloseTo(4 - R, 9);
    expect(p.y).toBeCloseTo(5 - R, 9);
  });
  it('a very long step does not tunnel through a wall', () => {
    const p = walkStep(room, { x: 2, y: 2.5 }, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(4 - R, 9);
  });
  it('a door opening does not let the walker out: the room is the whole world', () => {
    const withDoor = makeRoom({ fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1, width: 0.9 })] });
    const p = walkStep(withDoor, { x: 1, y: 1 }, { x: 0, y: -5 });
    expect(p.y).toBeCloseTo(R, 9);
  });
  it('open floor is not slowed: the step is exact', () => {
    const p = walkStep(room, { x: 1, y: 1 }, { x: 0.8, y: 0.6 });
    expect(p.x).toBeCloseTo(1.8, 12);
    expect(p.y).toBeCloseTo(1.6, 12);
  });
});

describe('furniture', () => {
  // sofa 2 x 1 at (2, 2.5): footprint x 1..3, y 2..3
  const sofa = item('sofa', 2, 2.5, 2, 1, 0.85);
  it('stops one radius short of a sofa in the way', () => {
    const p = walkStep(roomWith(sofa), { x: 2, y: 1 }, { x: 0, y: 3 });
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(2 - R, 9);
  });
  it('slides along its side when walking at it diagonally', () => {
    // from (0.5, 2.5) heading (+1, +0.3): blocked by the sofa side x = 1 (held at 0.75); y carries on the full 0.3 to 2.8, still beside it
    const p = walkStep(roomWith(sofa), { x: 0.5, y: 2.5 }, { x: 1, y: 0.3 });
    expect(p.x).toBeCloseTo(1 - R, 9);
    expect(p.y).toBeCloseTo(2.8, 9);
  });
  it('rounds a corner at exactly one radius', () => {
    const p = walkStep(roomWith(sofa), { x: 0.5, y: 1.2 }, { x: 0.9, y: 0.9 });
    // aimed at the corner (1, 2): ends on the circle of radius R around it or beyond, never inside
    expect(Math.hypot(p.x - 1, p.y - 2)).toBeGreaterThanOrEqual(R - 1e-7);
    expect(isWalkable(roomWith(sofa), p)).toBe(true);
  });
  it('a thin shelf (2 m x 0.1 m) is not tunnelled by a 3 m step: stops at 2.5 − 0.05 − 0.25', () => {
    const shelf = item('shelf', 2, 2.5, 2, 0.1, 1.0);
    expect(walkStep(roomWith(shelf), { x: 2, y: 1 }, { x: 0, y: 3 }).y).toBeCloseTo(2.2, 9);
  });
  it('a rotated sofa blocks along its real outline', () => {
    const turned = item('s', 2, 2.5, 2, 1, 0.85, { rotation: Math.PI / 4 });
    const room = roomWith(turned);
    for (const from of [{ x: 0.9, y: 2.5 }, { x: 2, y: 0.9 }, { x: 3.4, y: 3.8 }]) {
      const p = walkStep(room, from, { x: 2 - from.x, y: 2.5 - from.y }); // straight at its centre
      const fp = footprintOf(turned);
      expect(pointInPolygonInclusive(p, fp, 0)).toBe(false);
      expect(distToPolygonBoundary(p, fp)).toBeGreaterThanOrEqual(R - 1e-7);
    }
  });
  it('what blocks: top above the knee and underside below the head; rugs and high shelves do not', () => {
    const rug = item('rug', 2, 2.5, 2, 2, 0.02);
    const low = item('low', 2, 2.5, 1, 1, KNEE_HEIGHT); // top exactly at the knee: does not block
    const table = item('table', 2, 2.5, 1, 1, 0.42);
    const high = item('high', 2, 2.5, 1, 1, 0.3, { elevation: HEAD_HEIGHT }); // underside exactly at head height: does not block
    const mid = item('mid', 2, 2.5, 1, 1, 0.5, { elevation: 1.0 });
    expect(blockingFootprints(roomWith(rug, low, high))).toHaveLength(0);
    expect(blockingFootprints(roomWith(table))).toHaveLength(1);
    expect(blockingFootprints(roomWith(mid))).toHaveLength(1);
    expect(walkStep(roomWith(rug), { x: 2, y: 1 }, { x: 0, y: 3 }).y).toBeCloseTo(4, 9); // walks straight over the rug
    expect(walkStep(roomWith(high), { x: 2, y: 1 }, { x: 0, y: 3 }).y).toBeCloseTo(4, 9); // under the high shelf
  });
  it('in an L-shaped room the reflex corner is kept a radius away', () => {
    const p = walkStep(lShape(), { x: 2, y: 2 }, { x: 1.5, y: 1.5 });
    expect(Math.hypot(p.x - 3, p.y - 3)).toBeGreaterThanOrEqual(R - 1e-7);
    expect(isWalkable(lShape(), p)).toBe(true);
  });
});

describe('where walking starts', () => {
  it('at the entrance (0.6 m inside the door) looking at the centre of the room', () => {
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1, width: 0.9 })] });
    const s = walkStart(room)!;
    expect(s.position.x).toBeCloseTo(1, 12);
    expect(s.position.y).toBeCloseTo(0.6, 12);
    expect(s.yaw).toBeCloseTo(Math.atan2(1.9, 1), 12); // towards (2, 2.5)
    expect(s.pitch).toBe(0);
  });
  it('moves off furniture standing at the entrance', () => {
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1, width: 0.9 })], furniture: [item('blocker', 1, 0.7, 1.4, 0.8, 1)] });
    const s = walkStart(room)!;
    expect(isWalkable(room, s.position)).toBe(true);
    expect(s.position.y).toBeGreaterThan(0.6 - 1e-9 - 0.0001);
  });
  it('has nowhere to start in a room too small to stand in', () => {
    const vs = rectVertices(0.4, 0.4);
    expect(walkStart(makeRoom({ vertices: vs, walls: ringWalls(vs) }))).toBeNull();
  });
  it('nearestWalkable returns the point itself when it is fine and null when nothing is', () => {
    expect(nearestWalkable(makeRoom(), { x: 2, y: 2 })).toEqual({ x: 2, y: 2 });
    const full = roomWith(item('big', 2, 2.5, 4, 5, 1));
    expect(nearestWalkable(full, { x: 2, y: 2 })).toBeNull();
  });
});

describe('moving and looking', () => {
  const room = makeRoom();
  const at = (x: number, y: number, yaw = 0, pitch = 0): WalkState => ({ position: { x, y }, yaw, pitch });
  it('forward moves along the way the camera faces at 1.4 m/s; running at 2.4 m/s', () => {
    expect(stepWalk(room, at(1, 2), { ...NO_INPUT, forward: 1 }, 1).position.x).toBeCloseTo(1 + WALK_SPEED, 12);
    expect(stepWalk(room, at(1, 2), { ...NO_INPUT, forward: 1, run: true }, 1).position.x).toBeCloseTo(1 + RUN_SPEED, 12);
    const north = stepWalk(room, at(2, 1, Math.PI / 2), { ...NO_INPUT, forward: 1 }, 1).position;
    expect(north.x).toBeCloseTo(2, 12);
    expect(north.y).toBeCloseTo(1 + WALK_SPEED, 12);
  });
  it('strafe goes to the right of the facing direction; back goes the other way', () => {
    const right = stepWalk(room, at(2, 2), { ...NO_INPUT, strafe: 1 }, 0.5).position; // facing +x, right is +y
    expect(right.x).toBeCloseTo(2, 12);
    expect(right.y).toBeCloseTo(2 + 0.7, 12);
    expect(stepWalk(room, at(2, 2), { ...NO_INPUT, forward: -1 }, 0.5).position.x).toBeCloseTo(2 - 0.7, 12);
  });
  it('diagonal movement is not faster than straight movement', () => {
    const p = stepWalk(room, at(1, 1), { ...NO_INPUT, forward: 1, strafe: 1 }, 1).position;
    expect(Math.hypot(p.x - 1, p.y - 1)).toBeCloseTo(WALK_SPEED, 9);
  });
  it('arrow-key turning, mouse look, wrap-around and the pitch limit', () => {
    expect(stepWalk(room, at(2, 2), { ...NO_INPUT, turn: 1 }, 0.5).yaw).toBeCloseTo(TURN_RATE * 0 + 0.5, 12);
    expect(stepWalk(room, at(2, 2), { ...NO_INPUT, lookYaw: 0.3 }, 0.016).yaw).toBeCloseTo(0.3, 12);
    expect(stepWalk(room, at(2, 2, Math.PI - 0.1), { ...NO_INPUT, lookYaw: 0.2 }, 0.016).yaw).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(stepWalk(room, at(2, 2), { ...NO_INPUT, lookPitch: 9 }, 0.016).pitch).toBe(MAX_PITCH);
    expect(stepWalk(room, at(2, 2), { ...NO_INPUT, lookPitch: -9 }, 0.016).pitch).toBe(-MAX_PITCH);
  });
  it('standing still with no input leaves the position exactly where it is', () => {
    expect(stepWalk(room, at(2, 2), NO_INPUT, 1).position).toEqual({ x: 2, y: 2 });
  });
  it('the camera pose is at eye height, looking along yaw and pitch', () => {
    const level = walkPose(at(2, 3, 0, 0));
    expect(level.position).toEqual([2, WALK_EYE, 3]);
    expect(level.target[0]).toBeCloseTo(3, 12);
    expect(level.target[1]).toBeCloseTo(WALK_EYE, 12);
    expect(level.target[2]).toBeCloseTo(3, 12);
    const up = walkPose(at(2, 3, Math.PI / 2, Math.PI / 6));
    expect(up.target[1]).toBeCloseTo(WALK_EYE + 0.5, 12);
    expect(up.target[2]).toBeCloseTo(3 + Math.cos(Math.PI / 6), 12);
  });
});

describe('the walker is never inside a wall or a solid object (property)', () => {
  const arbItem = fc.record({
    x: fc.double({ min: 0.5, max: 5.5, noNaN: true }), y: fc.double({ min: 0.5, max: 4.5, noNaN: true }),
    w: fc.double({ min: 0.2, max: 2.2, noNaN: true }), l: fc.double({ min: 0.2, max: 1.5, noNaN: true }),
    h: fc.double({ min: 0.05, max: 2.2, noNaN: true }), elevation: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 2, noNaN: true })),
    rot: fc.double({ min: 0, max: 6.28, noNaN: true }),
  });
  const arbStep = fc.record({ dx: fc.double({ min: -0.6, max: 0.6, noNaN: true }), dy: fc.double({ min: -0.6, max: 0.6, noNaN: true }) });

  it('after any number of steps, in rectangular and L-shaped rooms with random furniture, the position is always clear of every wall and blocker', () => {
    fc.assert(fc.property(
      fc.boolean(), fc.array(arbItem, { maxLength: 6 }), fc.double({ min: 0.3, max: 5.7, noNaN: true }), fc.double({ min: 0.3, max: 5.7, noNaN: true }),
      fc.array(arbStep, { minLength: 1, maxLength: 60 }),
      (l, items, sx, sy, steps) => {
        const furniture = items.map((o, i) => item(`i${i}`, o.x, o.y, o.w, o.l, o.h, { elevation: o.elevation, rotation: o.rot }));
        const room = l ? lShape(furniture) : makeRoom({ vertices: rectVertices(6, 6), walls: ringWalls(rectVertices(6, 6)), furniture });
        let p = nearestWalkable(room, { x: sx, y: sy });
        if (!p) return true;
        const poly = room.vertices.map((v) => v.position);
        const blockers = blockingFootprints(room);
        for (const s of steps) {
          const next = walkStep(room, p, { x: s.dx, y: s.dy });
          // never farther than asked (sliding and pushing out never add distance), never off the floor, never into anything
          if (Math.hypot(next.x - p.x, next.y - p.y) > Math.hypot(s.dx, s.dy) + 1e-6) return false;
          if (!pointInPolygonInclusive(next, poly, 0) || distToPolygonBoundary(next, poly) < R - 1e-6) return false;
          for (const b of blockers) if (pointInPolygonInclusive(next, b, 0) || distToPolygonBoundary(next, b) < R - 1e-6) return false;
          p = next;
        }
        return true;
      },
    ), { numRuns: 300, seed: 20261006 });
  });

  it('in open floor a step is exact (no invisible drag), and walking is reversible there', () => {
    fc.assert(fc.property(arbStep, ({ dx, dy }) => {
      const room = makeRoom({ vertices: rectVertices(20, 20), walls: ringWalls(rectVertices(20, 20)) });
      const a = { x: 10, y: 10 };
      const b = walkStep(room, a, { x: dx, y: dy });
      const back = walkStep(room, b, { x: -dx, y: -dy });
      return Math.abs(b.x - (10 + dx)) < 1e-12 && Math.abs(b.y - (10 + dy)) < 1e-12 && Math.abs(back.x - 10) < 1e-12 && Math.abs(back.y - 10) < 1e-12;
    }), { numRuns: 100, seed: 5 });
  });
});

// keep the type imported for documentation of the shape used above
export type _Vec2 = Vec2;
