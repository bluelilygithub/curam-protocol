import type { Vec2 } from '../types';

/** Geometric predicate tolerance (Spec §3). Distinct from product quantization. */
export const EPSILON = 1e-6;
/** Shortest legal edge after quantization (C7). */
export const MIN_EDGE = 0.001;

const TWO_PI = Math.PI * 2;

function assertFinite(x: number): void {
  if (!Number.isFinite(x)) throw new RangeError(`non-finite value: ${x}`);
}

/**
 * Quantize a linear value (metres) to 1 mm, rounding half away from zero (C2).
 * -0 is normalised to 0.
 */
export function quantizeLinear(m: number): number {
  assertFinite(m);
  const mm = Math.round(Math.abs(m) * 1000 + 1e-9);
  const q = (Math.sign(m) * mm) / 1000;
  return q === 0 ? 0 : q;
}

export function quantizeVec2(v: Vec2): Vec2 {
  return { x: quantizeLinear(v.x), y: quantizeLinear(v.y) };
}

/** Normalise an angle to [0, 2π). */
export function normalizeRadians(r: number): number {
  assertFinite(r);
  let n = r % TWO_PI;
  if (n < 0) n += TWO_PI;
  if (n >= TWO_PI) n = 0;
  return n === 0 ? 0 : n;
}

/** Smallest absolute angular difference in radians, accounting for wraparound (C3). */
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(normalizeRadians(a) - normalizeRadians(b));
  return Math.min(d, TWO_PI - d);
}

/**
 * Quantize a rotation (radians) to the nearest `stepDeg` degrees (default 0.1°), half away from zero on the
 * step count (C2), then normalise to [0, 2π) (C3). 360.0° stores as 0.
 */
export function quantizeRotation(rad: number, stepDeg = 0.1): number {
  assertFinite(rad);
  const deg = (rad * 180) / Math.PI;
  const steps = Math.sign(deg) * Math.round(Math.abs(deg) / stepDeg + 1e-9);
  const perTurn = Math.round(360 / stepDeg);
  let n = steps % perTurn;
  if (n < 0) n += perTurn;
  if (n === 0) return 0;
  // Round the degree value to 1e-9 so e.g. 1800 * 0.1 gives exactly 180, not 180.00000000000003.
  const deg2 = Math.round(n * stepDeg * 1e9) / 1e9;
  return normalizeRadians((deg2 * Math.PI) / 180);
}

// ---- unit conversion (display only; internal unit is always metres)
export const metresToInches = (m: number): number => m / 0.0254;
export const inchesToMetres = (i: number): number => i * 0.0254;
export const metresToFeet = (m: number): number => m / 0.3048;
export const feetToMetres = (f: number): number => f * 0.3048;

// ---- 3D axis mapping (Spec §4): World X → Three X, World Y → Three Z, Elevation → Three Y
export interface ThreePoint { x: number; y: number; z: number }
export function worldToThree(p: Vec2, elevation = 0): ThreePoint {
  return { x: p.x, y: elevation, z: p.y };
}
export function threeToWorld(t: ThreePoint): { position: Vec2; elevation: number } {
  return { position: { x: t.x, y: t.z }, elevation: t.y };
}
