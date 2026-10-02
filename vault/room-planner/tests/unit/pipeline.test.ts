import { describe, expect, it } from 'vitest';
import {
  apply, CommandHistory, proposeCreateRoom, proposeDelete, proposeDeleteFixture, proposeDeleteRoom, proposeEditWall,
  proposeFixPosition, proposeGroupDelete, proposeGroupMove, proposeGroupRotate, proposeMove, proposePlaceFixture,
  proposePlaceFurniture, proposeResize, proposeRotate, proposeUpdateFixture, proposeUpdateFurniture, validateRoom,
  type Project, type SnapCandidate,
} from '../../src/engine';
import type { PipelineResult } from '../../src/engine';
import { deepFreeze, makeDoor, makeInstance, makeProject, makeRoom, rectVertices, ringWalls } from '../helpers';

const deg = (d: number) => (d * Math.PI) / 180;
const box = (id: string, x: number, y: number, over = {}) => makeInstance({ id, position: { x, y }, width: 1, length: 1, ...over });
const proj = (furniture = [box('a', 2, 2)], extra = {}) => deepFreeze(makeProject([makeRoom({ furniture, ...extra })]));
const cmdOf = (r: PipelineResult) => {
  if (r.rejected) throw new Error(`rejected: ${JSON.stringify(r)}`);
  return r.command;
};
const rejected = (r: PipelineResult) => {
  if (!r.rejected) throw new Error('expected a rejection');
  return r;
};

describe('proposeMove: resolve snap → quantize → lock → validate → emit', () => {
  it('quantizes the proposal and carries inverse data', () => {
    const c = cmdOf(proposeMove(proj(), 'a', { x: 2.0004, y: 2.0006 }));
    expect(c).toEqual({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2 }, to: { x: 2, y: 2.001 } });
  });
  it('rejects a hard violation and leaves state untouched (pure)', () => {
    const p = proj();
    const r = rejected(proposeMove(p, 'a', { x: 0.2, y: 2 }));
    expect(r.violations[0].type).toBe('outside_room');
    expect(p.rooms[0].furniture[0].position).toEqual({ x: 2, y: 2 });
  });
  it('a no-op proposal is a noop rejection with no violations', () => {
    expect(rejected(proposeMove(proj(), 'a', { x: 2.0003, y: 2 }))).toMatchObject({ noop: true, violations: [] });
  });
  it('quantization never pushes a valid touching placement outside', () => {
    expect(cmdOf(proposeMove(proj(), 'a', { x: 0.5004, y: 2 })).type).toBe('MoveFurniture'); // -> 0.5, left edge at 0
  });
  it('quantizing onto an invalid value is rejected (0.4994 -> 0.499)', () => {
    expect(rejected(proposeMove(proj(), 'a', { x: 0.4994, y: 2 })).violations[0].type).toBe('outside_room');
  });
  it('a snap that would cause a hard violation is discarded; the raw proposal is used (A2)', () => {
    const bad: SnapCandidate = { targetType: 'wall_endpoint', position: { x: 0.2, y: 2 }, distance: 0.01, priority: 100, reason: 'bad' };
    const c = cmdOf(proposeMove(proj(), 'a', { x: 2.5, y: 2 }, { snapCandidates: [bad] }));
    expect(c).toMatchObject({ to: { x: 2.5, y: 2 } });
  });
  it('a valid snap wins over the raw proposal', () => {
    const good: SnapCandidate = { targetType: 'grid', position: { x: 2.5, y: 2 }, distance: 0.04, priority: 20, reason: 'grid' };
    expect(cmdOf(proposeMove(proj(), 'a', { x: 2.54, y: 2 }, { snapCandidates: [good] }))).toMatchObject({ to: { x: 2.5, y: 2 } });
  });
  it('snap candidates beyond snapDistance are ignored', () => {
    const far: SnapCandidate = { targetType: 'grid', position: { x: 3, y: 2 }, distance: 0.5, priority: 20, reason: 'far' };
    expect(cmdOf(proposeMove(proj(), 'a', { x: 2.54, y: 2 }, { snapCandidates: [far] }))).toMatchObject({ to: { x: 2.54, y: 2 } });
  });
  it('rejects collision with another object', () => {
    const p = proj([box('a', 1, 2), box('b', 3, 2)]);
    expect(rejected(proposeMove(p, 'a', { x: 2.5, y: 2 })).violations[0].type).toBe('physical_collision');
  });
  it('unknown id throws ID_NOT_FOUND', () => {
    expect(() => proposeMove(proj(), 'ghost', { x: 1, y: 1 })).toThrow(/ID_NOT_FOUND/);
  });
});

describe('locked objects (A16)', () => {
  const p = () => proj([box('a', 2, 2, { locked: true })]);
  it('reject move / resize / rotate / delete in the pipeline', () => {
    for (const r of [
      proposeMove(p(), 'a', { x: 2.5, y: 2 }),
      proposeResize(p(), 'a', { position: { x: 2, y: 2 }, width: 2, length: 1 }),
      proposeRotate(p(), 'a', 1),
      proposeDelete(p(), 'a'),
      proposeFixPosition(p(), 'a'),
    ]) {
      expect(rejected(r).violations).toMatchObject([{ type: 'locked', severity: 'hard', involvedObjectIds: ['a'] }]);
    }
  });
  it('UpdateFurniture on a locked instance may only change `locked` itself', () => {
    expect(rejected(proposeUpdateFurniture(p(), 'a', { elevation: 0.5 })).violations[0].type).toBe('locked');
    const c = cmdOf(proposeUpdateFurniture(p(), 'a', { locked: null }));
    expect(c).toEqual({ type: 'UpdateFurniture', instanceId: 'a', from: { locked: true }, to: { locked: null } });
  });
  it('locked objects still collide', () => {
    const q = proj([box('a', 1, 2, { locked: true }), box('b', 3, 2)]);
    expect(rejected(proposeMove(q, 'b', { x: 1.5, y: 2 })).violations[0].type).toBe('physical_collision');
  });
  it('group operations containing a locked object are rejected as a whole', () => {
    const q = proj([box('a', 1, 2, { locked: true }), box('b', 3, 2)]);
    expect(rejected(proposeGroupMove(q, ['a', 'b'], { x: 0.1, y: 0 })).violations[0].type).toBe('locked');
    expect(rejected(proposeGroupRotate(q, ['a', 'b'], 1)).violations[0].type).toBe('locked');
    expect(rejected(proposeGroupDelete(q, ['a', 'b'])).violations[0].type).toBe('locked');
  });
});

describe('proposeResize / proposeRotate', () => {
  it('resize quantizes and carries from/to', () => {
    const c = cmdOf(proposeResize(proj(), 'a', { position: { x: 2.0004, y: 2 }, width: 1.2344, length: 1 }));
    expect(c).toEqual({
      type: 'ResizeFurniture', instanceId: 'a',
      from: { position: { x: 2, y: 2 }, width: 1, length: 1 }, to: { position: { x: 2, y: 2 }, width: 1.234, length: 1 },
    });
  });
  it('resize beyond the wall is rejected', () => {
    expect(rejected(proposeResize(proj(), 'a', { position: { x: 3.5, y: 2 }, width: 2, length: 1 })).violations[0].type).toBe('outside_room');
  });
  it('non-positive sizes are a programming error', () => {
    expect(() => proposeResize(proj(), 'a', { position: { x: 2, y: 2 }, width: 0, length: 1 })).toThrow(RangeError);
  });
  it('rotate quantizes to 0.1° and normalises to [0, 2π)', () => {
    const c = cmdOf(proposeRotate(proj(), 'a', deg(45.04))) as { to: number };
    expect(c.to).toBeCloseTo(deg(45), 12);
    const wrap = cmdOf(proposeRotate(proj(), 'a', deg(-90))) as { to: number };
    expect(wrap.to).toBeCloseTo(deg(270), 12);
  });
  it('rotate honours the active angular snap increment', () => {
    const c = cmdOf(proposeRotate(proj(), 'a', deg(52), { angularSnapDeg: 15 })) as { to: number };
    expect(c.to).toBeCloseTo(deg(45), 12);
  });
  it('rotating a square into a wall is rejected; 360° is a no-op', () => {
    const p = proj([box('a', 0.5, 2.5)]); // touching the left wall, unrotated
    expect(rejected(proposeRotate(p, 'a', deg(45))).violations[0].type).toBe('outside_room');
    expect(rejected(proposeRotate(p, 'a', deg(360)))).toMatchObject({ noop: true });
  });
});

describe('place / delete / update', () => {
  it('place quantizes (rotation too) and validates', () => {
    const c = cmdOf(proposePlaceFurniture(proj(), box('n', 3.0004, 3, { rotation: deg(90.04) }))) as { instance: { position: { x: number }; rotation: number } };
    expect(c.instance.position.x).toBe(3);
    expect(c.instance.rotation).toBeCloseTo(deg(90), 12);
  });
  it('place into a collision is rejected', () => {
    expect(rejected(proposePlaceFurniture(proj(), box('n', 2.4, 2))).violations[0].type).toBe('physical_collision');
  });
  it('delete carries the full snapshot', () => {
    expect(cmdOf(proposeDelete(proj(), 'a'))).toMatchObject({ type: 'DeleteFurniture', snapshot: { id: 'a' } });
  });
  it('UpdateFurniture: metadata edit needs no validation and builds from/to with null for absent', () => {
    const c = cmdOf(proposeUpdateFurniture(proj(), 'a', { metadata: { sku: 'S1' } }));
    expect(c).toEqual({ type: 'UpdateFurniture', instanceId: 'a', from: { metadata: null }, to: { metadata: { sku: 'S1' } } });
  });
  it('UpdateFurniture: raising an object into another is rejected (vertical collision)', () => {
    const p = proj([box('a', 2, 2, { elevation: 1.5, height: 0.5 }), box('b', 2, 2, { height: 1 })]);
    expect(rejected(proposeUpdateFurniture(p, 'a', { elevation: 0.5 })).violations[0].type).toBe('physical_collision');
    expect(cmdOf(proposeUpdateFurniture(p, 'a', { elevation: 1.0004 }))).toMatchObject({ to: { elevation: 1 } });
  });
});

describe('fixtures', () => {
  it('place validates wall fit and swing', () => {
    expect(cmdOf(proposePlaceFixture(proj(), makeDoor({ id: 'd' }))).type).toBe('PlaceFixture');
    expect(rejected(proposePlaceFixture(proj(), makeDoor({ id: 'd', offsetAlongWall: 0.3 }))).violations[0].type).toBe('fixture_out_of_wall');
  });
  it('a door whose swing would hit existing furniture is rejected', () => {
    const p = proj([box('a', 2, 0.6, { width: 0.3, length: 0.3 })]);
    expect(rejected(proposePlaceFixture(p, makeDoor({ id: 'd' }))).violations[0].type).toBe('door_swing');
  });
  it('unknown wall throws ID_NOT_FOUND', () => {
    expect(() => proposePlaceFixture(proj(), makeDoor({ id: 'd', wallId: 'nope' }))).toThrow(/ID_NOT_FOUND/);
  });
  it('update quantizes and builds inverse data; invalid result is rejected', () => {
    const p = proj([], { fixtures: [makeDoor({ id: 'd' })] });
    expect(cmdOf(proposeUpdateFixture(p, 'd', { offsetAlongWall: 1.2504 }))).toEqual({
      type: 'UpdateFixture', fixtureId: 'd', from: { offsetAlongWall: 2 }, to: { offsetAlongWall: 1.25 },
    });
    expect(rejected(proposeUpdateFixture(p, 'd', { offsetAlongWall: 0.3 })).violations[0].type).toBe('fixture_out_of_wall');
  });
  it('an already-invalid fixture can be dragged toward validity but not away (escape rule)', () => {
    const p = proj([], { fixtures: [makeDoor({ id: 'd', offsetAlongWall: 0.4 })] }); // lo = -0.05
    expect(cmdOf(proposeUpdateFixture(p, 'd', { offsetAlongWall: 0.43 })).type).toBe('UpdateFixture'); // still invalid, but less
    expect(rejected(proposeUpdateFixture(p, 'd', { offsetAlongWall: 0.3 })).violations.length).toBeGreaterThan(0);
  });
  it('delete fixture carries a snapshot', () => {
    const p = proj([], { fixtures: [makeDoor({ id: 'd' })] });
    expect(cmdOf(proposeDeleteFixture(p, 'd'))).toMatchObject({ type: 'DeleteFixture', snapshot: { id: 'd' } });
  });
});

describe('EditWall (§6a pipeline exception) and CreateRoom (C14)', () => {
  const geom = (p: Project) => ({ vertices: p.rooms[0].vertices, walls: p.rooms[0].walls, fixtures: p.rooms[0].fixtures });
  it('commits even when furniture becomes invalid; only polygon validity blocks', () => {
    const p = proj([box('a', 2, 4.5)]);
    const g = geom(p);
    const vertices = g.vertices.map((v) => (v.id === 'v3' ? { ...v, position: { x: 4, y: 3 } } : v.id === 'v4' ? { ...v, position: { x: 0, y: 3 } } : v));
    const c = cmdOf(proposeEditWall(p, 'room-1', { ...g, vertices }));
    expect(c.type).toBe('EditWall');
    const after = apply(c, p);
    expect(validateRoom(after.rooms[0], []).valid).toBe(false); // derived invalid, edit still committed
  });
  it('carries full from-state including fixtures (C5)', () => {
    const p = proj([], { fixtures: [makeDoor({ id: 'd' })] });
    const c = cmdOf(proposeEditWall(p, 'room-1', geom(p))) as { from: { fixtures: unknown[] } };
    expect(c.from.fixtures).toHaveLength(1);
  });
  it('self-intersecting polygon is rejected with a stable code', () => {
    const p = proj();
    const g = geom(p);
    const vertices = [g.vertices[0], g.vertices[2], g.vertices[1], g.vertices[3]]; // bow-tie
    expect(rejected(proposeEditWall(p, 'room-1', { ...g, vertices })).polygonError).toBe('SELF_INTERSECTION');
  });
  it('quantizes vertices, thickness and fixture offsets; normalises to CCW', () => {
    const p = proj();
    const g = geom(p);
    const cw = [...g.vertices].reverse().map((v) => ({ ...v, position: { x: v.position.x + 0.0004, y: v.position.y } }));
    const c = cmdOf(proposeEditWall(p, 'room-1', { ...g, vertices: cw, walls: g.walls.map((w) => ({ ...w, thickness: 0.1504 })) })) as {
      to: { vertices: Array<{ id: string; position: { x: number } }>; walls: Array<{ thickness: number }> };
    };
    expect(c.to.walls[0].thickness).toBe(0.15);
    expect(c.to.vertices.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4']); // clockwise input reversed back to CCW
    expect(c.to.vertices.map((v) => v.position.x)).toEqual([0, 4, 4, 0]); // +0.0004 quantized away
  });
  it('CreateRoom: blocked on an invalid polygon, emitted for a valid one', () => {
    const p = makeProject([]);
    const vs = rectVertices(4, 5, 'n');
    const good = makeRoom({ id: 'r2', vertices: vs, walls: ringWalls(vs, 'nw') });
    expect(cmdOf(proposeCreateRoom(p, good)).type).toBe('CreateRoom');
    const flat = rectVertices(4, 5, 'n').map((v) => ({ ...v, position: { x: v.position.x, y: 0 } }));
    expect(rejected(proposeCreateRoom(p, makeRoom({ id: 'r2', vertices: flat, walls: ringWalls(flat, 'nw') }))).polygonError).toBe('DEGENERATE_EDGE');
    const few = vs.slice(0, 2);
    expect(rejected(proposeCreateRoom(p, makeRoom({ id: 'r2', vertices: few, walls: [] }))).polygonError).toBe('TOO_FEW_VERTICES');
  });
  it('DeleteRoom carries the full snapshot', () => {
    expect(cmdOf(proposeDeleteRoom(proj(), 'room-1'))).toMatchObject({ type: 'DeleteRoom', snapshot: { id: 'room-1' } });
  });
});

describe('already-invalid objects: escape rule (Phase 1 §6)', () => {
  // Sofa 2 wide centred at x=3.6 pokes 0.6 m through the right wall (x=4): outside_room magnitude > 0
  const p = () => proj([box('a', 3.6, 2.5, { width: 2, length: 1 })]);
  it('a move that worsens the violation is rejected', () => {
    expect(rejected(proposeMove(p(), 'a', { x: 3.9, y: 2.5 })).violations.length).toBeGreaterThan(0);
  });
  it('a move that shrinks the violation commits', () => {
    expect(cmdOf(proposeMove(p(), 'a', { x: 3.3, y: 2.5 })).type).toBe('MoveFurniture');
  });
  it('sliding an invalid object parallel to the wall commits: unchanged violation size is not "worse" (EPSILON tolerance)', () => {
    // pokes 0.6 m through the right wall; moving only in y keeps the overshoot identical up to float noise
    let state: Project = p();
    for (const y of [2.6, 2.7, 2.8, 2.9, 3.0, 2.0, 1.5]) {
      const r = proposeMove(state, 'a', { x: 3.6, y });
      expect(r.rejected, `y=${y}`).toBe(false);
      if (!r.rejected) state = apply(r.command, state);
    }
    expect(state.rooms[0].furniture[0].position).toEqual({ x: 3.6, y: 1.5 });
  });
  it('a move into a fully valid position commits', () => {
    expect(cmdOf(proposeMove(p(), 'a', { x: 3, y: 2.5 })).type).toBe('MoveFurniture');
  });
  it('a move that introduces a NEW violation type is rejected even if the old one shrinks', () => {
    const q = proj([box('a', 3.6, 2.5, { width: 2, length: 1 }), box('b', 2.2, 2.5, { width: 0.6, length: 0.6 })]);
    expect(rejected(proposeMove(q, 'a', { x: 3.2, y: 2.5 })).violations.some((v) => v.type === 'physical_collision')).toBe(true);
  });
  it('the violation set shrinks monotonically along a drag toward validity', () => {
    let state: Project = p();
    let last = Infinity;
    for (const x of [3.5, 3.4, 3.3, 3.2, 3.1, 3.0]) {
      const r = proposeMove(state, 'a', { x, y: 2.5 });
      const c = cmdOf(r);
      state = apply(c, state);
      const mag = validateRoom(state.rooms[0], []).violations.reduce((m, v) => m + (v.magnitude ?? 0), 0);
      expect(mag).toBeLessThanOrEqual(last + 1e-9);
      last = mag;
    }
    expect(last).toBe(0);
  });
});

describe('fix position (C10, B5)', () => {
  it('moves by translation only to the nearest valid position, one MoveFurniture', () => {
    const p = proj([box('a', 3.6, 2.5, { width: 2, length: 1, rotation: 0 })]);
    const c = cmdOf(proposeFixPosition(p, 'a')) as { type: string; to: { x: number; y: number }; from: { x: number } };
    expect(c.type).toBe('MoveFurniture');
    expect(c.to.x).toBeCloseTo(3.0, 3); // right edge flush with x = 4
    expect(c.to.y).toBeCloseTo(2.5, 3);
    const after = apply(c as never, p);
    expect(validateRoom(after.rooms[0], []).valid).toBe(true);
    expect(after.rooms[0].furniture[0].width).toBe(2); // size and rotation untouched
  });
  it('an already-valid object is a noop', () => {
    expect(rejected(proposeFixPosition(proj(), 'a'))).toMatchObject({ noop: true });
  });
  it('no valid position: message shown, no command emitted', () => {
    const p = proj([box('a', 2, 2, { width: 10, length: 10 })]);
    const r = rejected(proposeFixPosition(p, 'a'));
    expect(r.message).toBe('No valid position — resize or move manually');
  });
});

describe('group operations: one Composite = one history entry', () => {
  const p = () => proj([box('a', 1, 1), box('b', 3, 3)]);
  it('group move', () => {
    const c = cmdOf(proposeGroupMove(p(), ['a', 'b'], { x: 0.5, y: 0.25 }));
    expect(c.type).toBe('Composite');
    const h = new CommandHistory();
    h.push(c);
    expect(h.length).toBe(1);
    const after = apply(c, p());
    expect(after.rooms[0].furniture.map((f) => f.position)).toEqual([{ x: 1.5, y: 1.25 }, { x: 3.5, y: 3.25 }]);
    expect(h.undo(after)!.rooms[0].furniture.map((f) => f.position)).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }]);
  });
  it('group move is all-or-nothing', () => {
    expect(rejected(proposeGroupMove(p(), ['a', 'b'], { x: 1, y: 0 })).violations[0].type).toBe('outside_room'); // b hits the wall
  });
  it('group rotate pivots about the bounding-box centre of the selection (B2)', () => {
    // footprints span x 0.5..3.5, y 0.5..3.5 -> pivot (2,2). 90°: (1,1) -> (3,1), (3,3) -> (1,3)
    const c = cmdOf(proposeGroupRotate(p(), ['a', 'b'], deg(90)));
    const after = apply(c, p());
    const [a, b] = after.rooms[0].furniture;
    expect(a.position.x).toBeCloseTo(3, 3);
    expect(a.position.y).toBeCloseTo(1, 3);
    expect(b.position.x).toBeCloseTo(1, 3);
    expect(b.position.y).toBeCloseTo(3, 3);
    expect(a.rotation).toBeCloseTo(deg(90), 12);
  });
  it('group delete', () => {
    const after = apply(cmdOf(proposeGroupDelete(p(), ['a', 'b'])), p());
    expect(after.rooms[0].furniture).toEqual([]);
  });
});

describe('rejected commits leave state and history untouched', () => {
  it('state deep-equals before; history length unchanged', () => {
    const p = proj();
    const snapshot = JSON.stringify(p);
    const h = new CommandHistory();
    const r = proposeMove(p, 'a', { x: 0.1, y: 0.1 });
    if (!r.rejected) h.push(r.command);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(h.length).toBe(0);
  });
});
