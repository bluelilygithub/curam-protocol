import { describe, expect, it } from 'vitest';
import { checkContainment, EPSILON, footprintCorners, quantizeLinear } from '../../src/engine';
import { makeRoom, ringWalls } from '../helpers';
import type { Vertex } from '../../src/engine';

const rect = makeRoom(); // 4 x 5
const fp = (x: number, y: number, w: number, l: number, rotation = 0) =>
  footprintCorners({ position: { x, y }, width: w, length: l, rotation });
const check = (corners: ReturnType<typeof fp>, room = rect) => checkContainment(corners, room.vertices, room.walls);

const L: Vertex[] = [
  { id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 6, y: 0 } }, { id: 'c', position: { x: 6, y: 3 } },
  { id: 'd', position: { x: 3, y: 3 } }, { id: 'e', position: { x: 3, y: 6 } }, { id: 'f', position: { x: 0, y: 6 } },
];
const lRoom = makeRoom({ vertices: L, walls: ringWalls(L, 'lw') });

describe('containment (Rule 17)', () => {
  it('fully inside', () => {
    expect(check(fp(2, 2.5, 1, 1)).inside).toBe(true);
  });
  it('touching an edge exactly is valid', () => {
    expect(check(fp(0.5, 2.5, 1, 1)).inside).toBe(true); // left edge at x = 0
  });
  it('touching two edges (corner in the room corner) is valid', () => {
    expect(check(fp(0.5, 0.5, 1, 1)).inside).toBe(true);
  });
  it('0.5 x EPSILON outside is still touching; 2 x EPSILON outside is outside', () => {
    expect(check(fp(0.5 - 0.5 * EPSILON, 2.5, 1, 1)).inside).toBe(true);
    expect(check(fp(0.5 - 2 * EPSILON, 2.5, 1, 1)).inside).toBe(false);
  });
  it('crossing an edge is invalid and names the wall', () => {
    const r = check(fp(0.2, 2.5, 1, 1));
    expect(r.inside).toBe(false);
    expect(r.wallIds).toEqual(['w4']);
    expect(r.magnitude).toBeGreaterThan(0);
  });
  it('fully outside', () => {
    expect(check(fp(10, 10, 1, 1)).inside).toBe(false);
  });
  it('rotated footprint whose corners poke out is invalid', () => {
    expect(check(fp(0.6, 2.5, 1, 1, Math.PI / 4)).inside).toBe(false);
    expect(check(fp(2, 2.5, 1, 1, Math.PI / 4)).inside).toBe(true);
  });
  it('concave room: inside either arm is valid', () => {
    expect(check(fp(1.5, 4.5, 1, 1), lRoom).inside).toBe(true);
    expect(check(fp(4.5, 1.5, 1, 1), lRoom).inside).toBe(true);
  });
  it('concave room: footprint in the notch is invalid', () => {
    expect(check(fp(4.5, 4.5, 1, 1), lRoom).inside).toBe(false);
  });
  it('concave room: all four corners inside but an edge cuts the reflex corner is invalid', () => {
    // 37 degree sofa from the concave-invalid scenario: corners are inside the room, the long edge crosses the notch
    const corners = fp(2.4, 2.4, 2, 0.9, (37 * Math.PI) / 180);
    const r = check(corners, lRoom);
    expect(r.inside).toBe(false);
    expect(r.wallIds).toContain('lw4'); // wall d->e is nearest to the part outside the room
  });
  it('concave room: footprint touching the reflex vertex only is valid', () => {
    expect(check(fp(2.5, 2.5, 1, 1), lRoom).inside).toBe(true); // corner at (3,3)
  });
  it('quantizing a valid inside placement never re-classifies it outside', () => {
    const x = 0.5 + 0.0004; // raw value near the boundary
    const q = quantizeLinear(x); // 0.5
    expect(check(fp(q, 2.5, 1, 1)).inside).toBe(true);
  });
});
