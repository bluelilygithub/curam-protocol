import { describe, expect, it } from 'vitest';
import {
  apply, checkFixtureInWall, CommandHistory, cyclePick, dist, DIM_SCALE_LIMIT, doorFrame, footprintOf, isAboveCutPlane, liveDimensions,
  marqueeSelect, MAX_DIMS, pickAll, proposeDuplicate, rotateVec, snapFixtureToWall, wallOutlines, CUT_PLANE_HEIGHT,
} from '../../src/engine';
import type { Command, SelectionRef } from '../../src/engine';
import { FIXTURE_LIBRARY, SEED_MATERIALS } from '../../src/data/furnitureLibrary';
import { makeDoor, makeInstance, makeProject, makeRoom, rectVertices, ringWalls } from '../helpers';

const box = (id: string, x: number, y: number, over = {}) => makeInstance({ id, position: { x, y }, width: 1, length: 1, ...over });
const place = (id: string): Command => ({ type: 'PlaceFurniture', instance: box(id, 1, 1) });

describe('history labels (B9)', () => {
  const start = makeProject([makeRoom()]);
  it('undo/redo label the entry they act on', () => {
    const h = new CommandHistory();
    let s = start;
    for (const [id, label] of [['a', 'Place Sofa'], ['b', 'Place Table']] as const) {
      const c = place(id);
      s = apply(c, s);
      h.push(c, label);
    }
    expect(h.undoLabel()).toBe('Place Table');
    expect(h.redoLabel()).toBeUndefined();
    s = h.undo(s)!;
    expect(h.undoLabel()).toBe('Place Sofa');
    expect(h.redoLabel()).toBe('Place Table');
    h.redo(s);
    expect(h.undoLabel()).toBe('Place Table');
  });
  it('a new push clears redo labels; labels survive JSON', () => {
    const h = new CommandHistory();
    h.push(place('a'), 'One');
    h.push(place('b'), 'Two');
    const restored = CommandHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(restored.undoLabel()).toBe('Two');
    h.undo(apply(place('b'), apply(place('a'), start)));
    h.push(place('c'), 'Three');
    expect(h.redoLabel()).toBeUndefined();
  });
  it('unlabelled entries are fine', () => {
    const h = new CommandHistory();
    h.push(place('a'));
    expect(h.undoLabel()).toBeUndefined();
    expect(h.canUndo()).toBe(true);
  });
});

describe('snapFixtureToWall (A4, C8)', () => {
  const room = makeRoom(); // 4 x 5; w1 bottom (L 4), w4 left (L 5, runs top to bottom)
  it('snaps to the nearest wall within 0.5 m and projects the pointer along it', () => {
    const s = snapFixtureToWall(room, { x: 1, y: 0.3 }, 0.82)!;
    expect(s).toMatchObject({ wallId: 'w1', offsetAlongWall: 1, clamped: false });
    expect(s.distance).toBeCloseTo(0.3, 12);
    expect(s.normal).toEqual({ x: -0, y: 1 }); // interior normal points into the room
  });
  it('clamps so the opening edge stays 50 mm from the wall end (centre >= 0.46 for 0.82 wide)', () => {
    const s = snapFixtureToWall(room, { x: 0.45, y: 0.2 }, 0.82)!; // w1 is nearer (0.2) than w4 (0.45)
    expect(s.wallId).toBe('w1');
    expect(s.offsetAlongWall).toBe(0.46);
    expect(s.clamped).toBe(true);
  });
  it('picks the closer of two walls near a corner and measures from that wall’s START vertex', () => {
    // w4 runs (0,5) -> (0,0); pointer (0.1, 0.3): 0.1 from w4, projection 4.7 from its start, clamp hi = 5 - 0.41 - 0.05 = 4.54
    const s = snapFixtureToWall(room, { x: 0.1, y: 0.3 }, 0.82)!;
    expect(s).toMatchObject({ wallId: 'w4', offsetAlongWall: 4.54, clamped: true });
  });
  it('null when no wall is within range', () => {
    expect(snapFixtureToWall(room, { x: 2, y: 2.5 }, 0.82)).toBeNull();
  });
  it('a wall too short for the fixture is never a candidate (width > L - 0.1)', () => {
    expect(snapFixtureToWall(room, { x: 2, y: 0.2 }, 3.95)).toBeNull();
    expect(snapFixtureToWall(room, { x: 2, y: 0.2 }, 3.9)?.wallId).toBe('w1');
  });
  it('rounding to the 1 mm grid never steps outside the legal range (odd-mm width)', () => {
    const s = snapFixtureToWall(room, { x: 0.45, y: 0.2 }, 0.821)!;
    expect(s.offsetAlongWall).toBeGreaterThanOrEqual(0.821 / 2 + 0.05 - 1e-9);
    const f = { id: 'f', type: 'window' as const, wallId: s.wallId, offsetAlongWall: s.offsetAlongWall, width: 0.821, height: 1, elevation: 0.9 };
    expect(checkFixtureInWall(room, f)).toEqual([]);
  });
  it('respects a custom snap distance', () => {
    expect(snapFixtureToWall(room, { x: 1, y: 0.3 }, 0.82, 0.2)).toBeNull();
  });
});

describe('wallOutlines (C16: mitred outer corners, interior untouched)', () => {
  const vs = rectVertices(4, 5);
  const walls = ringWalls(vs).map((w, i) => ({ ...w, thickness: [0.15, 0.2, 0.15, 0.1][i] }));
  const out = wallOutlines(vs, walls);
  it('one outline per wall, in polygon order, carrying its own thickness', () => {
    expect(out.map((o) => [o.wallId, o.thickness])).toEqual([['w1', 0.15], ['w2', 0.2], ['w3', 0.15], ['w4', 0.1]]);
  });
  it('bottom wall: outer faces meet the neighbours at the mitre points (4.2, -0.15) and (-0.1, -0.15)', () => {
    const p = out[0].polygon;
    expect(p[0]).toEqual({ x: 0, y: 0 });
    expect(p[1]).toEqual({ x: 4, y: 0 });
    expect(p[2].x).toBeCloseTo(4.2, 12);
    expect(p[2].y).toBeCloseTo(-0.15, 12);
    expect(p[3].x).toBeCloseTo(-0.1, 12);
    expect(p[3].y).toBeCloseTo(-0.15, 12);
  });
  it('adjoining walls share the same outer corner point', () => {
    const w1End = out[0].polygon[2];
    const w2Start = out[1].polygon[3];
    expect(dist(w1End, w2Start)).toBeLessThan(1e-12);
  });
  it('the interior face of every wall is exactly the room edge (thickness expands outward only)', () => {
    out.forEach((o, i) => {
      expect(o.polygon[0]).toEqual(vs[i].position);
      expect(o.polygon[1]).toEqual(vs[(i + 1) % 4].position);
    });
  });
  it('collinear neighbours of different thickness step at the vertex', () => {
    const v = [
      { id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 2, y: 0 } }, { id: 'c', position: { x: 4, y: 0 } },
      { id: 'd', position: { x: 4, y: 5 } }, { id: 'e', position: { x: 0, y: 5 } },
    ];
    const w = [
      { id: 'w1', startVertexId: 'a', endVertexId: 'b', thickness: 0.1 }, { id: 'w2', startVertexId: 'b', endVertexId: 'c', thickness: 0.3 },
      { id: 'w3', startVertexId: 'c', endVertexId: 'd', thickness: 0.15 }, { id: 'w4', startVertexId: 'd', endVertexId: 'e', thickness: 0.15 },
      { id: 'w5', startVertexId: 'e', endVertexId: 'a', thickness: 0.15 },
    ];
    const o = wallOutlines(v, w);
    expect(o[0].polygon[2]).toEqual({ x: 2, y: -0.1 });
    expect(o[1].polygon[3]).toEqual({ x: 2, y: -0.3 });
  });
  it('a very sharp corner falls back to a butt joint instead of a spike', () => {
    const v = [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 10, y: 0 } }, { id: 'c', position: { x: 0.5, y: 0.2 } }];
    // vertex b (10,0) has a ~1° interior angle: a mitre there would reach ~9 m. Both walls meeting at b must butt instead.
    const o = wallOutlines(v, ringWalls(v, 'w', 0.15));
    expect(dist(o[0].polygon[2], v[1].position)).toBeCloseTo(0.15, 9); // wall a→b ends at b
    expect(dist(o[1].polygon[3], v[1].position)).toBeCloseTo(0.15, 9); // wall b→c starts at b
    // the obtuse corner at c is still mitred (slightly longer than the thickness, not a butt)
    expect(dist(o[1].polygon[2], v[2].position)).toBeGreaterThan(0.15);
    expect(dist(o[1].polygon[2], v[2].position)).toBeLessThan(0.6);
  });
  it('a wall missing from the list falls back to the default thickness; fewer than 3 vertices -> none', () => {
    expect(wallOutlines(vs, [])[0].thickness).toBe(0.15);
    expect(wallOutlines(vs.slice(0, 2), [])).toEqual([]);
  });
});

describe('liveDimensions (B10)', () => {
  const door = makeDoor({ id: 'd', offsetAlongWall: 2, width: 0.9 });
  const room = makeRoom({ fixtures: [door] });
  const moving = box('m', 1, 1);
  const other = box('o', 3, 1);
  const lines = (mpp = 0.01) => liveDimensions({ moving, room, others: [other], metresPerPixel: mpp });

  it('shows nearest wall per axis, nearest furniture edge, nearest fixture and alignment (5 lines here)', () => {
    const l = lines();
    expect(l.map((x) => x.kind)).toEqual(['wall', 'wall', 'fixture', 'furniture', 'alignment']);
    const wall = l.filter((x) => x.kind === 'wall').map((x) => x.length);
    expect(wall[0]).toBeCloseTo(0.5, 9); // left edge 0.5 m from x = 0
    expect(wall[1]).toBeCloseTo(0.5, 9); // bottom edge 0.5 m from y = 0
    expect(l.find((x) => x.kind === 'furniture')!.length).toBeCloseTo(1.0, 9); // 1.5 .. 2.5
    expect(l.find((x) => x.kind === 'fixture')!.length).toBeCloseTo(Math.SQRT1_2, 9);
    expect(l.find((x) => x.kind === 'alignment')!.length).toBeCloseTo(2, 9); // same y, centres 2 m apart
    expect(l.find((x) => x.kind === 'wall')!.text).toBe('0.50 m');
  });
  it('below the scale limit (zoomed out) only wall dimensions are shown', () => {
    expect(lines(DIM_SCALE_LIMIT + 0.01).map((x) => x.kind)).toEqual(['wall', 'wall']);
    expect(lines(DIM_SCALE_LIMIT).length).toBe(5);
  });
  it('never more than 6 lines, and labels never overlap, wherever the object is', () => {
    const crowd = [box('a', 2, 3), box('b', 3, 1), box('c', 1, 3), box('d', 3, 3)];
    for (let x = 0.6; x <= 3.4; x += 0.4) {
      for (let y = 0.6; y <= 4.4; y += 0.4) {
        const out = liveDimensions({ moving: box('m', x, y), room, others: crowd, metresPerPixel: 0.01 });
        expect(out.length).toBeLessThanOrEqual(MAX_DIMS);
        const labels = out.map((l) => l.label).filter((l): l is NonNullable<typeof l> => !!l);
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            const overlap =
              Math.abs(labels[i].center.x - labels[j].center.x) < (labels[i].width + labels[j].width) / 2 &&
              Math.abs(labels[i].center.y - labels[j].center.y) < (labels[i].height + labels[j].height) / 2;
            expect(overlap).toBe(false);
          }
        }
      }
    }
  });
  it('a label that would collide is offset along its line; with no free spot it is suppressed (line stays)', () => {
    // two walls hit at the same point from a tiny object in a corner share nearly the same label centre
    const out = liveDimensions({ moving: box('m', 0.52, 0.52, { width: 0.04, length: 0.04 }), room: makeRoom(), others: [], metresPerPixel: 0.05 });
    expect(out).toHaveLength(2);
    expect(out.filter((l) => l.label).length).toBeGreaterThanOrEqual(1);
  });
  it('only walls at the same axis: nearest wins when two are in range', () => {
    const out = liveDimensions({ moving: box('m', 3.4, 2.5), room: makeRoom(), others: [], metresPerPixel: 0.01 });
    expect(out.find((l) => l.kind === 'wall')!.length).toBeCloseTo(0.1, 9); // right edge 3.9 -> x = 4
  });
});

describe('selection (B6)', () => {
  const door = makeDoor({ id: 'door', offsetAlongWall: 2, width: 0.9 });
  const tall = box('z-tall', 2, 2.5, { height: 2.1 });
  const low = box('a-low', 2, 2.5, { height: 0.42 });
  const room = makeRoom({ fixtures: [door], furniture: [low, tall] });

  it('objects above the cut-plane are picked before floor-level ones at the same point', () => {
    expect(pickAll(room, { x: 2, y: 2.5 })).toEqual([
      { kind: 'furniture', id: 'z-tall' }, { kind: 'furniture', id: 'a-low' },
    ]);
    expect(isAboveCutPlane({ elevation: 0, height: 2.1 })).toBe(true);
    expect(isAboveCutPlane({ elevation: 0.8, height: 0.4 })).toBe(false); // 1.2 exactly is not above
    expect(isAboveCutPlane({ elevation: 0.8, height: 0.41 }, CUT_PLANE_HEIGHT)).toBe(true);
  });
  it('fixture opening (through the wall thickness) is hit before the wall; elsewhere the wall alone', () => {
    expect(pickAll(room, { x: 2, y: -0.05 })).toEqual([{ kind: 'fixture', id: 'door' }, { kind: 'wall', id: 'w1' }]);
    expect(pickAll(room, { x: 0.5, y: -0.05 })).toEqual([{ kind: 'wall', id: 'w1' }]);
  });
  it('nothing under an empty floor point', () => {
    expect(pickAll(room, { x: 0.6, y: 4.5 })).toEqual([]);
  });
  it('tolerance widens the hit area', () => {
    expect(pickAll(room, { x: 2, y: 3.04 }, { tolerance: 0.05 }).length).toBeGreaterThan(0);
    expect(pickAll(room, { x: 2, y: 3.04 }, { tolerance: 0.01 })).toEqual([]);
  });
  it('marquee needs the WHOLE footprint inside', () => {
    const r = makeRoom({ furniture: [box('in', 1, 1), box('partly', 1.8, 1)] });
    expect(marqueeSelect(r, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([{ kind: 'furniture', id: 'in' }]);
    expect(marqueeSelect(r, { x: 2, y: 2 }, { x: 0, y: 0 })).toEqual([{ kind: 'furniture', id: 'in' }]); // corner order is irrelevant
  });
  it('marquee also takes fixtures whose opening is fully inside; never walls', () => {
    const got = marqueeSelect(room, { x: 1, y: -0.5 }, { x: 3, y: 5 });
    expect(got).toContainEqual({ kind: 'fixture', id: 'door' });
    expect(got.some((r) => r.kind === 'wall')).toBe(false);
    expect(marqueeSelect(room, { x: 2.1, y: -0.5 }, { x: 3, y: 5 }).some((r) => r.kind === 'fixture')).toBe(false);
  });

  describe('cyclePick', () => {
    const hits: SelectionRef[] = [{ kind: 'furniture', id: 'a' }, { kind: 'furniture', id: 'b' }, { kind: 'furniture', id: 'c' }];
    it('first click = nearest; repeats within 500 ms at the same point go deeper and wrap', () => {
      let r = cyclePick(hits, { x: 100, y: 100 }, 1000, null);
      expect(r.pick!.id).toBe('a');
      r = cyclePick(hits, { x: 101, y: 100 }, 1300, r.state);
      expect(r.pick!.id).toBe('b');
      r = cyclePick(hits, { x: 100, y: 100 }, 1600, r.state);
      expect(r.pick!.id).toBe('c');
      r = cyclePick(hits, { x: 100, y: 100 }, 1900, r.state);
      expect(r.pick!.id).toBe('a');
    });
    it('a slow click or a different point starts over', () => {
      const first = cyclePick(hits, { x: 100, y: 100 }, 1000, null);
      expect(cyclePick(hits, { x: 100, y: 100 }, 1600, first.state).pick!.id).toBe('a');
      expect(cyclePick(hits, { x: 140, y: 100 }, 1100, first.state).pick!.id).toBe('a');
    });
    it('no hits -> null and no state', () => {
      expect(cyclePick([], { x: 0, y: 0 }, 0, null)).toEqual({ pick: null, state: null });
    });
  });
});

describe('proposeDuplicate (A6)', () => {
  const small = (id: string, x: number, y: number, over = {}) => box(id, x, y, { width: 0.05, length: 0.05, ...over });
  const project = (furniture: ReturnType<typeof box>[]) => makeProject([makeRoom({ furniture })]);

  it('offsets +0.1 m on both axes with the caller-supplied id; the copy is not locked', () => {
    const r = proposeDuplicate(project([small('a', 1, 1, { locked: true })]), ['a'], ['a2']);
    expect(r.rejected).toBe(false);
    if (!r.rejected) {
      expect(r.command).toMatchObject({ type: 'PlaceFurniture', instance: { id: 'a2', position: { x: 1.1, y: 1.1 } } });
      expect('locked' in (r.command as { instance: object }).instance).toBe(false);
    }
  });
  it('several instances become one Composite', () => {
    const r = proposeDuplicate(project([small('a', 1, 1), small('b', 3, 3)]), ['a', 'b'], ['a2', 'b2']);
    expect(r.rejected).toBe(false);
    if (!r.rejected) expect(r.command.type).toBe('Composite');
  });
  it('an offset copy that hits its source is rejected, nothing is committed (the ghost stays attached)', () => {
    const r = proposeDuplicate(project([box('a', 1, 1)]), ['a'], ['a2']);
    expect(r).toMatchObject({ rejected: true });
    if (r.rejected) expect(r.violations.some((v) => v.type === 'physical_collision')).toBe(true);
  });
  it('rejected if the offset leaves the room', () => {
    const r = proposeDuplicate(project([small('a', 3.98, 1)]), ['a'], ['a2']);
    expect(r.rejected && r.violations[0].type).toBe('outside_room');
  });
  it('needs exactly one new id per instance', () => {
    expect(() => proposeDuplicate(project([small('a', 1, 1)]), ['a'], [])).toThrow(RangeError);
  });
  it('copies keep size, metadata and rotation; the source is untouched', () => {
    const src = small('a', 1, 1, { metadata: { sku: 'S1' } });
    const p = project([src]);
    const r = proposeDuplicate(p, ['a'], ['a2']);
    if (r.rejected) throw new Error('rejected');
    const after = apply(r.command, p);
    expect(after.rooms[0].furniture.map((f) => f.id)).toEqual(['a', 'a2']);
    expect(after.rooms[0].furniture[1]).toMatchObject({ width: 0.05, metadata: { sku: 'S1' } });
    expect(footprintOf(after.rooms[0].furniture[0])).toEqual(footprintOf(src));
  });
});

describe('doorFrame (C21): shared by the geometry and the 2D drawing', () => {
  const room = makeRoom();
  it('left hinge (seen from inside, facing the wall) is toward the wall END; leaf starts along −wall direction and swings clockwise into the room', () => {
    const f = doorFrame(room, makeDoor({ id: 'd', offsetAlongWall: 2, width: 0.9, hingeSide: 'left' }))!;
    expect(f.hinge.x).toBeCloseTo(2.45, 12);
    expect(f.closed).toEqual({ x: -1, y: -0 });
    expect(f.sign).toBe(-1);
    expect(f.angle).toBeCloseTo(Math.PI / 2, 12);
    // fully open (90°): the leaf points into the room (+Y for the bottom wall)
    const open = rotateVec(f.closed, f.sign * f.angle);
    expect(open.x).toBeCloseTo(0, 12);
    expect(open.y).toBeCloseTo(1, 12);
  });
  it('right hinge mirrors it', () => {
    const f = doorFrame(room, makeDoor({ id: 'd', offsetAlongWall: 2, width: 0.9, hingeSide: 'right' }))!;
    expect(f.hinge.x).toBeCloseTo(1.55, 12);
    expect(f.sign).toBe(1);
    const open = rotateVec(f.closed, f.sign * f.angle);
    expect(open.y).toBeCloseTo(1, 12);
  });
  it('windows and unknown walls have no frame; a custom swing angle is carried', () => {
    expect(doorFrame(room, { id: 'w', type: 'window', wallId: 'w1', offsetAlongWall: 2, width: 1, height: 1, elevation: 1 })).toBeUndefined();
    expect(doorFrame(room, makeDoor({ id: 'd', wallId: 'nope' }))).toBeUndefined();
    expect(doorFrame(room, makeDoor({ id: 'd', swingAngle: 1 }))!.angle).toBe(1);
  });
});

describe('default fixture and material data', () => {
  it('door 0.82 × 2.04 at elevation 0 with a 90° swing; window 1.20 × 1.20 with a 0.90 sill', () => {
    const door = FIXTURE_LIBRARY.find((d) => d.type === 'door')!;
    const win = FIXTURE_LIBRARY.find((d) => d.type === 'window')!;
    expect([door.width, door.height, door.elevation, door.swingAngle]).toEqual([0.82, 2.04, 0, Math.PI / 2]);
    expect([win.width, win.height, win.elevation]).toEqual([1.2, 1.2, 0.9]);
  });
  it('seed materials respect the Spec §8 ranges and have unique ids', () => {
    expect(new Set(SEED_MATERIALS.map((m) => m.id)).size).toBe(SEED_MATERIALS.length);
    for (const m of SEED_MATERIALS) {
      expect(m.roughness).toBeGreaterThanOrEqual(0.4);
      expect(m.roughness).toBeLessThanOrEqual(0.8);
      expect(m.metalness).toBeGreaterThanOrEqual(0);
      expect(m.metalness).toBeLessThanOrEqual(0.1);
      expect(m.colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
