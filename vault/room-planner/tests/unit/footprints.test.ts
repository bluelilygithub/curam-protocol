import { describe, expect, it } from 'vitest';
import { footprintCorners, localToWorld, quantizeRotation, resizeAboutAnchor, verticalInterval } from '../../src/engine';

const rect = (x: number, y: number, w: number, l: number, rotation = 0) => ({ position: { x, y }, width: w, length: l, rotation });
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe('footprintCorners', () => {
  it('0 degrees: axis-aligned, CCW', () => {
    const c = footprintCorners(rect(2, 3, 2, 1));
    near(c[0], { x: 1, y: 2.5 });
    near(c[1], { x: 3, y: 2.5 });
    near(c[2], { x: 3, y: 3.5 });
    near(c[3], { x: 1, y: 3.5 });
  });
  it('90 degrees swaps the extents', () => {
    const c = footprintCorners(rect(0, 0, 2, 1, Math.PI / 2));
    const xs = c.map((p) => p.x).sort((a, b) => a - b);
    const ys = c.map((p) => p.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-0.5, 9);
    expect(xs[3]).toBeCloseTo(0.5, 9);
    expect(ys[0]).toBeCloseTo(-1, 9);
    expect(ys[3]).toBeCloseTo(1, 9);
  });
  it('45 degrees: unit square has half-diagonal reach on both axes', () => {
    const c = footprintCorners(rect(0, 0, 1, 1, Math.PI / 4));
    const r = Math.SQRT1_2;
    near(c[0], { x: 0, y: -r });
    near(c[2], { x: 0, y: r });
  });
  it('arbitrary angle keeps side lengths and centre', () => {
    const c = footprintCorners(rect(1.5, -2, 2.2, 0.9, 0.7));
    const d01 = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
    const d12 = Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y);
    expect(d01).toBeCloseTo(2.2, 9);
    expect(d12).toBeCloseTo(0.9, 9);
    near({ x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 }, { x: 1.5, y: -2 });
  });
  it('after rotation quantization the corners come from the quantized angle', () => {
    const r = quantizeRotation((37.04 * Math.PI) / 180);
    const c = footprintCorners(rect(0, 0, 1, 1, r));
    const c2 = footprintCorners(rect(0, 0, 1, 1, (37 * Math.PI) / 180));
    near(c[0], c2[0]);
  });
  it('local front (+Y) of a 90 degree rotated object faces world -X', () => {
    near(localToWorld(rect(0, 0, 2, 1, Math.PI / 2), { x: 0, y: 1 }), { x: -1, y: 0 });
  });
});

describe('verticalInterval', () => {
  it('is [elevation, elevation + height]', () => {
    expect(verticalInterval({ elevation: 0.5, height: 0.8 })).toEqual({ min: 0.5, max: 1.3 });
  });
});

describe('resizeAboutAnchor (B3)', () => {
  it('right edge handle: left edge stays fixed, centre moves by half the growth', () => {
    const out = resizeAboutAnchor(rect(2, 2, 2, 1), { x: 1, y: 0 }, 3, 1);
    near(out.position, { x: 2.5, y: 2 });
    expect(out.width).toBe(3);
    expect(out.length).toBe(1);
  });
  it('left edge handle shrinking: right edge stays fixed', () => {
    const out = resizeAboutAnchor(rect(2, 2, 2, 1), { x: -1, y: 0 }, 1, 1);
    // right edge at x=3 stays; new width 1 -> centre 2.5
    near(out.position, { x: 2.5, y: 2 });
  });
  it('corner handle resizes both and fixes the opposite corner', () => {
    const out = resizeAboutAnchor(rect(0, 0, 2, 2), { x: 1, y: 1 }, 4, 3);
    const c = footprintCorners({ ...out, rotation: 0 });
    near(c[0], { x: -1, y: -1 }); // opposite corner unchanged
    near(out.position, { x: 1, y: 0.5 });
  });
  it('edge handle ignores the other dimension argument', () => {
    const out = resizeAboutAnchor(rect(0, 0, 2, 2), { x: 0, y: 1 }, 99, 3);
    expect(out.width).toBe(2);
    expect(out.length).toBe(3);
  });
  it('works for rotated rectangles: opposite edge stays fixed in world space', () => {
    const r = rect(3, 4, 2, 1, 0.6);
    const before = footprintCorners(r);
    const out = resizeAboutAnchor(r, { x: 1, y: 0 }, 3.5, 1);
    const after = footprintCorners({ ...out, rotation: 0.6 });
    near(after[0], before[0]);
    near(after[3], before[3]);
  });
});
