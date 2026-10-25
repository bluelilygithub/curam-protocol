import { describe, expect, it } from 'vitest';
import type { Lines, Pos } from '../src/geo';
import { compassName, turnCues } from '../src/turns';

// 0.001 degree is about 111 m north, and about 99 m east at this latitude
const O: Pos = [153.0, -27.5];
const north = (p: Pos, m: number): Pos => [p[0], p[1] + m / 111320];
const east = (p: Pos, m: number): Pos => [p[0] + m / (111320 * Math.cos((-27.5 * Math.PI) / 180)), p[1]];
const south = (p: Pos, m: number): Pos => north(p, -m);
const west = (p: Pos, m: number): Pos => east(p, -m);
const texts = (l: Lines): string[] => turnCues(l).map((c) => c.text);

describe('turn cues from a line', () => {
  it('a straight line is "head ...", then arrive', () => {
    const c = turnCues([[O, north(O, 500)]]);
    expect(c.map((x) => x.text)).toEqual(['Head north', 'Arrive at the end of the route']);
    expect(c[0].distanceM).toBeGreaterThan(495);
    expect(c[0].distanceM).toBeLessThan(505);
    expect(c[1].distanceM).toBe(0);
  });
  it('north then east is a right turn, north then west is a left turn', () => {
    const a = north(O, 400);
    expect(texts([[O, a, east(a, 300)]])).toEqual(['Head north', 'Turn right', 'Arrive at the end of the route']);
    expect(texts([[O, a, west(a, 300)]])).toEqual(['Head north', 'Turn left', 'Arrive at the end of the route']);
  });
  it('each step carries how far to go before the next instruction, and where it happens', () => {
    const a = north(O, 400); const b = east(a, 300);
    const c = turnCues([[O, a, b]]);
    expect(c[0].distanceM).toBeGreaterThan(395); expect(c[0].distanceM).toBeLessThan(405);
    expect(c[1].distanceM).toBeGreaterThan(295); expect(c[1].distanceM).toBeLessThan(305);
    expect(c[0].pos).toEqual(O);
    expect(c[1].pos).toEqual(a);
    expect(c.at(-1)?.pos).toEqual(b);
    expect(c.reduce((n, x) => n + x.distanceM, 0)).toBeGreaterThan(695);
  });
  it('says how sharp: a gentle change bears, a right angle turns, a hairpin is sharp, doubling back is a U-turn', () => {
    const a = north(O, 400);
    const bearTo = (deg: number): Pos => [a[0] + (300 * Math.sin((deg * Math.PI) / 180)) / (111320 * Math.cos((-27.5 * Math.PI) / 180)), a[1] + (300 * Math.cos((deg * Math.PI) / 180)) / 111320];
    expect(texts([[O, a, bearTo(35)]])[1]).toBe('Bear right');
    expect(texts([[O, a, bearTo(90)]])[1]).toBe('Turn right');
    expect(texts([[O, a, bearTo(150)]])[1]).toBe('Turn sharp right');
    expect(texts([[O, a, bearTo(-150)]])[1]).toBe('Turn sharp left');
    expect(texts([[O, a, south(a, 300)]])[1]).toBe('Make a U-turn');
  });
  it('wobble is not a turn: a line that zigzags by a few metres is one straight run', () => {
    const pts: Pos[] = Array.from({ length: 60 }, (_, i) => east([O[0], O[1]], 0) && ([O[0] + (i % 2 ? 0.00003 : -0.00003), O[1] + i * 0.0001] as Pos));
    expect(texts([pts])).toEqual(['Head north', 'Arrive at the end of the route']);
  });
  it('a loop around a block is four runs and three turns of the same kind', () => {
    const a = north(O, 300); const b = east(a, 300); const c = south(b, 300);
    const t = texts([[O, a, b, c, O]]);
    expect(t).toEqual(['Head north', 'Turn right', 'Turn right', 'Turn right', 'Arrive at the end of the route']);
  });
  it('heads in the right compass direction', () => {
    expect(compassName(0)).toBe('north'); expect(compassName(44)).toBe('north-east'); expect(compassName(90)).toBe('east'); expect(compassName(200)).toBe('south'); expect(compassName(359)).toBe('north');
    expect(texts([[O, east(O, 200)]])[0]).toBe('Head east');
    expect(texts([[O, south(west(O, 100), 200)]])[0]).toBe('Head south-west');
  });
  it('copes with nothing, one point, repeated points and a line of several strokes', () => {
    expect(turnCues([])).toEqual([]);
    expect(turnCues([[O]])).toEqual([]);
    expect(turnCues([[O, O, O]])).toEqual([]);
    expect(turnCues([[O, north(O, 100)], [north(O, 120), north(O, 300)]]).length).toBeGreaterThanOrEqual(2);
  });
  it('a very long twisty line stays within 400 steps', () => {
    const pts: Pos[] = Array.from({ length: 6000 }, (_, i) => [153 + i * 0.0002 + Math.sin(i / 3) * 0.0004, -27.5 + Math.cos(i / 4) * 0.0004] as Pos);
    expect(turnCues([pts]).length).toBeLessThanOrEqual(401);
  });
});
