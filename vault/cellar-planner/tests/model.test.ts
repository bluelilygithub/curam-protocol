import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, ApplyError, inverse, setBay, setWall, type Command } from '../src/domain/commands';
import { cornerCommands, withCorners } from '../src/domain/corners';
import { fillWall, newCellarProject, rectangularRoom, type BayTemplate } from '../src/domain/projectFactory';
import { analyseProject, goldenCase01, type CabinetBay, type CellarProject } from '../src/engine';
import { createProjectStore } from '../src/state/projectStore';

const template: BayTemplate = {
  outerDepthMm: 360, outerHeightMm: 2200,
  modules: [{ id: 'x', storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX' }, { id: 'y', storageStyle: 'LABEL_FORWARD', bottleProfile: 'BORDEAUX', heightMm: 400 }],
};
const room = () => newCellarProject('Test', 'p1', rectangularRoom(4000, 3000, 2400));
const bay = (id: string, x = 50): CabinetBay => ({ id, xMm: x, widthMm: 800, outerDepthMm: 350, outerHeightMm: 2200, modules: [{ id: `${id}-m`, storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX' }] });

describe('commands', () => {
  it('add, replace and remove a bay; each is undone by its inverse', () => {
    const p0 = room();
    const add = setBay('wall-north', 'b1', null, bay('b1'));
    const p1 = apply(add, p0);
    expect(p1.room.walls[0].bays).toHaveLength(1);
    const wider = setBay('wall-north', 'b1', bay('b1'), { ...bay('b1'), widthMm: 900 });
    const p2 = apply(wider, p1);
    expect(p2.room.walls[0].bays[0].widthMm).toBe(900);
    const del = setBay('wall-north', 'b1', p2.room.walls[0].bays[0], null);
    const p3 = apply(del, p2);
    expect(p3.room.walls[0].bays).toHaveLength(0);
    expect(apply(inverse(del), p3)).toEqual(p2);
    expect(apply(inverse(wider), p2)).toEqual(p1);
    expect(apply(inverse(add), p1)).toEqual(p0);
  });
  it('never mutates its input', () => {
    const p = room();
    const frozen = structuredClone(p);
    apply(setBay('wall-north', 'b1', null, bay('b1')), p);
    expect(p).toEqual(frozen);
  });
  it('stale commands fail with a code and change nothing', () => {
    const p = room();
    expect(() => apply(setBay('nope', 'b1', null, bay('b1')), p)).toThrow(ApplyError);
    expect(() => apply(setBay('wall-north', 'ghost', bay('ghost'), null), p)).toThrow(/ID_NOT_FOUND/);
    const p1 = apply(setBay('wall-north', 'b1', null, bay('b1')), p);
    expect(() => apply(setBay('wall-north', 'b1', null, bay('b1')), p1)).toThrow(/ID_EXISTS/);
  });
  it('walls, rules, room and name changes invert too', () => {
    const p = room();
    const cmds: Command[] = [
      setWall('wall-extra', null, { id: 'wall-extra', start: [0, 0], end: [500, 0], startTermination: 'ROOM_WALL', endTermination: 'ROOM_WALL', bays: [] }),
      { type: 'SetRules', from: { boardMm: 16 }, to: { boardMm: 18 } },
      { type: 'SetRoom', from: { heightMm: 2400 }, to: { heightMm: 2700 } },
      { type: 'SetMeta', from: { name: 'Test' }, to: { name: 'Renamed' } },
    ];
    let q = p;
    for (const c of cmds) q = apply(c, q);
    expect(q.room.walls).toHaveLength(5);
    expect(q.rules.boardMm).toBe(18);
    expect(q.room.heightMm).toBe(2700);
    expect(q.name).toBe('Renamed');
    for (const c of [...cmds].reverse()) q = apply(inverse(c), q);
    expect(q).toEqual(p);
  });
  it('a composite undoes in reverse', () => {
    const p = room();
    const c: Command = { type: 'Composite', commands: [setBay('wall-north', 'b1', null, bay('b1')), setBay('wall-north', 'b1', bay('b1'), { ...bay('b1'), widthMm: 700 })] };
    expect(apply(inverse(c), apply(c, p))).toEqual(p);
  });
  it('property: any sequence of adds undoes back to the start', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
      const p0 = room();
      const cmds = Array.from({ length: n }, (_, i) => setBay('wall-north', `b${i}`, null, bay(`b${i}`, 50 + i * 10)));
      const done = cmds.reduce((acc, c) => apply(c, acc), p0);
      const back = [...cmds].reverse().reduce((acc, c) => apply(inverse(c), acc), done);
      return JSON.stringify(back) === JSON.stringify(p0) && done.room.walls[0].bays.length === n;
    }));
  });
});

describe('the room and filling a wall', () => {
  it('a rectangular room is four clockwise walls that meet', () => {
    const r = rectangularRoom(4000, 3000, 2400);
    expect(r.walls.map((w) => w.id)).toEqual(['wall-north', 'wall-east', 'wall-south', 'wall-west']);
    expect(r.walls[0].end).toEqual(r.walls[1].start);
    expect(r.walls[3].end).toEqual(r.walls[0].start);
  });
  it('splits a wall into equal whole-millimetre bays with the remainder in the scribes (the golden wall)', () => {
    const p = newCellarProject('G', 'g', rectangularRoom(2450, 2000, 2400));
    const bays = fillWall(p, 'wall-north', 3, template);
    expect(bays.map((b) => [b.xMm, b.widthMm])).toEqual([[50, 783], [833, 783], [1616, 783]]);
    expect(bays[0].modules.map((m) => m.id)).toEqual(['wall-north-bay-1-m0', 'wall-north-bay-1-m1']);
    // identical to the engine's own golden project
    const golden = goldenCase01().room.walls[0].bays;
    expect(bays.map((b) => [b.xMm, b.widthMm, b.outerDepthMm])).toEqual(golden.map((b) => [b.xMm, b.widthMm, b.outerDepthMm]));
  });
  it('a filled project analyses with no errors', () => {
    const p = newCellarProject('G', 'g', rectangularRoom(2450, 2000, 2400));
    const filled = apply(setBay('wall-north', 'x', null, { ...fillWall(p, 'wall-north', 1, template)[0], id: 'x' }), p);
    expect(analyseProject(filled).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('corners are worked out when cabinets arrive', () => {
  const fill = (p: CellarProject, wallId: string, n: number): CellarProject => {
    let q = p;
    for (const b of fillWall(q, wallId, n, template)) q = apply(withCorners(q, setBay(wallId, b.id, null, b)), q);
    return q;
  };
  it('one wall of cabinets: every end stays a room wall', () => {
    expect(cornerCommands(fill(room(), 'wall-north', 3))).toEqual([]);
  });
  it('two walls: the longer owns the corner, the shorter yields, and the shorter starts after the owner\'s depth plus 20 mm', () => {
    let p = fill(room(), 'wall-north', 4); // 4000 mm, longer
    p = fill(p, 'wall-east', 2); // 3000 mm
    const north = p.room.walls[0], east = p.room.walls[1];
    expect(north.endTermination).toBe('CORNER_OWNS');
    expect(east.startTermination).toBe('CORNER_YIELDS');
    expect(east.bays[0].xMm).toBe(360 + 20);
    expect(analyseProject(p).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('adding the second wall of cabinets and the corner change are ONE undo step', () => {
    const store = createProjectStore(fill(room(), 'wall-north', 4));
    const b = fillWall(store.getState().project!, 'wall-east', 1, template)[0];
    store.getState().commit(withCorners(store.getState().project!, setBay('wall-east', b.id, null, b)), 'Add bay');
    expect(store.getState().project!.room.walls[0].endTermination).toBe('CORNER_OWNS');
    store.getState().undo();
    const after = store.getState().project!;
    expect(after.room.walls[0].endTermination).toBe('ROOM_WALL');
    expect(after.room.walls[1].bays).toHaveLength(0);
  });
  it('MANUAL mode leaves terminations alone', () => {
    const p: CellarProject = { ...fill(fill(room(), 'wall-north', 4), 'wall-east', 2), cornerOwnershipMode: 'MANUAL' };
    expect(cornerCommands(p)).toEqual([]);
  });
});

describe('the project store', () => {
  it('commit, undo, redo and labels', () => {
    const store = createProjectStore(room());
    const s = () => store.getState();
    expect(s().canUndo).toBe(false);
    expect(s().commit(setBay('wall-north', 'b1', null, bay('b1')), 'Add bay')).toBe(true);
    expect(s().canUndo).toBe(true);
    expect(s().undoLabel).toBe('Add bay');
    expect(s().undo()).toBe('Add bay');
    expect(s().project!.room.walls[0].bays).toHaveLength(0);
    expect(s().canRedo).toBe(true);
    expect(s().redo()).toBe('Add bay');
    expect(s().project!.room.walls[0].bays).toHaveLength(1);
  });
  it('a stale command changes nothing and is not recorded', () => {
    const store = createProjectStore(room());
    const rev = store.getState().revision;
    expect(store.getState().commit(setBay('wall-north', 'ghost', bay('ghost'), null), 'Remove')).toBe(false);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().revision).toBe(rev);
  });
  it('loading starts a fresh history; every change bumps the revision; a new commit clears redo', () => {
    const store = createProjectStore(room());
    store.getState().commit(setBay('wall-north', 'b1', null, bay('b1')), 'Add');
    store.getState().undo();
    store.getState().commit(setBay('wall-north', 'b2', null, bay('b2')), 'Add 2');
    expect(store.getState().canRedo).toBe(false);
    const rev = store.getState().revision;
    store.getState().load(room());
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().revision).toBe(rev + 1);
  });
});
