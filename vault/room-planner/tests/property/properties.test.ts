// Property-based tests (Test Plan §3). Fixed seeds, capped run counts, no wall-clock time.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  aabbOf, aabbOverlap, angularDistance, apply, checkContainment, CommandHistory, convexOverlap, convexPenetration, EPSILON,
  footprintCorners, inverse, normalizeCCW, proposeDelete, proposeMove, proposePlaceFurniture, proposeResize, proposeRotate,
  quantizeLinear, quantizeRotation, validatePolygon, validateRoom, violationsFor,
} from '../../src/engine';
import type { Command, Project, Vec2, Vertex } from '../../src/engine';
import { expectProjectEqual, hashProject, loadScenario, makeInstance, makeProject, makeRoom, rectVertices, ringWalls } from '../helpers';

const RUNS = { numRuns: 500, seed: 20261003 };
const deg = (d: number) => (d * Math.PI) / 180;

const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
const nearMidpoint = fc
  .tuple(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.constantFrom(-1e-10, 0, 1e-10, 1e-12))
  .map(([k, e]) => k / 1000 + 0.0005 + e);

describe('quantize', () => {
  it('idempotence: q(q(x)) == q(x), including values within 1e-9 of midpoints and negatives', () => {
    fc.assert(fc.property(fc.oneof(coord, nearMidpoint), (x) => quantizeLinear(quantizeLinear(x)) === quantizeLinear(x)), RUNS);
  });
  it('bounds: q(x) is within half a millimetre of x (mod EPSILON)', () => {
    fc.assert(fc.property(fc.oneof(coord, nearMidpoint), (x) => {
      const q = quantizeLinear(x);
      return q >= x - 0.0005 - EPSILON && q <= x + 0.0005 + EPSILON;
    }), RUNS);
  });
  it('never produces -0', () => {
    fc.assert(fc.property(fc.double({ min: -0.0005, max: 0.0005, noNaN: true }), (x) => !Object.is(quantizeLinear(x), -0)), RUNS);
  });
  it('rotation: idempotent, in [0, 2π), within 0.05° of the input (wraparound-aware)', () => {
    fc.assert(fc.property(fc.double({ min: -20, max: 20, noNaN: true }), (r) => {
      const q = quantizeRotation(r);
      return q >= 0 && q < Math.PI * 2 && angularDistance(quantizeRotation(q), q) < 1e-9 && angularDistance(q, r) <= deg(0.05) + 1e-9;
    }), RUNS);
  });
});

const rectArb = fc.record({
  x: fc.double({ min: -3, max: 3, noNaN: true }),
  y: fc.double({ min: -3, max: 3, noNaN: true }),
  w: fc.double({ min: 0.1, max: 3, noNaN: true }),
  l: fc.double({ min: 0.1, max: 3, noNaN: true }),
  r: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
});
const toRect = (a: { x: number; y: number; w: number; l: number; r: number }) =>
  ({ position: { x: a.x, y: a.y }, width: a.w, length: a.l, rotation: a.r });

describe('collision', () => {
  it('symmetry: collides(a,b) == collides(b,a), random rotations/sizes', () => {
    fc.assert(fc.property(rectArb, rectArb, (a, b) => {
      const A = footprintCorners(toRect(a));
      const B = footprintCorners(toRect(b));
      return convexOverlap(A, B) === convexOverlap(B, A);
    }), RUNS);
  });
  it('touching ≠ collision: at 0.5×EPSILON overlap or gap never collides; 2×EPSILON overlap does, 2×EPSILON gap does not', () => {
    fc.assert(fc.property(rectArb, fc.double({ min: 0.1, max: 3, noNaN: true }), (a, w2) => {
      const A = toRect(a);
      const u = { x: Math.cos(a.r), y: Math.sin(a.r) };
      const at = (shift: number) => footprintCorners({
        position: { x: a.x + u.x * shift, y: a.y + u.y * shift }, width: w2, length: a.l, rotation: a.r,
      });
      const touching = a.w / 2 + w2 / 2;
      const fA = footprintCorners(A);
      return (
        !convexOverlap(fA, at(touching)) &&
        !convexOverlap(fA, at(touching - 0.5 * EPSILON)) &&
        !convexOverlap(fA, at(touching + 0.5 * EPSILON)) &&
        convexOverlap(fA, at(touching - 2 * EPSILON)) &&
        !convexOverlap(fA, at(touching + 2 * EPSILON))
      );
    }), RUNS);
  });
  it('SAT-vs-AABB consistency: the AABB prefilter never rejects a colliding pair (checked against an unfiltered SAT)', () => {
    const bruteForce = (a: Vec2[], b: Vec2[]): boolean => {
      for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
          const e = { x: poly[(i + 1) % poly.length].x - poly[i].x, y: poly[(i + 1) % poly.length].y - poly[i].y };
          const n = { x: -e.y, y: e.x };
          const pa = a.map((p) => p.x * n.x + p.y * n.y);
          const pb = b.map((p) => p.x * n.x + p.y * n.y);
          const len = Math.hypot(n.x, n.y);
          if ((Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb))) / len <= EPSILON) return false;
        }
      }
      return true;
    };
    fc.assert(fc.property(rectArb, rectArb, (a, b) => {
      const A = footprintCorners(toRect(a));
      const B = footprintCorners(toRect(b));
      const truth = bruteForce(A, B);
      if (truth) expect(aabbOverlap(aabbOf(A), aabbOf(B))).toBe(true);
      return convexPenetration(A, B) > 0 === truth;
    }), RUNS);
  });
});

describe('containment under quantization', () => {
  const room = makeRoom(); // 4 x 5
  const inside = (c: Vec2[]) => checkContainment(c, room.vertices, room.walls).inside;

  it('random placements well inside stay valid after quantizing position and rotation', () => {
    const inset = rectVertices(3.99, 4.99).map((v) => ({ ...v, position: { x: v.position.x + 0.005, y: v.position.y + 0.005 } }));
    fc.assert(fc.property(
      fc.record({
        // sizes <= 1.5 m => half-diagonal <= 1.07 m, so these centres are always inside the 5 mm inset
        x: fc.double({ min: 1.2, max: 2.8, noNaN: true }), y: fc.double({ min: 1.2, max: 3.8, noNaN: true }),
        w: fc.double({ min: 0.1, max: 1.5, noNaN: true }), l: fc.double({ min: 0.1, max: 1.5, noNaN: true }),
        r: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
      }),
      (a) => {
        const raw = footprintCorners(toRect(a));
        fc.pre(checkContainment(raw, inset, ringWalls(inset)).inside); // inside with a 5 mm margin
        const q = footprintCorners({
          position: { x: quantizeLinear(a.x), y: quantizeLinear(a.y) },
          width: quantizeLinear(a.w), length: quantizeLinear(a.l), rotation: quantizeRotation(a.r),
        });
        return inside(q);
      }), RUNS);
  });
  it('corner-on-boundary: grid-aligned edges quantize to touching, never outside (even-mm sizes)', () => {
    fc.assert(fc.property(
      fc.integer({ min: 50, max: 800 }), // half-width in mm -> width is an even number of mm
      fc.double({ min: 0, max: 1, noNaN: true }),
      (halfMm, t) => {
        const half = halfMm / 1000;
        const raw = half + t * (4 - 2 * half); // anywhere inside [half, 4-half], including the extremes
        const x = quantizeLinear(raw);
        return inside(footprintCorners({ position: { x, y: 2.5 }, width: half * 2, length: 1, rotation: 0 }));
      }), RUNS);
  });
  it('pipeline never emits a command whose quantized state is invalid (valid float -> invalid after quantize is rejected)', () => {
    fc.assert(fc.property(
      fc.double({ min: 0.3, max: 3.7, noNaN: true }), fc.double({ min: 0.3, max: 4.7, noNaN: true }),
      (x, y) => {
        const p = makeProject([makeRoom({ furniture: [makeInstance({ id: 'a', position: { x: 2, y: 2 }, width: 0.601, length: 0.601 })] })]);
        const r = proposeMove(p, 'a', { x, y });
        if (r.rejected) return true;
        const after = apply(r.command, p);
        return validateRoom(after.rooms[0], []).valid;
      }), RUNS);
  });
});

describe('polygon validity stability', () => {
  const star = fc
    .tuple(
      fc.integer({ min: 4, max: 9 }),
      fc.array(fc.double({ min: 1.5, max: 6, noNaN: true }), { minLength: 9, maxLength: 9 }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.boolean(),
    )
    .map(([n, radii, phase, clockwise]) => {
      const vs: Vertex[] = [];
      for (let i = 0; i < n; i++) {
        const a = ((i + phase * 0.5) / n) * Math.PI * 2;
        vs.push({ id: `v${i}`, position: { x: quantizeLinear(radii[i] * Math.cos(a)), y: quantizeLinear(radii[i] * Math.sin(a)) } });
      }
      return clockwise ? vs.reverse() : vs;
    });
  const convex = fc.tuple(fc.integer({ min: 4, max: 10 }), fc.double({ min: 2, max: 8, noNaN: true })).map(([n, r]) =>
    Array.from({ length: n }, (_, i): Vertex => ({
      id: `v${i}`,
      position: { x: quantizeLinear(r * Math.cos((i / n) * Math.PI * 2)), y: quantizeLinear(r * Math.sin((i / n) * Math.PI * 2)) },
    })));

  it('random simple (star-shaped) polygons normalize to CCW and validate', () => {
    fc.assert(fc.property(star, (vs) => {
      const ccw = normalizeCCW(vs);
      const sum = ccw.reduce((s, v, i) => s + (v.position.x * ccw[(i + 1) % ccw.length].position.y - ccw[(i + 1) % ccw.length].position.x * v.position.y), 0);
      return sum > 0 && validatePolygon(ccw).ok;
    }), RUNS);
  });
  it('swapping two adjacent vertices of a convex polygon -> SELF_INTERSECTION', () => {
    fc.assert(fc.property(convex, fc.nat(), (vs, k) => {
      const i = k % vs.length;
      const j = (i + 1) % vs.length;
      const bad = vs.map((v, idx) => (idx === i ? vs[j] : idx === j ? vs[i] : v));
      const r = validatePolygon(bad);
      return !r.ok && r.code === 'SELF_INTERSECTION';
    }), RUNS);
  });
  it('a vertex duplicated at a non-adjacent position -> DUPLICATE_VERTEX', () => {
    fc.assert(fc.property(convex, fc.nat(), (vs, k) => {
      const i = k % vs.length;
      const j = (i + 2) % vs.length; // non-adjacent (n >= 4)
      const bad = vs.map((v, idx) => (idx === j ? { ...v, position: { ...vs[i].position } } : v));
      const r = validatePolygon(bad);
      return !r.ok && r.code === 'DUPLICATE_VERTEX';
    }), RUNS);
  });
  it('three collinear vertices -> ZERO_AREA', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }), fc.integer({ min: -20, max: 20 }), fc.integer({ min: 1, max: 20 }),
      (step, slope, off) => {
        const vs: Vertex[] = [0, 1, 2].map((i) => ({ id: `v${i}`, position: { x: i * step * off, y: i * slope * off } }));
        const r = validatePolygon(vs);
        return !r.ok && r.code === 'ZERO_AREA';
      }), RUNS);
  });
});

// ---------------------------------------------------------------- commands: inverse, replay

const room = (): Project => makeProject([makeRoom({ furniture: [
  makeInstance({ id: 'a', position: { x: 1, y: 1 }, width: 0.8, length: 0.8 }),
  makeInstance({ id: 'b', position: { x: 3, y: 3 }, width: 0.8, length: 0.8 }),
] })]);

type Op =
  | { k: 'move'; id: 'a' | 'b' | 'c'; x: number; y: number }
  | { k: 'rotate'; id: 'a' | 'b' | 'c'; r: number }
  | { k: 'resize'; id: 'a' | 'b' | 'c'; w: number; l: number }
  | { k: 'place'; x: number; y: number }
  | { k: 'delete'; id: 'a' | 'b' | 'c' }
  | { k: 'undo' } | { k: 'redo' };
const idArb = fc.constantFrom('a' as const, 'b' as const, 'c' as const);
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant('move' as const), id: idArb, x: fc.double({ min: 0, max: 4, noNaN: true }), y: fc.double({ min: 0, max: 5, noNaN: true }) }),
  fc.record({ k: fc.constant('rotate' as const), id: idArb, r: fc.double({ min: -7, max: 7, noNaN: true }) }),
  fc.record({ k: fc.constant('resize' as const), id: idArb, w: fc.double({ min: 0.2, max: 2, noNaN: true }), l: fc.double({ min: 0.2, max: 2, noNaN: true }) }),
  fc.record({ k: fc.constant('place' as const), x: fc.double({ min: 0, max: 4, noNaN: true }), y: fc.double({ min: 0, max: 5, noNaN: true }) }),
  fc.record({ k: fc.constant('delete' as const), id: idArb }),
  fc.constant({ k: 'undo' as const }), fc.constant({ k: 'redo' as const }),
);

function run(ops: Op[], start: Project): { state: Project; committed: Array<{ before: Project; command: Command }>; history: CommandHistory } {
  let state = start;
  const history = new CommandHistory();
  const committed: Array<{ before: Project; command: Command }> = [];
  for (const op of ops) {
    const find = (id: string) => state.rooms[0].furniture.find((f) => f.id === id);
    let result: ReturnType<typeof proposeMove> | undefined;
    try {
      if (op.k === 'undo') { state = history.undo(state) ?? state; continue; }
      if (op.k === 'redo') { state = history.redo(state) ?? state; continue; }
      if (op.k === 'place') {
        const id = `n${history.length}`;
        result = proposePlaceFurniture(state, makeInstance({ id, position: { x: op.x, y: op.y }, width: 0.5, length: 0.5, height: 0.6 }));
      } else {
        const f = find(op.id);
        if (!f) continue;
        if (op.k === 'move') result = proposeMove(state, op.id, { x: op.x, y: op.y });
        else if (op.k === 'rotate') result = proposeRotate(state, op.id, op.r);
        else if (op.k === 'resize') result = proposeResize(state, op.id, { position: f.position, width: op.w, length: op.l });
        else result = proposeDelete(state, op.id);
      }
    } catch (e) {
      if (e instanceof Error && /ID_NOT_FOUND/.test(e.message)) continue;
      throw e;
    }
    if (result && !result.rejected) {
      committed.push({ before: state, command: result.command });
      state = apply(result.command, state);
      history.push(result.command);
    }
  }
  return { state, committed, history };
}

describe('commands', () => {
  it('the operation generator is not vacuous: random sequences commit many commands and also get rejections', () => {
    const seqs = fc.sample(fc.array(opArb, { minLength: 20, maxLength: 40 }), { numRuns: 60, seed: 7 });
    const committed = seqs.reduce((n, ops) => n + run(ops, room()).committed.length, 0);
    expect(committed).toBeGreaterThan(200);
    const undone = seqs.filter((ops) => ops.some((o) => o.k === 'undo')).length;
    expect(undone).toBeGreaterThan(5);
  });
  it('replay determinism: any seeded random sequence run twice ends in an identical serialized state', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
      return hashProject(run(ops, room()).state) === hashProject(run(ops, room()).state);
    }), { ...RUNS, numRuns: 200 });
  });
  it('inverse correctness: apply(inverse(c), apply(c, s)) == s for every committed command', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
      for (const { before, command } of run(ops, room()).committed) {
        expectProjectEqual(apply(inverse(command), apply(command, before)), before);
      }
      return true;
    }), { ...RUNS, numRuns: 200 });
  });
  it('undoing everything returns the starting project', () => {
    fc.assert(fc.property(fc.array(opArb.filter((o) => o.k !== 'undo' && o.k !== 'redo'), { maxLength: 30 }), (ops) => {
      const start = room();
      const { state, history } = run(ops, start);
      let s = state;
      while (history.canUndo()) s = history.undo(s)!;
      expectProjectEqual(s, start);
      return true;
    }), { ...RUNS, numRuns: 200 });
  });
  it('every committed state is free of hard violations for the touched objects (pipeline is the single gate)', () => {
    fc.assert(fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
      const { state } = run(ops, room());
      return validateRoom(state.rooms[0], []).valid;
    }), { ...RUNS, numRuns: 200 });
  });
});

describe('escape-rule monotonicity (wall-edit-cascade fixture)', () => {
  const before = loadScenario('wall-edit-cascade.json');
  const edit = loadScenario<Command>('wall-edit-cascade.command.json');
  const start = apply(edit, before);
  const mag = (p: Project, id: string): number =>
    violationsFor(validateRoom(p.rooms[0], p.furnitureDefinitions), id)
      .filter((v) => v.severity === 'hard').reduce((m, v) => m + (v.magnitude ?? 0), 0);

  it('a random move of an invalid object never commits if it increases the violation', () => {
    fc.assert(fc.property(
      fc.constantFrom('sofa-1', 'chair-1'),
      fc.double({ min: 0, max: 4, noNaN: true }), fc.double({ min: 2.5, max: 5, noNaN: true }),
      (id, x, y) => {
        const r = proposeMove(start, id, { x, y });
        if (r.rejected) return true;
        return mag(apply(r.command, start), id) <= mag(start, id) + 1e-9;
      }), RUNS);
  });
  it('moving straight toward the valid region commits at every step and the violation shrinks monotonically', () => {
    let state = start;
    let last = mag(state, 'sofa-1');
    expect(last).toBeGreaterThan(0);
    for (let step = 1; step <= 16; step++) {
      const y = 4.5 - step * 0.05; // sofa-1 starts at y=4.5; the new wall is at 4.2, so valid at y <= 3.75
      const r = proposeMove(state, 'sofa-1', { x: 2, y });
      expect(r.rejected).toBe(false);
      if (!r.rejected) state = apply(r.command, state);
      const m = mag(state, 'sofa-1');
      expect(m).toBeLessThanOrEqual(last + 1e-9);
      last = m;
    }
    expect(last).toBe(0);
  });
});
