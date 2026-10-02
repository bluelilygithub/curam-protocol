import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAP_DISTANCE, generateSnapCandidates, rankSnapCandidates, SNAP_PRIORITY,
} from '../../src/engine';
import type { SnapCandidate } from '../../src/engine';
import { makeInstance, makeRoom } from '../helpers';

const room = makeRoom(); // 4 x 5
const moving = (x: number, y: number, w = 1, l = 1) => ({ position: { x, y }, width: w, length: l, rotation: 0 });
const gen = (x: number, y: number, extra = {}) =>
  generateSnapCandidates({ moving: moving(x, y), room, others: [], ...extra });
const cand = (targetType: SnapCandidate['targetType'], x: number, y: number, distance: number, reason = ''): SnapCandidate => ({
  targetType, position: { x, y }, distance, priority: SNAP_PRIORITY[targetType], reason,
});

describe('priority table (Phase 1 §8)', () => {
  it('matches the contract', () => {
    expect(SNAP_PRIORITY).toEqual({
      wall_endpoint: 100, wall: 80, furniture_edge: 60, furniture_centre: 50, alignment: 40, grid: 20,
    });
  });
  it('default snap distance is 0.25 m', () => {
    expect(DEFAULT_SNAP_DISTANCE).toBe(0.25);
  });
});

describe('candidate generation', () => {
  it('grid: rounds the centre to the grid', () => {
    const g = gen(2.04, 2.46).filter((c) => c.targetType === 'grid');
    expect(g).toHaveLength(1);
    expect(g[0].position.x).toBeCloseTo(2.0, 9);
    expect(g[0].position.y).toBeCloseTo(2.5, 9);
    expect(g[0].distance).toBeCloseTo(Math.hypot(0.04, 0.04), 9);
  });
  it('wall: object 0.1 m off the left wall snaps flush (left edge on x = 0)', () => {
    // centre x = 0.6 => left edge at 0.1; flush means centre x = 0.5
    const w = gen(0.6, 2.5).filter((c) => c.targetType === 'wall');
    const flush = w.find((c) => Math.abs(c.position.x - 0.5) < 1e-9);
    expect(flush).toBeDefined();
    expect(flush!.distance).toBeCloseTo(0.1, 9);
  });
  it('wall: nothing generated when farther than the snap distance', () => {
    expect(gen(2, 2.5).filter((c) => c.targetType === 'wall')).toEqual([]);
  });
  it('wall_endpoint: a corner within range of a room vertex snaps onto it', () => {
    // bottom-left corner of the footprint is at (0.1, 0.1): distance to vertex (0,0) is 0.1414
    const c = gen(0.6, 0.6).filter((x) => x.targetType === 'wall_endpoint');
    const hit = c.find((x) => Math.abs(x.position.x - 0.5) < 1e-9 && Math.abs(x.position.y - 0.5) < 1e-9);
    expect(hit).toBeDefined();
    expect(hit!.priority).toBe(100);
  });
  it('furniture_edge: flush against the right edge of another object', () => {
    const other = makeInstance({ id: 'o', position: { x: 2, y: 2.5 }, width: 1, length: 1 });
    // moving object centre x = 3.6 => left edge 3.1; other's right edge at 2.5... use 3.05 => left edge 2.55 (gap 0.05)
    const c = generateSnapCandidates({ moving: moving(3.05, 2.5), room, others: [other] });
    const flush = c.find((x) => x.targetType === 'furniture_edge' && Math.abs(x.position.x - 3.0) < 1e-9);
    expect(flush).toBeDefined();
    expect(flush!.distance).toBeCloseTo(0.05, 9);
  });
  it('furniture_centre and alignment candidates exist for neighbours', () => {
    const other = makeInstance({ id: 'o', position: { x: 2, y: 2.5 }, width: 1, length: 1 });
    const c = generateSnapCandidates({ moving: moving(2.1, 2.6), room, others: [other] });
    expect(c.some((x) => x.targetType === 'furniture_centre' && x.position.x === 2 && x.position.y === 2.5)).toBe(true);
    expect(c.some((x) => x.targetType === 'alignment' && x.position.x === 2 && Math.abs(x.position.y - 2.6) < 1e-9)).toBe(true);
    expect(c.some((x) => x.targetType === 'alignment' && x.position.y === 2.5 && Math.abs(x.position.x - 2.1) < 1e-9)).toBe(true);
  });
  it('respects the enabled-types filter', () => {
    const c = gen(0.6, 0.6, { enabled: ['grid'] });
    expect(new Set(c.map((x) => x.targetType))).toEqual(new Set(['grid']));
  });
  it('drops candidates beyond snapDistance', () => {
    expect(gen(2.04, 2.46, { snapDistance: 0.01 })).toEqual([]);
  });
  it('is pure and deterministic', () => {
    expect(gen(0.6, 0.6)).toEqual(gen(0.6, 0.6));
  });
});

describe('ranking', () => {
  it('priority first: a farther wall_endpoint beats a nearer grid snap', () => {
    const r = rankSnapCandidates([cand('grid', 1, 1, 0.01), cand('wall_endpoint', 0, 0, 0.2)]);
    expect(r.map((c) => c.targetType)).toEqual(['wall_endpoint', 'grid']);
  });
  it('same priority: smaller distance first', () => {
    const r = rankSnapCandidates([cand('wall', 1, 0, 0.2), cand('wall', 2, 0, 0.1)]);
    expect(r.map((c) => c.distance)).toEqual([0.1, 0.2]);
  });
  it('equal priority and distance: stable type order, then position', () => {
    const a = { ...cand('furniture_edge', 5, 5, 0.1), priority: 60 };
    const b = { ...cand('furniture_centre', 1, 1, 0.1), priority: 60 }; // forced equal priority
    expect(rankSnapCandidates([b, a]).map((c) => c.targetType)).toEqual(['furniture_edge', 'furniture_centre']);
    const p = cand('wall', 2, 1, 0.1);
    const q = cand('wall', 1, 9, 0.1);
    expect(rankSnapCandidates([p, q]).map((c) => c.position.x)).toEqual([1, 2]);
  });
  it('filters candidates over the threshold', () => {
    expect(rankSnapCandidates([cand('wall', 0, 0, 0.3)])).toEqual([]);
  });
  it('is order-independent (deterministic tie-break)', () => {
    const list = [cand('wall', 2, 1, 0.1), cand('wall', 1, 9, 0.1), cand('grid', 0, 0, 0.1), cand('alignment', 3, 3, 0.1)];
    expect(rankSnapCandidates(list)).toEqual(rankSnapCandidates([...list].reverse()));
  });
});
