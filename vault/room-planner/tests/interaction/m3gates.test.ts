// Test Plan §4, M3 gates (architectural editing) against the real interaction engine: the wall tool, corner drag with live
// validation and impact preview, insert/delete corner, draw a room.
import { describe, expect, it } from 'vitest';
import {
  deriveStatus, proposeFixPosition, validatePolygon, validateRoom, wallGeometry, type Command, type Project,
} from '../../src/engine';
import { expectProjectEqual, makeDoor } from '../helpers';
import { inst, makeHarness } from './harness';

const edit = (c: Command) => c as Extract<Command, { type: 'EditWall' }>;
const sofa = (over = {}) => inst({ id: 'a', position: { x: 2, y: 4.5 }, ...over });
const win = { id: 'win', type: 'window' as const, wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9 };

const wallHarness = (o: Parameters<typeof makeHarness>[0] = {}) => {
  const h = makeHarness(o);
  h.key('3');
  return h;
};

describe('the wall tool', () => {
  it('shortcut 3 (and the toolbar) select it; furniture is not pickable there', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.key('3');
    expect(h.ui.getState().tool).toBe('wall_edit');
    expect(h.ui.getState().selection).toEqual([]); // entering the tool clears a furniture selection
    h.drag([2, 4.5], [2, 4.5], 0);
    expect(h.ui.getState().selection).toEqual([]);
    expect(h.pushes).toHaveLength(0);
  });
  it('corners are picked within 0.15 m, and never under 20 px (B1)', () => {
    const h = wallHarness();
    h.drag([3.88, 4.9], [3.88, 4.9], 0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'vertex', id: 'v3' }]);
    h.ui.getState().clearSelection();
    h.drag([3.7, 4.7], [3.7, 4.7], 0); // 0.36 away at 100 px/m: radius is 20 px = 0.2 m: not a corner
    expect(h.ui.getState().selection.some((s) => s.kind === 'vertex')).toBe(false);
    h.drag([3.82, 5], [3.82, 5], 0); // 0.18 away: inside the 20 px floor (0.2 m)
    expect(h.ui.getState().selection).toEqual([{ kind: 'vertex', id: 'v3' }]);
  });
  it('the pick radius is 0.15 m when zoomed far in (20 px is smaller than that)', () => {
    const h = wallHarness();
    h.drag([3.86, 5], [3.86, 5], 0, { mpp: 0.001 }); // 0.14 away
    expect(h.ui.getState().selection).toEqual([{ kind: 'vertex', id: 'v3' }]);
    h.ui.getState().clearSelection();
    h.drag([3.8, 5], [3.8, 5], 0, { mpp: 0.001 }); // 0.20 away: outside 0.15
    expect(h.ui.getState().selection.some((s) => s.kind === 'vertex')).toBe(false);
  });
  it('a wall segment is selected by clicking its body away from the corners', () => {
    const h = wallHarness();
    h.drag([2, -0.07], [2, -0.07], 0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'wall', id: 'w1' }]);
  });
  it('clicking empty floor clears the selection', () => {
    const h = wallHarness();
    h.drag([2, 2.5], [2, 2.5], 0);
    expect(h.ui.getState().selection).toEqual([]);
  });
});

describe('dragging a corner', () => {
  it('one drag = exactly one EditWall = one history entry; the new corner position is committed', () => {
    const h = wallHarness();
    h.drag([4, 5], [3.5, 4.6]);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].command.type).toBe('EditWall');
    expect(h.pushes[0].label).toBe('Move corner');
    expect(h.room().vertices.find((v) => v.id === 'v3')!.position).toEqual({ x: 3.5, y: 4.6 });
    expect(h.room().vertices.filter((v) => v.id !== 'v3')).toEqual(h.state().rooms[0].vertices.filter((v) => v.id !== 'v3'));
  });
  it('the corner snaps to the grid, to another corner, and to alignment with one', () => {
    const h = wallHarness();
    h.drag([4, 5], [3.93, 4.96]); // grid (3.9, 5.0)... alignment with v2.x = 4 is 0.07 away, y aligned with v4.y = 5 is 0.04 away
    const p = h.room().vertices.find((v) => v.id === 'v3')!.position;
    expect(p.x === 3.93 || Math.abs(p.x * 10 - Math.round(p.x * 10)) < 1e-9 || p.x === 4).toBe(true);
    expect(p.y).toBe(5); // y snapped to the top wall's line (alignment with v4 or grid)
  });
  it('pointer moves cause ZERO store updates while a corner is dragged (A12)', () => {
    const h = wallHarness();
    h.it.pointerDown(h.ptr(4, 5));
    const n = { p: 0, u: 0, v: 0 };
    h.project.subscribe(() => n.p++);
    h.ui.subscribe(() => n.u++);
    h.view.subscribe(() => n.v++);
    const published = h.bus.publishCount;
    for (let i = 1; i <= 40; i++) { h.clock.t += 16; h.it.pointerMove(h.ptr(4 - i * 0.01, 5 - i * 0.015)); }
    expect(n).toEqual({ p: 0, u: 0, v: 0 });
    expect(h.bus.publishCount - published).toBeGreaterThanOrEqual(40);
    expect(h.it.stateName).toBe('moving_vertex');
    h.it.pointerUp(h.ptr(3.6, 4.4));
    expect(n.p).toBe(1);
  });
  it('an invalid shape is never committed: the corner sticks at the last valid spot and the bad edges are orange', () => {
    const h = wallHarness();
    h.it.pointerDown(h.ptr(4, 5));
    for (let i = 1; i <= 20; i++) { h.clock.t += 16; h.it.pointerMove(h.ptr(4, 5 - i * 0.3)); } // straight down through the floor wall
    const prev = h.bus.get().roomPreview!;
    expect(prev.badEdges.length).toBeGreaterThan(0);
    const stuck = prev.vertices.find((v) => v.id === 'v3')!.position;
    expect(stuck.x).toBe(4);
    expect(stuck.y).toBeGreaterThanOrEqual(0.001);
    expect(stuck.y).toBeLessThan(0.01);
    expect(validatePolygon(prev.vertices)).toEqual({ ok: true });
    expect(h.bus.get().message).toMatchObject({ severity: 'hard', text: 'Walls cannot cross or overlap, so the corner stops here' });
    h.it.pointerUp(h.ptr(4, -1));
    expect(h.pushes).toHaveLength(1);
    expect(validatePolygon(h.room().vertices)).toEqual({ ok: true });
  });
  it('impact preview: objects that WOULD become invalid are listed with "N object(s) will need attention"; the edit still commits (A3)', () => {
    const h = wallHarness({ furniture: [sofa()] });
    h.it.pointerDown(h.ptr(4, 5));
    for (let i = 1; i <= 8; i++) { h.clock.t += 16; h.it.pointerMove(h.ptr(4, 5 - i * 0.1)); }
    expect(h.bus.get().roomPreview!.vertices.find((v) => v.id === 'v3')!.position).toEqual({ x: 4, y: 4.2 });
    expect(h.bus.get().impact).toEqual(['a']);
    expect(h.bus.get().message).toMatchObject({ text: '1 object will need attention', severity: 'soft' });
    h.it.pointerUp(h.ptr(4, 4.2));
    expect(h.pushes).toHaveLength(1);
    expect(h.inst('a').position).toEqual({ x: 2, y: 4.5 }); // furniture never moves by itself
    expect(deriveStatus(h.state()).get('a')).toBe('hard'); // and re-validation reports it
  });
  it('the preview equals the outcome: what impact listed is exactly what re-validation flags after the commit', () => {
    const h = wallHarness({ furniture: [sofa(), inst({ id: 'b', definitionId: 'coffee-table', position: { x: 3.5, y: 3.7 }, width: 1, length: 0.6, height: 0.42 })], fixtures: [win] });
    // b (x 3.0..4.0, y 3.4..4.0) clears the sofa (y from 4.025) now, and sticks out of the room once the top-right corner drops to y 3.8
    h.it.pointerDown(h.ptr(4, 5));
    for (let i = 1; i <= 12; i++) { h.clock.t += 16; h.it.pointerMove(h.ptr(4, 5 - i * 0.1)); }
    const predicted = [...h.bus.get().impact].sort();
    h.it.pointerUp(h.ptr(4, 3.8));
    const after = h.state();
    const hard = new Set(validateRoom(after.rooms[0], after.furnitureDefinitions).violations.filter((v) => v.severity === 'hard').flatMap((v) => [...v.involvedObjectIds, ...(v.involvedFixtureIds ?? [])]));
    expect([...hard].sort()).toEqual(predicted);
  });
  it('fixtures are re-clamped to the shorter wall as the corner moves, and carried in the command (C5)', () => {
    const h = wallHarness({ fixtures: [win] });
    h.drag([4, 5], [4, 2]);
    const c = edit(h.pushes[0].command);
    expect(c.from.fixtures[0].offsetAlongWall).toBe(2.5);
    expect(c.to.fixtures[0].offsetAlongWall).toBe(1.35);
    expect(h.fixture('win').offsetAlongWall).toBe(1.35);
  });
  it('undo restores geometry, fixtures and validity exactly; redo reapplies', () => {
    const h = wallHarness({ furniture: [sofa()], fixtures: [win] });
    const before = h.state();
    h.drag([4, 5], [4, 2]);
    const after = h.state();
    h.key('z', { ctrl: true });
    expectProjectEqual(h.state(), before);
    h.key('z', { ctrl: true, shift: true });
    expectProjectEqual(h.state(), after);
  });
});

describe('insert and delete a corner (C6, C15)', () => {
  it('double-click on a wall inserts a corner on the line; both halves keep the thickness; one undoable entry', () => {
    const h = wallHarness({ room: { walls: [{ id: 'w1', startVertexId: 'v1', endVertexId: 'v2', thickness: 0.2 }, { id: 'w2', startVertexId: 'v2', endVertexId: 'v3', thickness: 0.15 }, { id: 'w3', startVertexId: 'v3', endVertexId: 'v4', thickness: 0.15 }, { id: 'w4', startVertexId: 'v4', endVertexId: 'v1', thickness: 0.15 }] } });
    const before = h.state();
    h.it.pointerDown(h.ptr(1.3, 0.03)); h.it.pointerUp(h.ptr(1.3, 0.03));
    h.clock.t += 200;
    h.it.pointerDown(h.ptr(1.3, 0.03)); h.it.pointerUp(h.ptr(1.3, 0.03));
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].label).toBe('Add corner');
    const r = h.room();
    expect(r.vertices).toHaveLength(5);
    const nv = r.vertices[1];
    expect(nv.position).toEqual({ x: 1.3, y: 0 }); // on the line, not at the click's y
    expect(h.ui.getState().selection).toEqual([{ kind: 'vertex', id: nv.id }]);
    expect(r.walls.slice(0, 2).map((w) => w.thickness)).toEqual([0.2, 0.2]);
    h.key('z', { ctrl: true });
    expectProjectEqual(h.state(), before);
  });
  it('two slow clicks are not a double-click (they just select the wall)', () => {
    const h = wallHarness();
    h.it.pointerDown(h.ptr(1.3, 0.03)); h.it.pointerUp(h.ptr(1.3, 0.03));
    h.clock.t += 600;
    h.it.pointerDown(h.ptr(1.3, 0.03)); h.it.pointerUp(h.ptr(1.3, 0.03));
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'wall', id: 'w1' }]);
  });
  it('a long press on a wall inserts a corner (touch)', () => {
    const h = wallHarness();
    h.it.pointerDown(h.ptr(2.4, 0.03));
    h.it.longPress();
    h.it.pointerUp(h.ptr(2.4, 0.03));
    expect(h.pushes).toHaveLength(1);
    expect(h.room().vertices).toHaveLength(5);
  });
  it('a fixture whose centre is on the new half moves to the new segment; the others keep their wall', () => {
    const h = wallHarness({ fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 0.8, width: 0.82 }), { ...win, wallId: 'w1', offsetAlongWall: 3 }] });
    h.it.pointerDown(h.ptr(1.3, 0.03)); h.it.pointerUp(h.ptr(1.3, 0.03));
    h.clock.t += 100;
    h.it.pointerDown(h.ptr(1.3, 0.03)); h.it.pointerUp(h.ptr(1.3, 0.03));
    expect(h.fixture('d')).toMatchObject({ wallId: 'w1', offsetAlongWall: 0.8 });
    expect(h.fixture('win')).toMatchObject({ offsetAlongWall: 1.7 }); // 3 − 1.3
    expect(h.fixture('win').wallId).not.toBe('w1');
  });
  it('Delete removes the selected corner when the room stays valid; a triangle keeps its three corners with a plain message', () => {
    const h = wallHarness();
    h.drag([4, 5], [4, 5], 0);
    h.key('Delete');
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].label).toBe('Delete corner');
    expect(h.room().vertices.map((v) => v.id)).toEqual(['v1', 'v2', 'v4']);
    expect(h.ui.getState().selection).toEqual([]);
    h.drag([0, 5], [0, 5], 0);
    h.key('Delete');
    expect(h.pushes).toHaveLength(1);
    expect(h.ui.getState().status?.text).toBe('A room needs at least three corners');
    expect(h.room().vertices).toHaveLength(3);
  });
  it('arrow keys nudge the selected corner by 1 cm (Shift: one grid unit), one entry each', () => {
    const h = wallHarness();
    h.drag([4, 5], [4, 5], 0);
    h.key('ArrowLeft');
    expect(h.room().vertices[2].position).toEqual({ x: 3.99, y: 5 });
    h.key('ArrowDown', { shift: true });
    expect(h.room().vertices[2].position).toEqual({ x: 3.99, y: 4.9 });
    expect(h.pushes).toHaveLength(2);
  });
  it('reshaping the rectangle: insert a corner, drag it in, then pull the top-right corner in (valid at every step)', () => {
    const h = wallHarness();
    const area = (p: Project) => Math.abs(p.rooms[0].vertices.reduce((s, v, i, a) => s + (v.position.x * a[(i + 1) % a.length].position.y - a[(i + 1) % a.length].position.x * v.position.y), 0)) / 2;
    h.it.pointerDown(h.ptr(4.03, 2.5)); h.it.pointerUp(h.ptr(4.03, 2.5)); // right wall w2
    h.clock.t += 100;
    h.it.pointerDown(h.ptr(4.03, 2.5)); h.it.pointerUp(h.ptr(4.03, 2.5)); // → corner at (4, 2.5)
    expect(h.room().vertices).toHaveLength(5);
    const nv = h.room().vertices[2];
    h.drag([4, 2.5], [2, 2.5]); // pull it in: the right side now has a notch
    expect(h.room().vertices.find((v) => v.id === nv.id)!.position).toEqual({ x: 2, y: 2.5 });
    h.drag([4, 5], [2, 5]); // and the top-right corner in
    expect(validatePolygon(h.room().vertices)).toEqual({ ok: true });
    // corners (0,0) (4,0) (2,2.5) (2,5) (0,5): shoelace = (0 + 10 + 5 + 10 + 0) / 2 = 12.5 m²
    expect(area(h.state())).toBeCloseTo(12.5, 6);
    expect(h.room().walls).toHaveLength(5);
  });
});

describe('B7: Escape and tool switches in the wall tool', () => {
  it('Escape during MOVING_VERTEX reverts: no history, the room is back, previews cleared', () => {
    const h = wallHarness();
    const before = h.state();
    h.it.pointerDown(h.ptr(4, 5));
    h.it.pointerMove(h.ptr(3.2, 4.1));
    expect(h.it.stateName).toBe('moving_vertex');
    h.key('Escape');
    expect(h.it.stateName).toBe('idle');
    expect(h.bus.get().roomPreview).toBeNull();
    expect(h.bus.get().hiddenIds).toEqual([]);
    expect(h.pushes).toHaveLength(0);
    expectProjectEqual(h.state(), before);
    expect(h.ui.getState().tool).toBe('wall_edit');
  });
  it('Escape with a corner or wall selected deselects it and stays in the tool', () => {
    const h = wallHarness();
    h.drag([4, 5], [4, 5], 0);
    h.key('Escape');
    expect(h.ui.getState().selection).toEqual([]);
    expect(h.ui.getState().tool).toBe('wall_edit');
  });
  it('switching tools mid-drag cancels the drag first', () => {
    const h = wallHarness();
    h.it.pointerDown(h.ptr(4, 5));
    h.it.pointerMove(h.ptr(3.2, 4.1));
    h.key('1');
    expect(h.ui.getState().tool).toBe('select');
    expect(h.it.stateName).toBe('idle');
    expect(h.pushes).toHaveLength(0);
    expect(h.bus.get().roomPreview).toBeNull();
  });
});

describe('draw a room (B8, C14)', () => {
  const click = (h: ReturnType<typeof makeHarness>, x: number, y: number) => { h.it.pointerDown(h.ptr(x, y)); h.it.pointerUp(h.ptr(x, y)); };

  it('click corners, Enter closes: one CreateRoom, the app is told to fit the view, the tool returns to Select', () => {
    const h = wallHarness({ noRoom: true });
    for (const [x, y] of [[0, 0], [4, 0], [4, 3], [0, 3]]) click(h, x, y);
    expect(h.it.stateName).toBe('drawing_room');
    expect(h.bus.get().drawing!.points).toHaveLength(4);
    h.key('Enter');
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0]).toMatchObject({ label: 'Draw room', command: { type: 'CreateRoom' } });
    expect(h.state().rooms).toHaveLength(1);
    expect(h.room().vertices.map((v) => v.position)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    expect(h.room().walls.map((w) => w.thickness)).toEqual([0.15, 0.15, 0.15, 0.15]);
    expect(h.created.n).toBe(1);
    expect(h.ui.getState().tool).toBe('select');
    expect(h.bus.get().drawing).toBeNull();
  });
  it('clicking the first corner closes as well', () => {
    const h = wallHarness({ noRoom: true });
    for (const [x, y] of [[0, 0], [4, 0], [4, 3]]) click(h, x, y);
    h.it.pointerMove(h.ptr(0.05, 0.04));
    expect(h.bus.get().drawing).toMatchObject({ nearFirst: true, closable: true });
    click(h, 0.05, 0.04);
    expect(h.state().rooms).toHaveLength(1);
    expect(h.room().vertices).toHaveLength(3);
  });
  it('a clockwise drawing becomes counter-clockwise with every wall facing the right way (interior normal points into the room)', () => {
    const h = wallHarness({ noRoom: true });
    for (const [x, y] of [[0, 0], [0, 3], [4, 3], [4, 0]]) click(h, x, y);
    h.key('Enter');
    const room = h.room();
    for (const w of room.walls) {
      const g = wallGeometry(room, w.id)!;
      const mid = { x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 };
      const inside = { x: mid.x + g.normal.x * 0.1, y: mid.y + g.normal.y * 0.1 };
      expect(inside.x > 0 && inside.x < 4 && inside.y > 0 && inside.y < 3).toBe(true);
    }
  });
  it('corners snap to the grid', () => {
    const h = wallHarness({ noRoom: true });
    click(h, 0.04, 0.03);
    expect(h.bus.get().drawing!.points[0]).toEqual({ x: 0, y: 0 });
  });
  it('an invalid shape cannot be closed: a plain message, nothing committed, the corners stay so it can be fixed with Backspace', () => {
    const h = wallHarness({ noRoom: true });
    for (const [x, y] of [[0, 0], [4, 3], [4, 0], [0, 3]]) click(h, x, y); // a bow-tie
    h.it.pointerMove(h.ptr(1, 1));
    h.key('Enter');
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().status?.text).toBe('The walls would cross each other');
    expect(h.bus.get().drawing!.points).toHaveLength(4);
    h.key('Backspace'); // triangle (0,0) (4,3) (4,0)
    h.key('Enter');
    expect(h.pushes).toHaveLength(1);
    expect(h.room().vertices).toHaveLength(3);
  });
  it('the offending edges are orange while drawing', () => {
    const h = wallHarness({ noRoom: true });
    for (const [x, y] of [[0, 0], [4, 3], [4, 0]]) click(h, x, y);
    h.it.pointerMove(h.ptr(0, 3));
    expect(h.bus.get().drawing!.badEdges.length).toBeGreaterThan(0);
    h.it.pointerMove(h.ptr(2, -1));
    expect(h.bus.get().drawing!.badEdges).toEqual([]);
  });
  it('fewer than three corners cannot close', () => {
    const h = wallHarness({ noRoom: true });
    click(h, 0, 0); click(h, 4, 0);
    h.key('Enter');
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().status?.text).toBe('A room needs at least three corners');
  });
  it('Escape abandons the drawing and stays in the wall tool; so does switching tools', () => {
    const h = wallHarness({ noRoom: true });
    click(h, 0, 0); click(h, 4, 0);
    h.key('Escape');
    expect(h.bus.get().drawing).toBeNull();
    expect(h.ui.getState().tool).toBe('wall_edit');
    click(h, 0, 0);
    h.key('1');
    expect(h.bus.get().drawing).toBeNull();
    expect(h.ui.getState().tool).toBe('select');
    expect(h.pushes).toHaveLength(0);
  });
  it('a double click does not add the same corner twice; Backspace removes the last corner', () => {
    const h = wallHarness({ noRoom: true });
    click(h, 0, 0); click(h, 0, 0);
    expect(h.bus.get().drawing!.points).toHaveLength(1);
    click(h, 4, 0);
    h.key('Backspace');
    expect(h.bus.get().drawing!.points).toHaveLength(1);
  });
  it('an L-shaped room (six corners) is accepted; undo returns to the empty project', () => {
    const h = wallHarness({ noRoom: true });
    for (const [x, y] of [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]]) click(h, x, y);
    h.key('Enter');
    expect(h.room().vertices).toHaveLength(6);
    h.key('z', { ctrl: true });
    expect(h.state().rooms).toHaveLength(0);
  });
});

describe('escape rule on real interaction commands (Test Plan M3)', () => {
  /** Shrink the room from the top by pulling both top corners down: the sofa is left outside (A3), then it is dragged back. */
  function invalidated() {
    const h = wallHarness({ furniture: [sofa()] });
    h.drag([4, 5], [4, 4.2]);
    h.drag([0, 5], [0, 4.2]);
    h.key('1');
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    return h;
  }
  it('the edit committed even though the sofa is now invalid', () => {
    const h = invalidated();
    expect(h.pushes.map((p) => p.label)).toEqual(['Move corner', 'Move corner']);
    expect(deriveStatus(h.state()).get('a')).toBe('hard');
  });
  it('a move that makes it worse is rejected; one that shrinks the violation commits; one into a valid spot commits', () => {
    const h = invalidated();
    const n = h.pushes.length;
    h.drag([2, 4.5], [2, 4.8]);
    expect(h.pushes).toHaveLength(n); // worse: rejected, slides back
    h.drag([2, 4.5], [2, 4.2]);
    expect(h.pushes).toHaveLength(n + 1); // less outside
    const y = h.inst('a').position.y;
    h.drag([2, y], [2, 3]);
    expect(h.pushes).toHaveLength(n + 2);
    expect(validateRoom(h.room(), h.state().furnitureDefinitions).valid).toBe(true);
  });
  it('Fix position takes it to the nearest valid spot in one command', () => {
    const h = invalidated();
    const r = proposeFixPosition(h.state(), 'a');
    expect(r.rejected).toBe(false);
    if (!r.rejected) {
      h.project.getState().commitResult(r, 'Fix position');
      expect(validateRoom(h.room(), h.state().furnitureDefinitions).valid).toBe(true);
    }
  });
});
