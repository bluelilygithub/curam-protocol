import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES as R, analyseProject, cornerOwner, deadCorner, goldenCase01, runExtent, scribeFor, splitRun, wallLengthMm,
  type CabinetBay, type CellarProject, type Wall,
} from '../src/engine';

describe('runs and scribes', () => {
  it('a run between two room walls loses a 50 mm scribe at each end', () => {
    expect(scribeFor('ROOM_WALL', R)).toBe(50);
    expect(scribeFor('CORNER_OWNS', R)).toBe(50); // the owner runs up to the other wall's surface
    expect(scribeFor('CORNER_YIELDS', R)).toBe(0); // it meets cabinets, not a wall
    expect(runExtent(2450, 'ROOM_WALL', 'ROOM_WALL', 0, 0, R)).toEqual({ startOffsetMm: 50, endOffsetMm: 50, usableMm: 2350 });
  });
  it('a yielding end starts after the owner\'s depth plus 20 mm, with no scribe', () => {
    expect(runExtent(3000, 'CORNER_YIELDS', 'ROOM_WALL', 350, 0, R)).toEqual({ startOffsetMm: 370, endOffsetMm: 50, usableMm: 2580 });
    expect(runExtent(3000, 'CORNER_YIELDS', 'CORNER_YIELDS', 350, 400, R).usableMm).toBe(3000 - 370 - 420);
  });
  it('wall length comes from its end points', () => {
    expect(wallLengthMm({ start: [0, 0], end: [2450, 0] })).toBe(2450);
    expect(wallLengthMm({ start: [0, 0], end: [3000, 4000] })).toBe(5000);
  });
});

describe('splitting a run into equal bays', () => {
  it('2350 mm into 3: 783 mm bays and 1 mm for the scribes', () => {
    expect(splitRun(2350, 3)).toEqual({ bayWidthMm: 783, remainderMm: 1, startExtraMm: 0, endExtraMm: 1 });
  });
  it('an exact split leaves no remainder; an odd remainder gives the extra millimetre to the end', () => {
    expect(splitRun(2400, 3).remainderMm).toBe(0);
    expect(splitRun(2402, 3)).toMatchObject({ bayWidthMm: 800, remainderMm: 2, startExtraMm: 1, endExtraMm: 1 });
  });
  it('rejects zero or fractional bay counts', () => {
    expect(() => splitRun(2000, 0)).toThrow();
    expect(() => splitRun(2000, 2.5)).toThrow();
  });
  it('property: whole millimetres, nothing lost, nothing invented', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 20000 }), fc.integer({ min: 1, max: 30 }), (usable, n) => {
      const s = splitRun(usable, n);
      return Number.isInteger(s.bayWidthMm) && s.bayWidthMm * n + s.remainderMm === usable && s.remainderMm < n && s.startExtraMm + s.endExtraMm === s.remainderMm && s.startExtraMm <= s.endExtraMm;
    }));
  });
});

describe('corners', () => {
  it('the longer wall owns the corner; a tie goes to the first wall; MANUAL overrides', () => {
    expect(cornerOwner({ id: 'a', lengthMm: 4000 }, { id: 'b', lengthMm: 3000 }, 'LONGEST_WALL_FIRST')).toBe('A');
    expect(cornerOwner({ id: 'a', lengthMm: 3000 }, { id: 'b', lengthMm: 4000 }, 'LONGEST_WALL_FIRST')).toBe('B');
    expect(cornerOwner({ id: 'a', lengthMm: 3000 }, { id: 'b', lengthMm: 3000 }, 'LONGEST_WALL_FIRST')).toBe('A');
    expect(cornerOwner({ id: 'a', lengthMm: 4000 }, { id: 'b', lengthMm: 3000 }, 'MANUAL', 'b')).toBe('B');
  });
  it('dead corner: the yielding run loses owner depth + 20 mm; its lost capacity is what a bay that wide would hold', () => {
    const template = goldenCase01().room.walls[0].bays[0];
    const d = deadCorner(350, 350, template, R);
    expect(d.widthMm).toBe(370);
    expect(d.areaMm2).toBe(370 * 350);
    // 370 wide: 338 inside -> 3 slots; base 14 rows + display 2 tiers = 16 rows * 3
    expect(d.lostCapacity).toBe(48);
  });
  it('a corner strip too narrow to hold a bottle costs nothing', () => {
    const template = goldenCase01().room.walls[0].bays[0];
    expect(deadCorner(10, 350, template, { ...R, cornerClearanceMm: 0 }, ).lostCapacity).toBe(0);
  });
});

const bayOf = (id: string, depth: number, x = 0, w = 800): CabinetBay => ({ id, xMm: x, widthMm: w, outerDepthMm: depth, outerHeightMm: 2200, modules: [{ id: `${id}-m0`, storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX' }] });

describe('an L-shaped room', () => {
  const project = (aEnd: Wall['endTermination'], bStart: Wall['startTermination']): CellarProject => ({
    ...goldenCase01(),
    room: { heightMm: 2400, doors: [], windows: [], obstructions: [], walls: [
      { id: 'A', start: [0, 0], end: [4000, 0], startTermination: 'ROOM_WALL', endTermination: aEnd, bays: [bayOf('a1', 350, 50)] },
      { id: 'B', start: [4000, 0], end: [4000, 3000], startTermination: bStart, endTermination: 'ROOM_WALL', bays: [bayOf('b1', 350, 370)] },
    ] },
  });
  it('A owns, B yields: B starts at 370 mm, with a dead-corner note and no errors', () => {
    const a = analyseProject(project('CORNER_OWNS', 'CORNER_YIELDS'));
    expect(a.walls[1]).toMatchObject({ startOffsetMm: 370, endOffsetMm: 50, usableMm: 2580 });
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(a.issues.find((i) => i.code === 'DEAD_CORNER')).toMatchObject({ severity: 'info', where: 'B' });
  });
  it('both owning, or neither, is an error', () => {
    expect(analyseProject(project('CORNER_OWNS', 'CORNER_OWNS')).issues.map((i) => i.code)).toContain('CORNER_BOTH_OWN');
    expect(analyseProject(project('CORNER_YIELDS', 'CORNER_YIELDS')).issues.map((i) => i.code)).toContain('CORNER_NO_OWNER');
  });
  it('a bay placed inside the yielded corner is a run overflow', () => {
    const p = project('CORNER_OWNS', 'CORNER_YIELDS');
    p.room.walls[1].bays[0].xMm = 200;
    expect(analyseProject(p).issues.map((i) => i.code)).toContain('RUN_OVERFLOW');
  });
});
