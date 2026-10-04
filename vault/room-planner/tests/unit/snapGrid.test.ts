// Snap controls (M4.9): grid measured from the room corner, centre or edges mode, snap modes, grid sizes.
import { describe, expect, it } from 'vitest';
import { generateSnapCandidates } from '../../src/engine/snapping';
import { createUiStore, GRID_SIZES, snapsFor } from '../../src/state/uiStore';
import { makeRoom } from '../helpers';

const room = makeRoom();
const grid = (moving: { position: { x: number; y: number }; width: number; length: number; rotation: number }, over: object = {}) =>
  generateSnapCandidates({ moving, room, others: [], enabled: ['grid'], grid: 0.25, ...over }).filter((c) => c.targetType === 'grid');

describe('grid snapping origin and mode', () => {
  it('centre mode with the plan origin is what it always was', () => {
    const [c] = grid({ position: { x: 1.13, y: 2.61 }, width: 1, length: 1, rotation: 0 });
    expect(c.position).toEqual({ x: 1.25, y: 2.5 });
  });
  it('measures from the origin given (the room corner)', () => {
    const [c] = grid({ position: { x: 1.13, y: 2.61 }, width: 1, length: 1, rotation: 0 }, { gridOrigin: { x: 0.1, y: 0.1 } });
    expect(c.position.x).toBeCloseTo(1.1, 9); // 0.1 + 4 × 0.25
    expect(c.position.y).toBeCloseTo(2.6, 9); // 0.1 + 10 × 0.25
  });
  it('edges mode puts the nearest edge on a grid line, whichever of the two edges is closer', () => {
    // a 1.0 × 0.6 piece centred (1.13, 2.61): left edge 0.63, right edge 1.63; top 2.31, bottom 2.91
    const [c] = grid({ position: { x: 1.13, y: 2.61 }, width: 1, length: 0.6, rotation: 0 }, { gridMode: 'edges' });
    const left = c.position.x - 0.5;
    const right = c.position.x + 0.5;
    const lo = c.position.y - 0.3;
    const hi = c.position.y + 0.3;
    const onGrid = (v: number) => Math.abs(v / 0.25 - Math.round(v / 0.25)) < 1e-9;
    expect(onGrid(left) || onGrid(right)).toBe(true);
    expect(onGrid(lo) || onGrid(hi)).toBe(true);
    // the smaller shift was taken: 0.63 → 0.75 is 0.12 but 1.63 → 1.5 is 0.13, so the left edge wins on x
    expect(c.position.x).toBeCloseTo(1.13 + 0.12, 9);
  });
  it('edges mode measures from the origin too, and works for a turned piece (its bounding edges)', () => {
    const [c] = grid({ position: { x: 2, y: 2 }, width: 1, length: 1, rotation: Math.PI / 4 }, { gridMode: 'edges', gridOrigin: { x: 0.1, y: 0.1 } });
    const half = Math.SQRT1_2; // half-width of the turned square's bounding box
    const rel = (v: number) => (v - 0.1) / 0.25;
    const near = (v: number) => Math.abs(rel(v) - Math.round(rel(v))) < 1e-9;
    expect(near(c.position.x - half) || near(c.position.x + half)).toBe(true);
    expect(near(c.position.y - half) || near(c.position.y + half)).toBe(true);
  });
  it('produces no grid candidate when grid snapping is not enabled', () => {
    expect(generateSnapCandidates({ moving: { position: { x: 1, y: 1 }, width: 1, length: 1, rotation: 0 }, room, others: [], enabled: ['wall'] }).some((c) => c.targetType === 'grid')).toBe(false);
  });
});

describe('snap modes in the UI state', () => {
  it('smart enables every snap, grid only enables just the grid, off enables none', () => {
    expect(snapsFor('smart')).toHaveLength(6);
    expect(snapsFor('grid')).toEqual(['grid']);
    expect(snapsFor('off')).toEqual([]);
  });
  it('the store follows the mode and defaults to smart at 10 cm', () => {
    const ui = createUiStore();
    expect(ui.getState().snapMode).toBe('smart');
    expect(ui.getState().grid).toBe(0.1);
    ui.getState().setSnapMode('grid');
    expect(ui.getState().snapEnabled).toEqual(['grid']);
    ui.getState().setSnapMode('off');
    expect(ui.getState().snapEnabled).toEqual([]);
    ui.getState().setSnapMode('smart');
    expect(ui.getState().snapEnabled).toHaveLength(6);
  });
  it('offers 5, 10, 25 and 50 cm and ignores any other size', () => {
    expect([...GRID_SIZES]).toEqual([0.05, 0.1, 0.25, 0.5]);
    const ui = createUiStore();
    ui.getState().setGrid(0.25);
    expect(ui.getState().grid).toBe(0.25);
    ui.getState().setGrid(0.37);
    expect(ui.getState().grid).toBe(0.1);
  });
});
