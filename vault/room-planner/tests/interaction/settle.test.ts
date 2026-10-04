// Small pieces settle on what is under them (a plant on a side table or sideboard) and travel with it.
import { describe, expect, it } from 'vitest';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { ridersOf, supportElevation } from '../../src/engine/support';
import { makeRoom } from '../helpers';
import { inst, makeHarness } from './harness';

const table = () => inst({ id: 't', definitionId: 'side-table', position: { x: 2, y: 2.5 }, width: 0.5, length: 0.5, height: 0.55 });
const sideboard = () => inst({ id: 's', definitionId: 'sideboard', position: { x: 2, y: 2.5 }, width: 1.6, length: 0.45, height: 0.8 });
const plant = (over = {}) => inst({ id: 'p', definitionId: 'plant-small', position: { x: 3.2, y: 4 }, width: 0.3, length: 0.3, height: 0.5, ...over });
const defs = FURNITURE_LIBRARY;

describe('support height', () => {
  it('is the top of the piece under the centre, or the floor', () => {
    const room = makeRoom({ furniture: [sideboard()] });
    const p = plant();
    expect(supportElevation(room, defs, p, { x: 2.3, y: 2.5 })).toBeCloseTo(0.8, 9);
    expect(supportElevation(room, defs, p, { x: 3.2, y: 4 })).toBe(0);
    expect(supportElevation(room, defs, p, { x: 2.9, y: 2.5 })).toBe(0); // 0.9 from the centre: past the end (0.8)
  });
  it('ignores rugs, wall art, tall pieces and other plants', () => {
    const rug = inst({ id: 'r', definitionId: 'rug-rect', position: { x: 2, y: 2.5 }, width: 2.4, length: 1.7, height: 0.015 });
    const wardrobe = inst({ id: 'w', definitionId: 'wardrobe', position: { x: 2, y: 2.5 }, width: 1.8, length: 0.6, height: 2.1 });
    const other = plant({ id: 'o', position: { x: 2, y: 2.5 } });
    expect(supportElevation(makeRoom({ furniture: [rug, wardrobe, other] }), defs, plant(), { x: 2, y: 2.5 })).toBe(0);
  });
  it('finds the settlers standing on a piece', () => {
    const on = plant({ id: 'on', position: { x: 2.3, y: 2.5 }, elevation: 0.8 });
    const off = plant({ id: 'off', position: { x: 3.2, y: 4 } });
    const room = makeRoom({ furniture: [sideboard(), on, off] });
    expect(ridersOf(room, defs, [room.furniture.find((f) => f.id === 's')!]).map((r) => r.id)).toEqual(['on']);
  });
});

describe('plant on a surface', () => {
  it('placing a small plant over a side table puts it on top, at the table height', () => {
    const h = makeHarness({ furniture: [table()] });
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'plant-small' });
    h.it.pointerMove(h.ptr(2, 2.5));
    h.it.pointerDown(h.ptr(2, 2.5));
    const placed = h.room().furniture.find((f) => f.definitionId === 'plant-small')!;
    expect(placed.elevation).toBeCloseTo(0.55, 3);
    expect(h.state() && h.room().furniture).toHaveLength(2); // placed without being flagged as a collision
  });
  it('placing it on the open floor leaves it on the floor', () => {
    const h = makeHarness({ furniture: [table()] });
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'plant-small' });
    h.it.pointerMove(h.ptr(3.4, 4));
    h.it.pointerDown(h.ptr(3.4, 4));
    expect(h.room().furniture.find((f) => f.definitionId === 'plant-small')!.elevation).toBe(0);
  });
  it('dragging a plant from the floor onto a sideboard lifts it, and back off drops it, each a single undo step', () => {
    const h = makeHarness({ furniture: [sideboard(), plant()] });
    h.drag([3.2, 4], [2.3, 2.5]);
    expect(h.inst('p').elevation).toBeCloseTo(0.8, 3);
    expect(h.pushes).toHaveLength(1);
    const at = h.inst('p').position; // snapping may have nudged it, so grab it where it actually is
    h.drag([at.x, at.y], [3.2, 4], 12, { mpp: 0.002 }); // zoomed in, so the resize handles of a small piece do not cover it
    expect(h.inst('p').elevation).toBe(0);
    expect(h.pushes).toHaveLength(2);
    h.key('z', { ctrl: true });
    expect(h.inst('p').elevation).toBeCloseTo(0.8, 3); // undo restores both its place and its height together
    expect(h.inst('p').position.x).toBeCloseTo(2.3, 1);
  });
  it('moving the sideboard carries the plant standing on it', () => {
    const h = makeHarness({ furniture: [sideboard(), plant({ position: { x: 2.3, y: 2.5 }, elevation: 0.8 })] });
    h.ui.getState().select([{ kind: 'furniture', id: 's' }]);
    h.drag([1.6, 2.5], [1.6, 3.5]);
    expect(h.inst('s').position.y).toBeGreaterThan(3.2);
    expect(h.inst('p').position.y).toBeCloseTo(h.inst('s').position.y, 2);
    expect(h.inst('p').elevation).toBeCloseTo(0.8, 3);
  });
});
