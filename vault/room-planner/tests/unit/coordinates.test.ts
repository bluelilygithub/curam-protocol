import { describe, expect, it } from 'vitest';
import {
  angularDistance, inchesToMetres, metresToInches, normalizeRadians, quantizeLinear, quantizeRotation, quantizeVec2,
  threeToWorld, worldToThree,
} from '../../src/engine';

describe('quantizeLinear (C2)', () => {
  it.each([
    [0.0004, 0], [0.0005, 0.001], [0.0006, 0.001], [1.0005, 1.001], [-0.0005, -0.001], [-0.0004, 0], [-0.0006, -0.001],
  ])('%s -> %s', (x, want) => {
    expect(quantizeLinear(x)).toBe(want);
  });
  it('never returns -0', () => {
    expect(Object.is(quantizeLinear(-0.0001), 0)).toBe(true);
    expect(Object.is(quantizeLinear(-0), 0)).toBe(true);
  });
  it('rejects non-finite input', () => {
    expect(() => quantizeLinear(NaN)).toThrow(RangeError);
    expect(() => quantizeLinear(Infinity)).toThrow(RangeError);
  });
  it('quantizeVec2 applies to both axes', () => {
    expect(quantizeVec2({ x: 0.0005, y: -0.0005 })).toEqual({ x: 0.001, y: -0.001 });
  });
});

describe('quantizeRotation (C2, C3)', () => {
  const deg = (d: number) => (d * Math.PI) / 180;
  it('45.0000001 degrees -> exactly 45 degrees', () => {
    expect(Math.abs(quantizeRotation(deg(45.0000001)) - deg(45))).toBeLessThanOrEqual(1e-12);
  });
  it('rounds half away from zero on tenths of a degree', () => {
    expect(Math.abs(quantizeRotation(deg(0.05)) - deg(0.1))).toBeLessThanOrEqual(1e-12);
    expect(quantizeRotation(deg(0.04))).toBe(0);
  });
  it('360 degrees stores as 0', () => {
    expect(quantizeRotation(deg(360))).toBe(0);
    expect(quantizeRotation(Math.PI * 2)).toBe(0);
  });
  it('negative angles normalise into [0, 2π)', () => {
    expect(Math.abs(quantizeRotation(deg(-90)) - deg(270))).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(quantizeRotation(deg(-0.05)) - deg(359.9))).toBeLessThanOrEqual(1e-12);
  });
  it('honours an active angular snap increment', () => {
    expect(Math.abs(quantizeRotation(deg(52), 15) - deg(45))).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(quantizeRotation(deg(53), 15) - deg(60))).toBeLessThanOrEqual(1e-12);
  });
  it('is always within [0, 2π)', () => {
    for (const d of [-720, -359.96, -0.01, 0, 359.95, 359.99, 360, 721.3]) {
      const r = quantizeRotation(deg(d));
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(Math.PI * 2);
    }
  });
});

describe('angles', () => {
  it('angularDistance wraps around (C3: 359.95° and 0.05° are 0.1° apart)', () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(angularDistance(deg(359.95), deg(0.05))).toBeCloseTo(deg(0.1), 12);
  });
  it('normalizeRadians', () => {
    expect(normalizeRadians(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(normalizeRadians(Math.PI * 2)).toBe(0);
  });
});

describe('unit and axis helpers', () => {
  it('inch round-trip', () => {
    expect(inchesToMetres(metresToInches(1.234))).toBeCloseTo(1.234, 12);
  });
  it('World Y -> Three Z, elevation -> Three Y (round-trip)', () => {
    const t = worldToThree({ x: 1, y: 2 }, 3);
    expect(t).toEqual({ x: 1, y: 3, z: 2 });
    expect(threeToWorld(t)).toEqual({ position: { x: 1, y: 2 }, elevation: 3 });
  });
});
