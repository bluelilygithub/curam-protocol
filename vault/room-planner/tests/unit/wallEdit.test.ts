import { describe, expect, it } from 'vitest';
import {
  apply, clampFixtures, deleteVertex, deriveStatus, geometryOf, impactOf, inverse, insertVertex, moveVertex, polygonProblemEdges,
  proposeDeleteVertex, proposeInsertVertex, proposeMoveVertex, proposeSetWallLength, rankSnapCandidates, setWallLength, stickVertex,
  validatePolygon, validateRoom, vertexSnapCandidates,
} from '../../src/engine';
import type { Command, Fixture, Project, Room } from '../../src/engine';
import { expectProjectEqual, loadScenario, makeInstance, makeProject, makeRoom, ringWalls } from '../helpers';

const win = (over: Partial<Fixture> = {}): Fixture => ({
  id: 'win', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9, ...over,
});
// 4 x 5 room (v1 (0,0), v2 (4,0), v3 (4,5), v4 (0,5)); w1 bottom, w2 right (L 5), w3 top (L 4), w4 left (L 5)
const room = (fixtures: Fixture[] = []): Room => makeRoom({ fixtures });
const ids = { vertexId: 'vn', segmentId: 'wn' };

describe('moveVertex (C5: fixtures are re-clamped, nothing else changes)', () => {
  it('moves only that corner; walls keep ids and thickness', () => {
    const g = moveVertex(room(), 'v3', { x: 5, y: 5 })!;
    expect(g.vertices.map((v) => v.position)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }]);
    expect(g.walls).toEqual(room().walls);
  });
  it('quantizes the target to 1 mm', () => {
    expect(moveVertex(room(), 'v3', { x: 4.0004, y: 4.9996 })!.vertices[2].position).toEqual({ x: 4, y: 5 });
  });
  it('a window that no longer fits is clamped to the nearest legal centre: wall w2 shrinks to 2 m -> centre 1.35', () => {
    // L = 2: lo = 0.6 + 0.05 = 0.65, hi = 2 - 0.65 = 1.35
    expect(moveVertex(room([win()]), 'v3', { x: 4, y: 2 })!.fixtures[0].offsetAlongWall).toBe(1.35);
  });
  it('a fixture that cannot fit at all is carried UNCHANGED (reported later as fixture_out_of_wall)', () => {
    const g = moveVertex(room([win()]), 'v3', { x: 4, y: 1 })!; // L = 1 < 1.2 + 0.1
    expect(g.fixtures[0].offsetAlongWall).toBe(2.5);
    const after = apply({ type: 'EditWall', roomId: 'room-1', from: geometryOf(room([win()])), to: g }, makeProject([room([win()])]));
    expect(validateRoom(after.rooms[0], []).violations.map((v) => v.type)).toEqual(['fixture_out_of_wall']);
  });
  it('unknown corner -> null; does not mutate its input', () => {
    const r = room([win()]);
    const before = JSON.stringify(r);
    expect(moveVertex(r, 'nope', { x: 1, y: 1 })).toBeNull();
    moveVertex(r, 'v3', { x: 4, y: 2 });
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe('clampFixtures', () => {
  it('leaves a fixture that fits exactly as it was, and is idempotent', () => {
    const g = geometryOf(room([win({ offsetAlongWall: 2 })]));
    expect(clampFixtures(g).fixtures[0]).toEqual(g.fixtures[0]);
    const squeezed = moveVertex(room([win()]), 'v3', { x: 4, y: 2 })!;
    expect(clampFixtures(squeezed)).toEqual(squeezed);
  });
  it('rounding is inward: an odd-mm width never ends up outside the legal range', () => {
    const f = win({ width: 1.201, offsetAlongWall: 9 });
    const g = clampFixtures({ ...geometryOf(room()), fixtures: [f] });
    const L = 5;
    expect(g.fixtures[0].offsetAlongWall + 1.201 / 2).toBeLessThanOrEqual(L - 0.05 + 1e-9);
  });
});

describe('setWallLength: room size by typing a wall length', () => {
  it('moves the END corner along the wall: w1 4 -> 5 puts v2 at (5, 0)', () => {
    const g = setWallLength(room(), 'w1', 5)!;
    expect(g.vertices[1].position).toEqual({ x: 5, y: 0 });
    expect(g.vertices[0].position).toEqual({ x: 0, y: 0 });
  });
  it('keeps the wall angle for a slanted wall (3-4-5): length 5 -> 10 gives (6, 8)', () => {
    const vs = [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 3, y: 4 } }, { id: 'c', position: { x: -3, y: 6 } }];
    const r = makeRoom({ vertices: vs, walls: ringWalls(vs, 'w') });
    expect(setWallLength(r, 'w1', 10)!.vertices[1].position).toEqual({ x: 6, y: 8 });
  });
  it('quantizes; unknown wall -> null', () => {
    expect(setWallLength(room(), 'w1', 2.0004)!.vertices[1].position).toEqual({ x: 2, y: 0 });
    expect(setWallLength(room(), 'nope', 3)).toBeNull();
  });
});

describe('insertVertex (C6)', () => {
  const r = makeRoom({ walls: ringWalls(makeRoom().vertices).map((w) => (w.id === 'w1' ? { ...w, thickness: 0.2 } : w)), fixtures: [
    { id: 'door', type: 'door', wallId: 'w1', offsetAlongWall: 0.9, width: 0.82, height: 2.04, elevation: 0, hingeSide: 'left' },
    { id: 'win', type: 'window', wallId: 'w1', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 },
  ] });
  const g = insertVertex(r, 'w1', { x: 1.3, y: 0.4 }, ids)!;

  it('projects the click onto the segment (the shape does not change) and slots the corner into polygon order', () => {
    expect(g.vertices.map((v) => v.id)).toEqual(['v1', 'vn', 'v2', 'v3', 'v4']);
    expect(g.vertices[1].position).toEqual({ x: 1.3, y: 0 });
  });
  it('the split wall keeps its id for the half ending at the new corner; the other half is new; both inherit thickness', () => {
    expect(g.walls.slice(0, 2)).toEqual([
      { id: 'w1', startVertexId: 'v1', endVertexId: 'vn', thickness: 0.2 },
      { id: 'wn', startVertexId: 'vn', endVertexId: 'v2', thickness: 0.2 },
    ]);
  });
  it('every OTHER wall is untouched and still references existing corners by id', () => {
    expect(g.walls.slice(2)).toEqual(r.walls.slice(1));
    const vids = new Set(g.vertices.map((v) => v.id));
    for (const w of g.walls) { expect(vids.has(w.startVertexId)).toBe(true); expect(vids.has(w.endVertexId)).toBe(true); }
  });
  it('a fixture whose centre is on the new half moves to it with offset − first-half length; the other stays', () => {
    expect(g.fixtures.find((f) => f.id === 'door')).toMatchObject({ wallId: 'w1', offsetAlongWall: 0.9 });
    expect(g.fixtures.find((f) => f.id === 'win')).toMatchObject({ wallId: 'wn', offsetAlongWall: 1.2 }); // 2.5 − 1.3
  });
  it('a click past the end clamps to the corner (the pipeline then rejects the degenerate result)', () => {
    expect(insertVertex(r, 'w1', { x: 9, y: 0 }, ids)!.vertices[2].position).toEqual({ x: 4, y: 0 });
  });
  it('a wall stored in reverse order of the corner list still splits in the right place', () => {
    const rev = makeRoom({ walls: [{ id: 'w1', startVertexId: 'v2', endVertexId: 'v1', thickness: 0.15 }, ...ringWalls(makeRoom().vertices).slice(1)] });
    const out = insertVertex(rev, 'w1', { x: 1, y: 0 }, ids)!;
    expect(out.vertices.map((v) => v.id)).toEqual(['v1', 'vn', 'v2', 'v3', 'v4']);
    expect(out.walls[0]).toMatchObject({ id: 'w1', startVertexId: 'v2', endVertexId: 'vn' });
  });
  it('unknown wall -> null', () => {
    expect(insertVertex(r, 'nope', { x: 1, y: 0 }, ids)).toBeNull();
  });
});

describe('deleteVertex (C6, C15)', () => {
  it('insert then delete restores the original geometry exactly, fixtures included', () => {
    const r = room([win({ wallId: 'w1', offsetAlongWall: 2.5 })]);
    const inserted = insertVertex(r, 'w1', { x: 1.3, y: 0 }, ids)!;
    const back = deleteVertex({ ...r, ...inserted }, 'vn')!;
    expect(back).toEqual(geometryOf(r));
  });
  it('the merged wall keeps the INCOMING wall id and thickness; the outgoing wall disappears', () => {
    const r = makeRoom({ walls: ringWalls(makeRoom().vertices).map((w, i) => ({ ...w, thickness: [0.1, 0.2, 0.3, 0.4][i] })) });
    const g = deleteVertex(r, 'v3')!; // incoming w2 (v2→v3, 0.2), outgoing w3 (v3→v4, 0.3)
    expect(g.vertices.map((v) => v.id)).toEqual(['v1', 'v2', 'v4']);
    expect(g.walls.map((w) => [w.id, w.startVertexId, w.endVertexId, w.thickness])).toEqual([
      ['w1', 'v1', 'v2', 0.1], ['w2', 'v2', 'v4', 0.2], ['w4', 'v4', 'v1', 0.4],
    ]);
  });
  it('fixtures of the outgoing wall are re-homed with offset + incoming length, then re-fitted: window 2 on w3 -> 5.753 on the 6.403 m diagonal', () => {
    const g = deleteVertex(room([win({ wallId: 'w3', offsetAlongWall: 2 })]), 'v3')!;
    // incoming w2 length 5 → offset 7; merged wall v2(4,0)→v4(0,5) = √41 = 6.4031; hi = 6.4031 − 0.6 − 0.05 → 5.753
    expect(g.fixtures[0]).toMatchObject({ wallId: 'w2', offsetAlongWall: 5.753 });
  });
  it('a triangle cannot lose a corner; unknown corner -> null', () => {
    const tri = makeRoom({ vertices: makeRoom().vertices.slice(0, 3), walls: ringWalls(makeRoom().vertices.slice(0, 3)) });
    expect(deleteVertex(tri, 'v1')).toBeNull();
    expect(deleteVertex(room(), 'nope')).toBeNull();
  });
});

describe('stickVertex (B1: sticks at the last valid spot along the drag)', () => {
  it('returns the target when it is valid', () => {
    expect(stickVertex(room(), 'v3', { x: 4, y: 5 }, { x: 3.5, y: 4 })).toEqual({ x: 3.5, y: 4 });
  });
  it('dragging v3 down through the floor wall stops at the last valid millimetre (y = 0.001, edge length 1 mm)', () => {
    const p = stickVertex(room(), 'v3', { x: 4, y: 5 }, { x: 4, y: -1 });
    expect(p.x).toBe(4);
    expect(p.y).toBeCloseTo(0.001, 9);
    expect(validatePolygon(moveVertex(room(), 'v3', p)!.vertices)).toEqual({ ok: true });
    expect(validatePolygon(moveVertex(room(), 'v3', { x: p.x, y: p.y - 0.001 })!.vertices).ok).toBe(false); // 1 mm further is invalid
  });
  it('a diagonal drag into the opposite wall also sticks at a valid spot', () => {
    const p = stickVertex(room(), 'v3', { x: 4, y: 5 }, { x: -2, y: -2 });
    expect(validatePolygon(moveVertex(room(), 'v3', p)!.vertices).ok).toBe(true);
  });
});

describe('polygonProblemEdges (the orange edges)', () => {
  const vs = (pts: Array<[number, number]>) => pts.map(([x, y], i) => ({ id: `v${i}`, position: { x, y } }));
  it('empty for a valid polygon', () => {
    expect(polygonProblemEdges(vs([[0, 0], [4, 0], [4, 5], [0, 5]]))).toEqual([]);
  });
  it('the two crossing edges of a bow-tie', () => {
    expect(polygonProblemEdges(vs([[0, 0], [1, 1], [1, 0], [0, 1]]))).toEqual([0, 2]);
  });
  it('a too-short edge', () => {
    expect(polygonProblemEdges(vs([[0, 0], [4, 0], [4, 0.0005], [0, 5]]))).toContain(1);
  });
  it('a zero-area polygon flags every edge', () => {
    expect(polygonProblemEdges(vs([[0, 0], [1, 0], [2, 0]]))).toEqual([0, 1, 2]);
  });
  it('agrees with validatePolygon: problems exist exactly when it says invalid', () => {
    for (const pts of [[[0, 0], [4, 0], [4, 5], [0, 5]], [[0, 0], [1, 1], [1, 0], [0, 1]], [[0, 0], [2, 0], [4, 0], [4, 5], [0, 5]], [[0, 0], [4, 0], [4, 4], [0, 0], [-4, 4]]] as Array<Array<[number, number]>>) {
      expect(polygonProblemEdges(vs(pts)).length === 0).toBe(validatePolygon(vs(pts)).ok);
    }
  });
});

describe('impactOf: the preview is the outcome (wall-edit-cascade scenario)', () => {
  const before = loadScenario('wall-edit-cascade.json');
  const edit = loadScenario<Extract<Command, { type: 'EditWall' }>>('wall-edit-cascade.command.json');
  it('sofa-1 and chair-1 would need attention; nothing else; the room was valid before', () => {
    const imp = impactOf(before, 'room-1', edit.to);
    expect(imp.newlyInvalid).toEqual(['chair-1', 'sofa-1']);
    expect(imp.allInvalid).toEqual(['chair-1', 'sofa-1']);
  });
  it('matches the post-commit re-validation exactly', () => {
    const after = apply(edit, before);
    const hard = new Set(validateRoom(after.rooms[0], after.furnitureDefinitions).violations.filter((v) => v.severity === 'hard').flatMap((v) => [...v.involvedObjectIds, ...(v.involvedFixtureIds ?? [])]));
    expect([...hard].sort()).toEqual(impactOf(before, 'room-1', edit.to).allInvalid);
  });
  it('counts an unclamped fixture too, and only NEW problems in newlyInvalid', () => {
    const unclamped = { ...edit.to, fixtures: edit.from.fixtures };
    expect(impactOf(before, 'room-1', unclamped).newlyInvalid).toEqual(['chair-1', 'sofa-1', 'win-e']);
    const already = apply(edit, before);
    expect(impactOf(already, 'room-1', edit.to).newlyInvalid).toEqual([]); // nothing is NEW about an edit that changes nothing
    expect(impactOf(already, 'room-1', edit.to).allInvalid).toEqual(['chair-1', 'sofa-1']);
  });
  it('an unknown room has no impact', () => {
    expect(impactOf(before, 'ghost', edit.to)).toEqual({ newlyInvalid: [], allInvalid: [] });
  });
});

describe('deriveStatus: every instance and fixture has a derived status', () => {
  it('covers all objects with ok / soft / hard', () => {
    const before = loadScenario('wall-edit-cascade.json');
    const edit = loadScenario<Command>('wall-edit-cascade.command.json');
    const s = deriveStatus(apply(edit, before));
    expect([...s.keys()].sort()).toEqual(['chair-1', 'shelf-1', 'sofa-1', 'table-1', 'win-e', 'win-n']);
    expect(s.get('sofa-1')).toBe('hard');
    expect(s.get('chair-1')).toBe('hard');
    expect(s.get('table-1')).toBe('ok');
    expect(s.get('win-e')).toBe('ok');
  });
  it('soft clearance shows as soft', () => {
    const p = loadScenario('clearance-matrix.json');
    const s = deriveStatus(p);
    expect(s.get('chair-1')).toBe('hard');
    expect(s.get('sofa-2')).toBe('ok');
  });
  it('is never stored on the project (derived only)', () => {
    const p = makeProject([room()]);
    deriveStatus(p);
    expect(JSON.stringify(p)).not.toMatch(/isInvalid|status/);
  });
});

describe('vertexSnapCandidates', () => {
  it('alignment with another corner outranks the grid; a nearby corner outranks both', () => {
    const r = room();
    const ranked = rankSnapCandidates(vertexSnapCandidates(r, 'v3', { x: 3.97, y: 5.06 }));
    expect(ranked[0].targetType).toBe('alignment'); // x lines up with v2 (4, 0): (4, 5.06) is 0.03 away; the grid point (4, 5.1) is 0.05 away
    expect(ranked[0].position).toEqual({ x: 4, y: 5.06 });
    const near = rankSnapCandidates(vertexSnapCandidates(r, 'v3', { x: 0.1, y: 4.9 }));
    expect(near[0]).toMatchObject({ targetType: 'wall_endpoint', position: { x: 0, y: 5 } }); // v4
  });
  it('never offers the dragged corner itself and respects the snap distance', () => {
    const c = vertexSnapCandidates(room(), 'v3', { x: 2, y: 2.5 });
    expect(c.every((x) => !x.reason.includes('v3'))).toBe(true);
    expect(c.every((x) => x.distance <= 0.25)).toBe(true);
  });
});

describe('pipeline wrappers (§6a: only polygon validity can reject)', () => {
  const proj = (fixtures: Fixture[] = [], furniture = [makeInstance({ id: 'a', position: { x: 2, y: 4.5 }, width: 1, length: 0.6 })]): Project =>
    makeProject([makeRoom({ fixtures, furniture })]);
  const cmd = (r: ReturnType<typeof proposeMoveVertex>): Extract<Command, { type: 'EditWall' }> => {
    if (r.rejected) throw new Error(`rejected ${JSON.stringify(r)}`);
    return r.command as Extract<Command, { type: 'EditWall' }>;
  };

  it('a corner move commits even when furniture becomes invalid (A3) and carries from/to including fixtures (C5)', () => {
    const p = proj([win()]);
    const c = cmd(proposeMoveVertex(p, 'v3', { x: 4, y: 2 }));
    expect(c.type).toBe('EditWall');
    expect(c.from.fixtures[0].offsetAlongWall).toBe(2.5);
    expect(c.to.fixtures[0].offsetAlongWall).toBe(1.35);
    const after = apply(c, p);
    expect(validateRoom(after.rooms[0], []).valid).toBe(false); // furniture 'a' now outside, edit still committed
    expectProjectEqual(apply(inverse(c), after), p);
  });
  it('a self-crossing shape is rejected with a stable code', () => {
    expect(proposeMoveVertex(proj(), 'v3', { x: 4, y: -1 })).toMatchObject({ rejected: true, polygonError: 'SELF_INTERSECTION' });
  });
  it('no change is a noop; unknown ids give a plain message', () => {
    expect(proposeMoveVertex(proj(), 'v3', { x: 4, y: 5 })).toMatchObject({ rejected: true, noop: true });
    expect(proposeMoveVertex(proj(), 'zz', { x: 1, y: 1 })).toMatchObject({ rejected: true, message: 'Unknown corner' });
    expect(proposeInsertVertex(proj(), 'zz', { x: 1, y: 1 }, ids)).toMatchObject({ rejected: true, message: 'Unknown wall' });
  });
  it('insert then delete are two undoable commands that restore each other', () => {
    const p = proj([win({ wallId: 'w1', offsetAlongWall: 2.5 })]);
    const ins = cmd(proposeInsertVertex(p, 'w1', { x: 1.3, y: 0 }, ids));
    const p2 = apply(ins, p);
    expect(p2.rooms[0].vertices).toHaveLength(5);
    const del = cmd(proposeDeleteVertex(p2, 'vn'));
    expectProjectEqual(apply(del, p2), p);
  });
  it('inserting at the very end of a wall is rejected (degenerate edge)', () => {
    expect(proposeInsertVertex(proj(), 'w1', { x: 9, y: 0 }, ids)).toMatchObject({ rejected: true, polygonError: 'DEGENERATE_EDGE' });
  });
  it('a room keeps three corners', () => {
    const tri = makeProject([makeRoom({ vertices: makeRoom().vertices.slice(0, 3), walls: ringWalls(makeRoom().vertices.slice(0, 3)) })]);
    expect(proposeDeleteVertex(tri, 'v1')).toMatchObject({ rejected: true, polygonError: 'TOO_FEW_VERTICES', message: 'A room needs at least three corners' });
  });
  it('set wall length builds one EditWall; the inside polygon follows', () => {
    const c = cmd(proposeSetWallLength(proj(), 'w1', 5));
    expect(c.to.vertices[1].position).toEqual({ x: 5, y: 0 });
  });
  it('a room with no rooms at all throws ID_NOT_FOUND', () => {
    expect(() => proposeMoveVertex(makeProject([]), 'v1', { x: 0, y: 0 })).toThrow(/ID_NOT_FOUND/);
  });
});
