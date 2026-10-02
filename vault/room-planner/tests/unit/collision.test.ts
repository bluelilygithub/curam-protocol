import { describe, expect, it } from 'vitest';
import {
  collides, convexOverlap, convexPenetration, EPSILON, footprintCorners, verticalInterval, verticalOverlap,
} from '../../src/engine';

const sq = (x: number, y: number, w = 1, l = 1, rotation = 0) => footprintCorners({ position: { x, y }, width: w, length: l, rotation });
const obj = (x: number, y: number, elevation = 0, height = 1) => ({
  corners: sq(x, y), interval: verticalInterval({ elevation, height }),
});

describe('2D collision (SAT)', () => {
  it('overlapping squares collide with the correct penetration depth', () => {
    expect(convexOverlap(sq(0, 0), sq(0.5, 0))).toBe(true);
    expect(convexPenetration(sq(0, 0), sq(0.5, 0))).toBeCloseTo(0.5, 9);
  });
  it('separated squares do not collide', () => {
    expect(convexOverlap(sq(0, 0), sq(2, 0))).toBe(false);
  });
  it('exactly touching is not a collision', () => {
    expect(convexOverlap(sq(0, 0), sq(1, 0))).toBe(false);
  });
  it('0.5 x EPSILON of overlap is touching; 2 x EPSILON is a collision (C4)', () => {
    expect(convexOverlap(sq(0, 0), sq(1 - 0.5 * EPSILON, 0))).toBe(false);
    expect(convexOverlap(sq(0, 0), sq(1 - 2 * EPSILON, 0))).toBe(true);
  });
  it('0.5 x EPSILON gap is touching; 2 x EPSILON gap is separated', () => {
    expect(convexOverlap(sq(0, 0), sq(1 + 0.5 * EPSILON, 0))).toBe(false);
    expect(convexOverlap(sq(0, 0), sq(1 + 2 * EPSILON, 0))).toBe(false);
  });
  it('rotated squares: a 45 degree diamond corner reaching into another square', () => {
    // diamond centred at (1.6,0) has its left corner at x = 1.6 - sqrt(0.5) = 0.893 < 0.5? no: inside square [−.5,.5]? no
    expect(convexOverlap(sq(0, 0), sq(1.1, 0, 1, 1, Math.PI / 4))).toBe(true); // corner at x=0.393
    expect(convexOverlap(sq(0, 0), sq(1.3, 0, 1, 1, Math.PI / 4))).toBe(false); // corner at x=0.593 > 0.5
  });
  it('a diamond whose AABB overlaps but whose shape does not is separated (SAT beats AABB)', () => {
    // diamond centre (1.0,1.0), half-diagonal 0.7071: AABB reaches (0.29,0.29) which is inside the unit square's AABB
    expect(convexOverlap(sq(0, 0), sq(1.0, 1.0, 1, 1, Math.PI / 4))).toBe(false);
  });
  it('is symmetric', () => {
    const a = sq(0, 0, 2, 1, 0.3);
    const b = sq(1.5, 0.4, 1, 1, 1.1);
    expect(convexOverlap(a, b)).toBe(convexOverlap(b, a));
  });
});

describe('vertical interval overlap', () => {
  it('stacked (touching heights) does not overlap', () => {
    expect(verticalOverlap({ min: 0, max: 1 }, { min: 1, max: 2 })).toBe(false);
  });
  it('overlapping heights overlap', () => {
    expect(verticalOverlap({ min: 0, max: 1 }, { min: 0.5, max: 2 })).toBe(true);
  });
  it('separated heights do not overlap', () => {
    expect(verticalOverlap({ min: 0, max: 1 }, { min: 1.5, max: 2 })).toBe(false);
  });
});

describe('collides = footprint AND vertical overlap', () => {
  it('same footprint at different elevations does not collide', () => {
    expect(collides(obj(0, 0, 0, 1), obj(0, 0, 1.5, 1))).toBe(false);
  });
  it('same footprint with overlapping heights collides', () => {
    expect(collides(obj(0, 0, 0, 1), obj(0.2, 0, 0.5, 1))).toBe(true);
  });
  it('same heights but separated footprints do not collide', () => {
    expect(collides(obj(0, 0), obj(5, 5))).toBe(false);
  });
});
