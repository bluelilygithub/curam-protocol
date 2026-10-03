// Property tests for wall / corner editing (Test Plan §3 + §4 M3). Seeded; capped run counts.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  apply, clampFixtures, deriveStatus, geometryOf, impactOf, inverse, proposeDeleteVertex, proposeInsertVertex, proposeMoveVertex,
  proposeSetWallLength, stickVertex, validatePolygon, validateRoom, moveVertex, type Command, type Project,
} from '../../src/engine';
import { expectProjectEqual, makeInstance, makeProject, makeRoom } from '../helpers';

const RUNS = { numRuns: 200, seed: 20261004 };

const start = (): Project => makeProject([makeRoom({
  fixtures: [
    { id: 'door', type: 'door', wallId: 'w1', offsetAlongWall: 1, width: 0.82, height: 2.04, elevation: 0, hingeSide: 'left', swingAngle: Math.PI / 2 },
    { id: 'win-r', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 },
    { id: 'win-t', type: 'window', wallId: 'w3', offsetAlongWall: 2, width: 1, height: 1.2, elevation: 0.9 },
  ],
  furniture: [
    makeInstance({ id: 'a', position: { x: 2, y: 4.4 }, width: 1.4, length: 0.7, height: 0.8 }),
    makeInstance({ id: 'b', position: { x: 3.3, y: 2.5 }, width: 0.8, length: 0.8, height: 0.8 }),
    makeInstance({ id: 'c', position: { x: 1, y: 2 }, width: 0.8, length: 0.8, height: 0.8 }),
  ],
})]);

type Op =
  | { k: 'move'; v: number; x: number; y: number }
  | { k: 'insert'; w: number; x: number; y: number }
  | { k: 'delete'; v: number }
  | { k: 'length'; w: number; len: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ k: fc.constant('move' as const), v: fc.nat(10), x: fc.double({ min: -1, max: 6, noNaN: true }), y: fc.double({ min: -1, max: 7, noNaN: true }) }),
  fc.record({ k: fc.constant('insert' as const), w: fc.nat(10), x: fc.double({ min: -1, max: 6, noNaN: true }), y: fc.double({ min: -1, max: 7, noNaN: true }) }),
  fc.record({ k: fc.constant('delete' as const), v: fc.nat(10) }),
  fc.record({ k: fc.constant('length' as const), w: fc.nat(10), len: fc.double({ min: 0.3, max: 8, noNaN: true }) }),
);

/** Run a sequence through the real pipeline wrappers; returns every committed (before, command, after). */
function run(ops: Op[]): Array<{ before: Project; command: Extract<Command, { type: 'EditWall' }>; after: Project }> {
  let state = start();
  let n = 0;
  const out: Array<{ before: Project; command: Extract<Command, { type: 'EditWall' }>; after: Project }> = [];
  for (const o of ops) {
    const room = state.rooms[0];
    const vid = room.vertices[o.k === 'move' || o.k === 'delete' ? o.v % room.vertices.length : 0].id;
    const wid = room.walls[o.k === 'insert' || o.k === 'length' ? o.w % room.walls.length : 0].id;
    const r =
      o.k === 'move' ? proposeMoveVertex(state, vid, { x: o.x, y: o.y })
        : o.k === 'insert' ? proposeInsertVertex(state, wid, { x: o.x, y: o.y }, { vertexId: `nv${++n}`, segmentId: `ns${n}` })
          : o.k === 'delete' ? proposeDeleteVertex(state, vid)
            : proposeSetWallLength(state, wid, o.len);
    if (r.rejected) continue;
    const command = r.command as Extract<Command, { type: 'EditWall' }>;
    const after = apply(command, state);
    out.push({ before: state, command, after });
    state = after;
  }
  return out;
}

describe('every committed wall edit keeps the model consistent', () => {
  it('the generator is not vacuous: many edits commit, and many are rejected for an invalid polygon', () => {
    const seqs = fc.sample(fc.array(op, { minLength: 15, maxLength: 25 }), { numRuns: 60, seed: 3 });
    const committed = seqs.reduce((n, ops) => n + run(ops).length, 0);
    expect(committed).toBeGreaterThan(250);
    expect(committed).toBeLessThan(seqs.reduce((n, ops) => n + ops.length, 0)); // some were rejected
    const grew = seqs.some((ops) => run(ops).some((e) => e.after.rooms[0].vertices.length > 5));
    expect(grew).toBe(true); // insert really adds corners
  });

  it('walls reference existing corners by id, every corner has one incoming and one outgoing wall, fixtures reference existing walls, polygon valid', () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
      for (const { after } of run(ops)) {
        const room = after.rooms[0];
        const vids = new Set(room.vertices.map((v) => v.id));
        if (vids.size !== room.vertices.length) return false;
        if (room.walls.length !== room.vertices.length) return false;
        for (const w of room.walls) if (!vids.has(w.startVertexId) || !vids.has(w.endVertexId)) return false;
        for (const v of room.vertices) {
          if (room.walls.filter((w) => w.startVertexId === v.id).length !== 1) return false;
          if (room.walls.filter((w) => w.endVertexId === v.id).length !== 1) return false;
        }
        const wids = new Set(room.walls.map((w) => w.id));
        if (!room.fixtures.every((f) => wids.has(f.wallId))) return false;
        if (!validatePolygon(room.vertices).ok) return false;
      }
      return true;
    }), RUNS);
  });

  it('the inverse of every edit restores geometry, fixtures and validity exactly', () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
      for (const { before, command, after } of run(ops)) expectProjectEqual(apply(inverse(command), after), before);
      return true;
    }), RUNS);
  });

  it('preview ≡ outcome: impactOf(before, candidate).allInvalid is exactly what re-validation flags after the commit', () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
      for (const { before, command, after } of run(ops)) {
        const hard = new Set(validateRoom(after.rooms[0], after.furnitureDefinitions).violations
          .filter((v) => v.severity === 'hard').flatMap((v) => [...v.involvedObjectIds, ...(v.involvedFixtureIds ?? [])]));
        const imp = impactOf(before, before.rooms[0].id, command.to);
        if (JSON.stringify([...hard].sort()) !== JSON.stringify(imp.allInvalid)) return false;
      }
      return true;
    }), RUNS);
  });

  it('re-validation is complete: after every edit every instance and fixture has a derived status', () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
      for (const { after } of run(ops)) {
        const status = deriveStatus(after);
        const room = after.rooms[0];
        const expected = [...room.furniture.map((f) => f.id), ...room.fixtures.map((f) => f.id)].sort();
        if (JSON.stringify([...status.keys()].sort()) !== JSON.stringify(expected)) return false;
      }
      return true;
    }), RUNS);
  });

  it('edits never move furniture (A3) and never change the interior of walls that were not touched', () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 25 }), (ops) => {
      for (const { before, after } of run(ops)) {
        if (JSON.stringify(before.rooms[0].furniture) !== JSON.stringify(after.rooms[0].furniture)) return false;
      }
      return true;
    }), RUNS);
  });

  it('is deterministic: the same sequence twice gives the same project', () => {
    fc.assert(fc.property(fc.array(op, { maxLength: 20 }), (ops) => {
      const a = run(ops);
      const b = run(ops);
      return JSON.stringify(a.at(-1)?.after ?? null) === JSON.stringify(b.at(-1)?.after ?? null);
    }), { ...RUNS, numRuns: 100 });
  });
});

describe('clamping and sticking', () => {
  it('clampFixtures is idempotent for any corner position', () => {
    fc.assert(fc.property(fc.double({ min: -1, max: 6, noNaN: true }), fc.double({ min: -1, max: 7, noNaN: true }), fc.nat(3), (x, y, vi) => {
      const room = start().rooms[0];
      const g = moveVertex(room, room.vertices[vi].id, { x, y })!;
      return JSON.stringify(clampFixtures(g)) === JSON.stringify(g);
    }), RUNS);
  });

  it('stickVertex always returns a position whose polygon is valid (from a valid start)', () => {
    fc.assert(fc.property(fc.nat(3), fc.double({ min: -3, max: 8, noNaN: true }), fc.double({ min: -3, max: 8, noNaN: true }), (vi, x, y) => {
      const room = start().rooms[0];
      const v = room.vertices[vi];
      const p = stickVertex(room, v.id, v.position, { x, y });
      return validatePolygon(moveVertex(room, v.id, p)!.vertices).ok;
    }), RUNS);
  });

  it('a pure geometry round-trip: geometryOf(room) is what an EditWall `from` carries', () => {
    const room = start().rooms[0];
    const r = proposeMoveVertex(start(), 'v3', { x: 4, y: 4 });
    if (r.rejected) throw new Error('rejected');
    expect((r.command as Extract<Command, { type: 'EditWall' }>).from).toEqual(geometryOf(room));
  });
});
