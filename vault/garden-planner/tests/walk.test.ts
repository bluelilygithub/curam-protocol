import { describe, expect, it } from 'vitest';
import { apply, setItem } from '../src/domain/commands';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import type { GardenProject, Structure } from '../src/domain/types';
import {
  buildWalkWorld, isWalkable, KNEE_HEIGHT, nearestWalkable, NO_INPUT, resolveWalk, RUN_SPEED, stepWalk, TURN_RATE, WALK_EYE, WALK_RADIUS, WALK_SPEED, walkPose, walkStart, type WalkInput, type WalkState, type WalkWorld,
} from '../src/walk/walk';

let n = 0;
const sid = (): string => `s${++n}`;
const structure = (kind: Structure['kind'], x: number, y: number, w: number, l: number, h: number, rotation = 0): Structure => ({ id: sid(), kind, name: kind, position: { x, y }, width: w, length: l, height: h, rotation } as Structure);
const withStructure = (p: GardenProject, s: Structure): GardenProject => apply(setItem('structures', s.id, null, s), p);
const withPlant = (p: GardenProject, plantId: string, x: number, y: number): GardenProject => { const id = sid(); return apply(setItem('plants', id, null, { id, plantId, position: { x, y } }), p); };

/** A 20 x 20 plot with a 1.8 m fence all round, a 8 x 5 house at the back, a shed, a pool and a deck. */
const garden = (): GardenProject => {
  let p: GardenProject = { ...newGardenProject('g', { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' }, 'g1'), boundary: boundaryFromPoints(rectanglePoints(20, 20), 'colorbond') };
  p = { ...p, house: { id: 'h', vertices: rectanglePoints(8, 5, { x: 6, y: 14 }).map((position, i) => ({ id: `v${i}`, position })), height: 3.2, fixtures: [] } };
  p = withStructure(p, structure('shed', 3, 3, 2.4, 1.8, 2.2));
  p = withStructure(p, structure('pool', 15, 6, 4, 3, 0.1));
  p = withStructure(p, structure('deck', 10, 11, 3, 3, 0.3));
  return p;
};
const world = (p: GardenProject = garden(), stage: 'mature' | 'planted' = 'mature'): WalkWorld => buildWalkWorld(p, stage);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
const go = (w: WalkWorld, s: WalkState, input: Partial<WalkInput>, seconds: number, dt = 1 / 30): WalkState => {
  let cur = s;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) cur = stepWalk(w, cur, { ...NO_INPUT, ...input }, dt);
  return cur;
};
const NORTH = Math.PI / 2, EAST = 0;

describe('what blocks a walker', () => {
  it('the house, a shed, a pool and the fence block; a deck, the lawn and a path do not', () => {
    const w = world();
    expect(isWalkable(w, { x: 10, y: 16 })).toBe(false); // inside the house
    expect(isWalkable(w, { x: 3, y: 3 })).toBe(false); // the shed
    expect(isWalkable(w, { x: 15, y: 6 })).toBe(false); // the pool: nobody walks into it
    expect(isWalkable(w, { x: 10, y: 11 })).toBe(true); // onto the deck
    expect(isWalkable(w, { x: 10, y: 8 })).toBe(true); // open lawn
    expect(isWalkable(w, { x: 10, y: 0.1 })).toBe(false); // against the fence
    expect(isWalkable(w, { x: 10, y: 1 })).toBe(true);
  });

  it('keeps a full body radius from every wall', () => {
    const w = world();
    expect(isWalkable(w, { x: 6 - WALK_RADIUS + 0.01, y: 16 + 2.5 })).toBe(false);
    expect(isWalkable(w, { x: 6 - WALK_RADIUS - 0.01, y: 16 })).toBe(true);
  });

  it('things at or below knee height do not block', () => {
    const p = withStructure(garden(), structure('raised_bed', 8, 8, 2, 1, KNEE_HEIGHT));
    expect(isWalkable(world(p), { x: 8, y: 8 })).toBe(true);
    const q = withStructure(garden(), structure('raised_bed', 8, 8, 2, 1, KNEE_HEIGHT + 0.1));
    expect(isWalkable(world(q), { x: 8, y: 8 })).toBe(false);
  });

  it('a pergola and a clothesline do not block (a person walks under and past them)', () => {
    let p = withStructure(garden(), structure('pergola', 8, 8, 3, 3, 2.7));
    p = withStructure(p, structure('clothesline', 12, 8, 3, 3, 1.8));
    const w = world(p);
    expect(isWalkable(w, { x: 8, y: 8 })).toBe(true);
    expect(isWalkable(w, { x: 12, y: 8 })).toBe(true);
  });

  it('an open boundary segment does not block, a hedge blocks and is thick', () => {
    const open = garden();
    open.boundary!.segments[0] = { fence: 'open', height: 0 };
    expect(isWalkable(world(open), { x: 10, y: 0.1 })).toBe(true);
    const hedge = garden();
    hedge.boundary!.segments[0] = { fence: 'hedge', height: 1.5 };
    expect(isWalkable(world(hedge), { x: 10, y: 0.5 })).toBe(false); // 0.3 half-thickness + body radius
    expect(isWalkable(world(hedge), { x: 10, y: 0.6 })).toBe(true);
  });
});

describe('plants', () => {
  it('a tree blocks its trunk, not its leaves; a grown shrub blocks its dense core, not its edge; groundcover does not block', () => {
    let p = withPlant(garden(), 'syzygium-smithii', 5, 8); // lilly pilly tree
    p = withPlant(p, 'callistemon-little-john', 12, 8); // shrub
    p = withPlant(p, 'dichondra-repens', 15, 15); // groundcover
    const w = world(p);
    expect(isWalkable(w, { x: 5, y: 8 })).toBe(false);
    expect(isWalkable(w, { x: 5 + 1, y: 8 })).toBe(true); // under the canopy, off the trunk
    expect(isWalkable(w, { x: 12, y: 8 })).toBe(false);
    expect(isWalkable(w, { x: 12 + 1.2, y: 8 })).toBe(true);
    expect(isWalkable(w, { x: 15, y: 15 })).toBe(true);
  });

  it('plants are small when just planted, so the walker can pass where a mature plant would block', () => {
    const p = withPlant(garden(), 'syzygium-smithii', 5, 8);
    const seedling = buildWalkWorld(p, 'planted');
    const mature = buildWalkWorld(p, 'mature');
    expect(isWalkable(seedling, { x: 5, y: 8 })).toBe(true);
    expect(isWalkable(mature, { x: 5, y: 8 })).toBe(false);
  });

  it('a plant that is no longer in the library does not break anything', () => {
    const p = withPlant(garden(), 'plant-that-was-removed', 5, 8);
    expect(() => world(p)).not.toThrow();
  });
});

describe('gates', () => {
  const withGate = (): GardenProject => withStructure(garden(), structure('gate', 10, 0, 0.9, 0.1, 1.5));
  it('the fence blocks everywhere except through the gate', () => {
    const w = world(withGate());
    expect(isWalkable(w, { x: 5, y: 0 })).toBe(false);
    expect(isWalkable(w, { x: 10, y: 0 })).toBe(true); // in the gateway
    expect(isWalkable(w, { x: 10, y: -1 })).toBe(true); // outside, in the street
    expect(isWalkable(w, { x: 12, y: 0 })).toBe(false);
  });

  it('a walker can go in through the gate and out again, and cannot get through the fence beside it', () => {
    const w = world(withGate());
    let s: WalkState = { position: { x: 10, y: -2 }, yaw: NORTH, pitch: 0 };
    s = go(w, s, { forward: 1 }, 3); // 4.2 m north
    expect(s.position.y).toBeGreaterThan(1.5);
    expect(Math.abs(s.position.x - 10)).toBeLessThan(0.5);
    const back = go(w, { ...s, yaw: -NORTH }, { forward: 1 }, 3);
    expect(back.position.y).toBeLessThan(-0.5);
    // beside the gate: stopped by the fence
    const blocked = go(w, { position: { x: 14, y: -2 }, yaw: NORTH, pitch: 0 }, { forward: 1 }, 3);
    expect(blocked.position.y).toBeLessThan(0);
  });

  it('starts just inside the gate when there is one, looking at the house', () => {
    const w = world(withGate());
    const s = walkStart(w)!;
    expect(isWalkable(w, s.position)).toBe(true);
    expect(s.position.y).toBeGreaterThan(0);
    expect(s.position.y).toBeLessThan(3);
    // facing roughly north-ish towards the house centre
    expect(Math.sin(s.yaw)).toBeGreaterThan(0.5);
  });
});

describe('walking', () => {
  it('forward is the way the walker faces, strafe is to its right, back and left are the opposites', () => {
    const w = world();
    const s0: WalkState = { position: { x: 10, y: 8 }, yaw: NORTH, pitch: 0 };
    const f = go(w, s0, { forward: 1 }, 0.5);
    expect(f.position.y).toBeGreaterThan(8.5); expect(Math.abs(f.position.x - 10)).toBeLessThan(1e-6);
    const b = go(w, s0, { forward: -1 }, 0.5);
    expect(b.position.y).toBeLessThan(7.5);
    const r = go(w, s0, { strafe: 1 }, 0.5); // facing north, right is east
    expect(r.position.x).toBeGreaterThan(10.5); expect(Math.abs(r.position.y - 8)).toBeLessThan(1e-6);
    const l = go(w, s0, { strafe: -1 }, 0.5);
    expect(l.position.x).toBeLessThan(9.5);
    const e = go(w, { ...s0, yaw: EAST }, { forward: 1 }, 0.5);
    expect(e.position.x).toBeGreaterThan(10.5);
  });

  it('speeds: walking is 1.4 m/s, running 2.4, and diagonals are not faster', () => {
    const w = world();
    const s0: WalkState = { position: { x: 10, y: 5 }, yaw: NORTH, pitch: 0 };
    expect(dist(go(w, s0, { forward: 1 }, 1).position, s0.position)).toBeCloseTo(WALK_SPEED, 1);
    expect(dist(go(w, s0, { forward: 1, run: true }, 1).position, s0.position)).toBeCloseTo(RUN_SPEED, 1);
    expect(dist(go(w, s0, { forward: 1, strafe: 1 }, 1).position, s0.position)).toBeCloseTo(WALK_SPEED, 1);
  });

  it('turning right turns clockwise on the plan, looking right does too, and pitch is limited', () => {
    const w = world();
    const s0: WalkState = { position: { x: 10, y: 8 }, yaw: NORTH, pitch: 0 };
    const t = go(w, s0, { turn: 1 }, 0.5);
    expect(Math.sin(t.yaw)).toBeLessThan(1); expect(Math.cos(t.yaw)).toBeGreaterThan(0); // from north towards east
    expect(t.yaw).toBeCloseTo(NORTH - 0.5, 2); // 1 rad/s for half a second
    expect(TURN_RATE).toBeGreaterThan(0.5);
    const lk = stepWalk(w, s0, { ...NO_INPUT, lookYaw: 0.3 }, 0);
    expect(lk.yaw).toBeCloseTo(NORTH - 0.3, 6);
    const up = stepWalk(w, s0, { ...NO_INPUT, lookPitch: 10 }, 0);
    expect(up.pitch).toBeLessThan(1.5);
    expect(up.pitch).toBeCloseTo((80 * Math.PI) / 180, 6);
    expect(stepWalk(w, s0, { ...NO_INPUT, lookPitch: -10 }, 0).pitch).toBeCloseTo(-(80 * Math.PI) / 180, 6);
  });

  it('slides along a wall instead of stopping dead, and cannot pass through it', () => {
    const w = world();
    // walk north-east into the house's west wall (x = 6, y from 14 to 19): keep the northward part
    const s0: WalkState = { position: { x: 5, y: 16 }, yaw: Math.PI / 4, pitch: 0 };
    const s = go(w, s0, { forward: 1 }, 2);
    expect(s.position.x).toBeLessThan(6 - WALK_RADIUS + 1e-6);
    expect(s.position.y).toBeGreaterThan(17); // slid north along the wall
    expect(isWalkable(w, s.position)).toBe(true);
  });

  it('never ends up inside anything, whatever the walker does (random walks, runs and turns)', () => {
    let p = garden();
    p = withStructure(p, structure('gate', 10, 0, 0.9, 0.1, 1.5));
    p = withStructure(p, structure('water_tank', 18, 12, 2, 2, 2.4, 0.4));
    for (const [id, x, y] of [['syzygium-smithii', 4, 9], ['callistemon-little-john', 8, 9], ['ficus-carica', 17, 3], ['syzygium-smithii', 12, 2]] as const) p = withPlant(p, id, x, y);
    const w = world(p);
    let seed = 12345;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let trial = 0; trial < 12; trial += 1) {
      let s = walkStart(w)!;
      expect(isWalkable(w, s.position)).toBe(true);
      for (let i = 0; i < 400; i += 1) {
        s = stepWalk(w, s, { forward: rnd() * 2 - 0.6, strafe: rnd() * 2 - 1, turn: rnd() * 4 - 2, run: rnd() < 0.3, lookYaw: 0, lookPitch: 0 }, 1 / 30 + rnd() * 0.05);
        expect(isWalkable(w, s.position), `trial ${trial} step ${i} at ${s.position.x.toFixed(2)},${s.position.y.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('a very long frame (a stalled tab) does not tunnel through a wall', () => {
    const w = world();
    const s = stepWalk(w, { position: { x: 5, y: 16 }, yaw: EAST, pitch: 0 }, { ...NO_INPUT, forward: 1, run: true }, 5); // 12 m in one frame, straight at the house
    expect(isWalkable(w, s.position)).toBe(true);
    expect(s.position.x).toBeLessThan(6);
  });

  it('standing still changes nothing, and the walker cannot leave the world', () => {
    const w = world();
    const s0: WalkState = { position: { x: 10, y: 8 }, yaw: 1, pitch: 0.2 };
    expect(stepWalk(w, s0, NO_INPUT, 0.1)).toEqual(s0);
    const far = go(w, { position: { x: 10, y: -2 }, yaw: -NORTH, pitch: 0 }, { forward: 1, run: true }, 30);
    expect(far.position.y).toBeGreaterThanOrEqual(w.min.y);
  });
});

describe('starting and the camera', () => {
  it('walkStart is always a free spot, even when the middle of the plot is blocked', () => {
    let p = garden();
    p = withStructure(p, structure('shed', 10, 10, 6, 6, 2.2)); // in the middle
    const w = world(p);
    const s = walkStart(w)!;
    expect(isWalkable(w, s.position)).toBe(true);
    expect(nearestWalkable(w, { x: 10, y: 10 })).not.toBeNull();
    expect(isWalkable(w, nearestWalkable(w, { x: 10, y: 10 })!)).toBe(true);
  });

  it('an empty garden is walkable too', () => {
    const w = world(newGardenProject('empty', { label: 'x', lat: -27, lng: 153, state: 'QLD' }, 'e'));
    const s = walkStart(w)!;
    expect(s).not.toBeNull();
    expect(isWalkable(w, s.position)).toBe(true);
  });

  it('resolveWalk pushes a point out of a wall to exactly one body radius', () => {
    const w = world();
    const q = resolveWalk(w, { x: 6.05, y: 16 }); // inside the house, near its west wall
    expect(q.x).toBeCloseTo(6 - WALK_RADIUS, 6);
  });

  it('the camera is at eye height and looks along the way faced, with plan y flipped into three z', () => {
    const pose = walkPose({ position: { x: 3, y: 4 }, yaw: NORTH, pitch: 0 });
    expect(pose.position).toEqual([3, WALK_EYE, -4]);
    expect(pose.target[0]).toBeCloseTo(3, 6);
    expect(pose.target[1]).toBeCloseTo(WALK_EYE, 6);
    expect(pose.target[2]).toBeCloseTo(-5, 6); // north is -z in the scene
    const up = walkPose({ position: { x: 0, y: 0 }, yaw: EAST, pitch: 0.5 });
    expect(up.target[1]).toBeGreaterThan(WALK_EYE);
    expect(up.target[0]).toBeGreaterThan(0);
  });
});
