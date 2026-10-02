import { describe, expect, it } from 'vitest';
import { primaryViolation, validateFixture, validateInstance, validateRoom, violationsFor } from '../../src/engine';
import type { FurnitureDefinition } from '../../src/engine';
import { expectViolations, makeDoor, makeInstance, makeRoom } from '../helpers';

const sofaDef: FurnitureDefinition = {
  id: 'sofa', name: 'sofa', category: 'seating', defaultWidth: 2, defaultLength: 0.9, defaultHeight: 0.85,
  clearancePolicies: [{ side: 'front', offset: 0.5, severity: 'soft' }],
};
const hardDef: FurnitureDefinition = { ...sofaDef, id: 'hard-sofa', clearancePolicies: [{ side: 'front', offset: 0.5, severity: 'hard' }] };
const box = (id: string, x: number, y: number, over = {}) => makeInstance({ id, position: { x, y }, width: 1, length: 1, ...over });

describe('validateRoom', () => {
  it('an empty room is valid', () => {
    expect(validateRoom(makeRoom(), [])).toEqual({ valid: true, violations: [] });
  });
  it('outside_room, with involved wall ids', () => {
    const r = validateRoom(makeRoom({ furniture: [box('a', 0.2, 2.5)] }), []);
    expect(r.valid).toBe(false);
    expectViolations(r.violations, [{ type: 'outside_room', severity: 'hard', objects: ['a'] }]);
    expect(r.violations[0].involvedWallIds).toEqual(['w4']);
  });
  it('physical_collision needs footprint AND vertical overlap', () => {
    const overlap = validateRoom(makeRoom({ furniture: [box('a', 2, 2), box('b', 2.5, 2)] }), []);
    expectViolations(overlap.violations, [{ type: 'physical_collision', severity: 'hard', objects: ['a', 'b'] }]);
    const stacked = validateRoom(makeRoom({ furniture: [box('a', 2, 2), box('b', 2.5, 2, { elevation: 1 })] }), []);
    expect(stacked.valid).toBe(true);
  });
  it('touching objects are valid', () => {
    expect(validateRoom(makeRoom({ furniture: [box('a', 1, 2), box('b', 2, 2)] }), []).valid).toBe(true);
  });
  it('each pair is reported once, not once per object', () => {
    const r = validateRoom(makeRoom({ furniture: [box('a', 2, 2), box('b', 2.5, 2)] }), []);
    expect(r.violations.filter((v) => v.type === 'physical_collision')).toHaveLength(1);
  });
  it('soft clearance violation does not make the room invalid', () => {
    const sofa = makeInstance({ id: 's', definitionId: 'sofa', position: { x: 2, y: 1 }, width: 2, length: 0.9, height: 0.85 });
    const room = makeRoom({ furniture: [sofa, box('chair', 2, 1.8, { width: 0.4, length: 0.4 })] });
    const r = validateRoom(room, [sofaDef]);
    expect(r.valid).toBe(true);
    expectViolations(r.violations, [{ type: 'clearance', severity: 'soft', objects: ['s', 'chair'] }]);
  });
  it('hard clearance violation makes the room invalid', () => {
    const sofa = makeInstance({ id: 's', definitionId: 'hard-sofa', position: { x: 2, y: 1 }, width: 2, length: 0.9, height: 0.85 });
    const room = makeRoom({ furniture: [sofa, box('chair', 2, 1.8, { width: 0.4, length: 0.4 })] });
    const r = validateRoom(room, [hardDef]);
    expect(r.valid).toBe(false);
  });
  it('a clearance zone crossing the room boundary is exempt', () => {
    const sofa = makeInstance({ id: 's', definitionId: 'hard-sofa', position: { x: 2, y: 4.4 }, width: 2, length: 0.9, height: 0.85 });
    expect(validateRoom(makeRoom({ furniture: [sofa] }), [hardDef]).violations).toEqual([]);
  });
  it('clearance zone vs another clearance zone is not a violation', () => {
    const a = makeInstance({ id: 'a', definitionId: 'hard-sofa', position: { x: 2, y: 1 }, width: 2, length: 0.9, height: 0.85 });
    const b = makeInstance({ id: 'b', definitionId: 'hard-sofa', position: { x: 2, y: 2.95 }, rotation: Math.PI, width: 2, length: 0.9, height: 0.85 });
    // a's zone spans y 1.45..1.95, b's zone y 1.95..2.5 -> zones are adjacent; shift b closer so zones overlap but footprints stay clear
    const closer = { ...b, position: { x: 2, y: 2.45 } };
    expect(validateRoom(makeRoom({ furniture: [a, closer] }), [hardDef]).violations).toEqual([]);
  });
  it('clearance zone hitting a door swing sector is reported with the fixture', () => {
    const sofa = makeInstance({ id: 's', definitionId: 'sofa', position: { x: 2, y: 1.3 }, rotation: Math.PI, width: 0.6, length: 0.4, height: 0.85 });
    // sofa front faces -y toward the wall; its soft zone (0.5) reaches the door leaf sweep on w1
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd' })], furniture: [sofa] });
    const r = validateRoom(room, [sofaDef]);
    expect(r.violations.some((v) => v.type === 'clearance' && v.involvedFixtureIds?.includes('d'))).toBe(true);
  });
  it('door swing blocked -> hard, naming object and fixture', () => {
    const r = validateRoom(makeRoom({ fixtures: [makeDoor({ id: 'd' })], furniture: [box('c', 2, 0.5, { width: 0.3, length: 0.3 })] }), []);
    expectViolations(r.violations, [{ type: 'door_swing', severity: 'hard', objects: ['c'], fixtures: ['d'] }]);
  });
  it('fixture_out_of_wall appears in a full pass', () => {
    const r = validateRoom(makeRoom({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 9 })] }), []);
    expectViolations(r.violations, [{ type: 'fixture_out_of_wall', severity: 'hard', fixtures: ['d'] }]);
  });
  it('violations are ordered by feedback priority: outside → door swing → access → collision → clearance', () => {
    const room = makeRoom({
      fixtures: [makeDoor({ id: 'd' })],
      furniture: [box('out', 0.2, 3), box('blk', 2, 0.5, { width: 0.3, length: 0.3 }), box('p', 3, 3), box('q', 3.4, 3)],
    });
    const types = validateRoom(room, []).violations.map((v) => v.type);
    const order = ['outside_room', 'door_swing', 'fixture_access', 'physical_collision', 'clearance'];
    const idx = types.map((t) => order.indexOf(t));
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
  });
  it('is deterministic', () => {
    const room = makeRoom({ furniture: [box('a', 2, 2), box('b', 2.4, 2), box('c', 0.1, 2)] });
    expect(validateRoom(room, [])).toEqual(validateRoom(room, []));
  });
});

describe('validateInstance / validateFixture', () => {
  it('works for a candidate that is not yet in the room', () => {
    const room = makeRoom({ furniture: [box('a', 2, 2)] });
    const v = validateInstance(room, [], box('new', 2.5, 2));
    expectViolations(v, [{ type: 'physical_collision', severity: 'hard', objects: ['new', 'a'] }]);
  });
  it('ignores the stale copy of itself', () => {
    const room = makeRoom({ furniture: [box('a', 2, 2)] });
    expect(validateInstance(room, [], box('a', 2, 2))).toEqual([]);
  });
  it('validateFixture reports furniture blocking a candidate door', () => {
    const room = makeRoom({ furniture: [box('c', 2, 0.5, { width: 0.3, length: 0.3 })] });
    const v = validateFixture(room, makeDoor({ id: 'd' }));
    expectViolations(v, [{ type: 'door_swing', severity: 'hard', objects: ['c'], fixtures: ['d'] }]);
  });
});

describe('primaryViolation / violationsFor (B5)', () => {
  it('status bar shows the highest priority hard violation', () => {
    const room = makeRoom({ furniture: [box('out', 0.2, 3), box('p', 3, 3), box('q', 3.4, 3)] });
    const r = validateRoom(room, []);
    expect(primaryViolation(r)?.type).toBe('outside_room');
  });
  it('hard is preferred over soft even when the soft one has higher priority order', () => {
    const sofa = makeInstance({ id: 's', definitionId: 'sofa', position: { x: 2, y: 1 }, width: 2, length: 0.9, height: 0.85 });
    const room = makeRoom({ furniture: [sofa, box('chair', 2, 1.8, { width: 0.4, length: 0.4 }), box('x', 3.6, 4.6), box('y', 3.9, 4.6)] });
    expect(primaryViolation(validateRoom(room, [sofaDef]))?.severity).toBe('hard');
  });
  it('undefined when there are none', () => {
    expect(primaryViolation(validateRoom(makeRoom(), []))).toBeUndefined();
  });
  it('violationsFor filters to one object', () => {
    const room = makeRoom({ furniture: [box('a', 2, 2), box('b', 2.4, 2), box('c', 3.4, 4.4)] });
    const r = validateRoom(room, []);
    expect(violationsFor(r, 'c')).toEqual([]);
    expect(violationsFor(r, 'a')).toHaveLength(1);
  });
});
