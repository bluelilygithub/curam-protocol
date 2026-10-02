import { describe, expect, it } from 'vitest';
import { apply, findNearestValidPosition, validateRoom } from '../../src/engine';
import { makeDoor, makeInstance, makeProject, makeRoom } from '../helpers';

const box = (id: string, x: number, y: number, w = 1, l = 1, over = {}) =>
  makeInstance({ id, position: { x, y }, width: w, length: l, ...over });
const near = (p: { x: number; y: number } | null, x: number, y: number, tol = 0.001) => {
  expect(p).not.toBeNull();
  expect(Math.abs(p!.x - x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(p!.y - y)).toBeLessThanOrEqual(tol);
};

describe('findNearestValidPosition (C10)', () => {
  it('already valid: returns the current position', () => {
    near(findNearestValidPosition(makeProject([makeRoom({ furniture: [box('a', 2, 2)] })]), 'a'), 2, 2, 0);
  });
  it('pokes 0.6 m through the right wall: nearest is flush with the wall (translation only)', () => {
    // 2 wide at x=3.6 spans 2.6..4.6; wall at x=4 -> shift left 0.6 to x=3.0
    near(findNearestValidPosition(makeProject([makeRoom({ furniture: [box('a', 3.6, 2.5, 2, 1)] })]), 'a'), 3.0, 2.5);
  });
  it('overlapping an obstacle: nearest is the smallest clearing shift, within 1 mm of the true optimum', () => {
    // 0.5 square at (2.3, 2.5) overlaps a 1 m square at (2, 2.5) (x 1.5..2.5). Right edge shift: centre x = 2.75 (0.45 away)
    const p = makeProject([makeRoom({ furniture: [box('o', 2, 2.5), box('a', 2.3, 2.5, 0.5, 0.5)] })]);
    near(findNearestValidPosition(p, 'a'), 2.75, 2.5);
  });
  it('refines past the 50 mm coarse grid to millimetre accuracy', () => {
    // obstacle 1.013 wide at x=1.0 -> right edge 1.5065. A 0.5 square at x=1.6 overlaps it.
    // Exact nearest centre x = 1.5065 + 0.25 = 1.7565; on the 1 mm grid, 1.756 still penetrates by 0.5 mm, so 1.757.
    // (the 5 mm coarse grid anchored at 1.6 only offers 1.755 or 1.760)
    const p = makeProject([makeRoom({ furniture: [box('o', 1.0, 2.5, 1.013, 1), box('a', 1.6, 2.5, 0.5, 0.5)] })]);
    near(findNearestValidPosition(p, 'a'), 1.757, 2.5, 0.0005);
  });
  it('four equally near choices: tie-break picks the smallest angle counter-clockwise from +X (to the right)', () => {
    // 0.5 square dead-centre on a 1 m obstacle: every axis move needs 0.75 -> +x (angle 0) wins
    const p = makeProject([makeRoom({ furniture: [box('o', 2, 2.5), box('a', 2, 2.5, 0.5, 0.5)] })]);
    near(findNearestValidPosition(p, 'a'), 2.75, 2.5);
  });
  it('rotation and size are never changed and the result really is valid', () => {
    const p = makeProject([makeRoom({ furniture: [box('o', 2, 2.5), box('a', 2.2, 2.9, 0.8, 0.5, { rotation: Math.PI / 6 })] })]);
    const to = findNearestValidPosition(p, 'a')!;
    const moved = apply({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2.2, y: 2.9 }, to }, p);
    expect(validateRoom(moved.rooms[0], []).valid).toBe(true);
    expect(moved.rooms[0].furniture.find((f) => f.id === 'a')).toMatchObject({ width: 0.8, length: 0.5, rotation: Math.PI / 6 });
  });
  it('avoids a door swing', () => {
    const door = makeDoor({ id: 'd' }); // hinge (2.45,0), sweep covers x 1.55..2.45, y 0..0.9
    const p = makeProject([makeRoom({ fixtures: [door], furniture: [box('a', 2, 0.5, 0.3, 0.3)] })]);
    const to = findNearestValidPosition(p, 'a')!;
    const moved = apply({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 0.5 }, to }, p);
    expect(validateRoom(moved.rooms[0], []).valid).toBe(true);
  });
  it('no valid position anywhere in the room -> null', () => {
    expect(findNearestValidPosition(makeProject([makeRoom({ furniture: [box('a', 2, 2, 10, 10)] })]), 'a')).toBeNull();
  });
  it('unknown id -> null', () => {
    expect(findNearestValidPosition(makeProject([makeRoom()]), 'ghost')).toBeNull();
  });
  it('is deterministic', () => {
    const p = makeProject([makeRoom({ furniture: [box('o', 2, 2.5), box('a', 2.1, 2.6, 0.5, 0.5)] })]);
    expect(findNearestValidPosition(p, 'a')).toEqual(findNearestValidPosition(p, 'a'));
  });
});
