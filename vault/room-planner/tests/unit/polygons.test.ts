import { describe, expect, it } from 'vitest';
import { isCCW, normalizeCCW, polygonArea, signedArea, validatePolygon } from '../../src/engine';
import type { Vec2, Vertex } from '../../src/engine';

const vs = (pts: Array<[number, number]>): Vertex[] => pts.map(([x, y], i) => ({ id: `v${i}`, position: { x, y } }));
const pos = (v: Vertex[]): Vec2[] => v.map((x) => x.position);

describe('area and orientation', () => {
  it('rectangle area in m²', () => {
    expect(polygonArea(pos(vs([[0, 0], [4, 0], [4, 5], [0, 5]])))).toBe(20);
  });
  it('concave L-shape area: 6x6 minus 3x3 notch = 27', () => {
    expect(polygonArea(pos(vs([[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]])))).toBe(27);
  });
  it('signed area is positive for CCW', () => {
    expect(isCCW(pos(vs([[0, 0], [1, 0], [1, 1], [0, 1]])))).toBe(true);
    expect(signedArea(pos(vs([[0, 0], [0, 1], [1, 1], [1, 0]])))).toBe(-1);
  });
  it('normalizeCCW reverses a clockwise polygon and keeps ids with their vertices', () => {
    const cw = vs([[0, 0], [0, 4], [4, 4], [4, 0]]);
    const out = normalizeCCW(cw);
    expect(isCCW(pos(out))).toBe(true);
    expect(out.map((v) => v.id)).toEqual(['v3', 'v2', 'v1', 'v0']);
    expect(out.find((v) => v.id === 'v1')!.position).toEqual({ x: 0, y: 4 });
  });
  it('normalizeCCW leaves CCW untouched and does not mutate input', () => {
    const ccw = vs([[0, 0], [4, 0], [4, 4], [0, 4]]);
    const out = normalizeCCW(ccw);
    expect(out).toEqual(ccw);
    expect(out).not.toBe(ccw);
  });
});

describe('validatePolygon error codes', () => {
  it('accepts a rectangle and an L-shape', () => {
    expect(validatePolygon(vs([[0, 0], [4, 0], [4, 5], [0, 5]]))).toEqual({ ok: true });
    expect(validatePolygon(vs([[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]]))).toEqual({ ok: true });
  });
  it('accepts negative coordinates', () => {
    expect(validatePolygon(vs([[-4, -5], [-1, -5], [-1, -1], [-4, -1]]))).toEqual({ ok: true });
  });
  it('TOO_FEW_VERTICES', () => {
    expect(validatePolygon(vs([[0, 0], [1, 0]]))).toEqual({ ok: false, code: 'TOO_FEW_VERTICES' });
    expect(validatePolygon([])).toEqual({ ok: false, code: 'TOO_FEW_VERTICES' });
  });
  it('SELF_INTERSECTION (bow-tie, which also has zero signed area)', () => {
    expect(validatePolygon(vs([[0, 0], [1, 1], [1, 0], [0, 1]]))).toEqual({ ok: false, code: 'SELF_INTERSECTION' });
  });
  it('SELF_INTERSECTION when a vertex touches a non-adjacent edge', () => {
    expect(validatePolygon(vs([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]]))).toEqual({ ok: false, code: 'SELF_INTERSECTION' });
  });
  it('ZERO_AREA (three collinear points)', () => {
    expect(validatePolygon(vs([[0, 0], [1, 0], [2, 0]]))).toEqual({ ok: false, code: 'ZERO_AREA' });
  });
  it('DEGENERATE_EDGE: edge shorter than 1 mm', () => {
    expect(validatePolygon(vs([[0, 0], [4, 0], [4, 0.0005], [0, 5]]))).toEqual({ ok: false, code: 'DEGENERATE_EDGE' });
  });
  it('DEGENERATE_EDGE: two adjacent vertices at the same position (C7)', () => {
    expect(validatePolygon(vs([[0, 0], [4, 0], [4, 0], [4, 5], [0, 5]]))).toEqual({ ok: false, code: 'DEGENERATE_EDGE' });
  });
  it('DUPLICATE_VERTEX: two non-adjacent vertices at the same position (C7)', () => {
    expect(validatePolygon(vs([[0, 0], [4, 0], [4, 4], [0, 0], [-4, 4]]))).toEqual({ ok: false, code: 'DUPLICATE_VERTEX' });
  });
  it('collinear consecutive vertices are valid (C7)', () => {
    expect(validatePolygon(vs([[0, 0], [2, 0], [4, 0], [4, 5], [0, 5]]))).toEqual({ ok: true });
  });
  it('a 1 mm edge is the shortest allowed', () => {
    expect(validatePolygon(vs([[0, 0], [4, 0], [4, 0.001], [0, 5]]))).toEqual({ ok: true });
  });
});
