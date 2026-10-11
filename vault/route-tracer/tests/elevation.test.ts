import { describe, expect, it } from 'vitest';
import {
  buildProfile, chooseZoom, climb, decodeHeight, elevationsAt, ElevationError, fillGaps, pointAtKm, samplesAlong, smooth, tileXY, type TileData, type TileLoader,
} from '../src/elevation';
import { totalKm, lineKm, type Line } from '../src/geo';

/** A synthetic terrain-rgb tile whose height at every pixel is height(lng, lat): lets the real sampling code be checked against known ground. */
function tileFrom(height: (lng: number, lat: number) => number, size = 32): TileLoader {
  return async (z, x, y) => {
    const n = 2 ** z;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const lng = ((x + (px + 0.5) / size) / n) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (py + 0.5) / size)) / n))) * 180) / Math.PI;
        const v = Math.round((height(lng, lat) + 10000) / 0.1);
        const i = (py * size + px) * 4;
        data[i] = (v >> 16) & 255; data[i + 1] = (v >> 8) & 255; data[i + 2] = v & 255; data[i + 3] = 255;
      }
    }
    return { size, data } satisfies TileData;
  };
}

describe('terrain decoding and tiles', () => {
  it('decodes the terrain-rgb-v2 height formula', () => {
    expect(decodeHeight(1, 134, 160)).toBeCloseTo(0, 6); // 1*65536 + 134*256 + 160 = 100000 -> 0 m
    expect(decodeHeight(0, 0, 0)).toBe(-10000);
    expect(decodeHeight(1, 134, 170)).toBeCloseTo(1, 6);
  });
  it('tileXY: the world is one tile at zoom 0 and a known place lands in the right tile', () => {
    expect(tileXY(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
    const t = tileXY(153.028, -27.468, 12); // Brisbane
    expect(Math.floor(t.x)).toBe(3789);
    expect(Math.floor(t.y)).toBe(2373);
  });
  it('chooseZoom uses the top zoom for a short route and a lower one when a long route would need too many tiles', () => {
    expect(chooseZoom([[153, -27], [153.01, -27.01]])).toBe(12);
    const long = Array.from({ length: 200 }, (_, i) => [140 + i * 0.05, -27] as [number, number]); // about 10 degrees east-west
    const z = chooseZoom(long);
    expect(z).toBeLessThan(12);
    const seen = new Set(long.map(([lng, lat]) => { const t = tileXY(lng, lat, z); return `${Math.floor(t.x)},${Math.floor(t.y)}`; }));
    expect(seen.size).toBeLessThanOrEqual(36);
  });
});

describe('sampling heights', () => {
  const plane = (lng: number, lat: number): number => 100 + (lng - 153) * 1000 + (lat + 27) * 500; // metres
  it('reads a tilted plane back to within a metre, across tile borders', async () => {
    const pts: [number, number][] = [[153.0, -27.0], [153.05, -27.02], [153.0879, -27.0], [153.2, -27.1]];
    const z = 12;
    const got = await elevationsAt(pts, z, tileFrom(plane));
    pts.forEach(([lng, lat], i) => expect(Math.abs((got[i] as number) - plane(lng, lat))).toBeLessThan(1.5));
  });
  it('gives null where a tile fails, and fillGaps interpolates it', async () => {
    const load: TileLoader = async () => null;
    expect(await elevationsAt([[153, -27]], 12, load)).toEqual([null]);
    expect(fillGaps([10, null, null, 40])).toEqual([10, 20, 30, 40]);
    expect(fillGaps([null, 5, null])).toEqual([5, 5, 5]);
    expect(fillGaps([null, null])).toBeNull();
  });
  it('smooth is a moving average that keeps a flat line flat', () => {
    expect(smooth([5, 5, 5, 5])).toEqual([5, 5, 5, 5]);
    expect(smooth([0, 30, 0])[1]).toBe(10);
  });
});

describe('climb', () => {
  it('counts a steady rise and fall', () => {
    expect(climb([0, 10, 20, 30, 40, 50])).toEqual({ ascent: 50, descent: 0 });
    expect(climb([50, 40, 30, 20, 10, 0])).toEqual({ ascent: 0, descent: 50 });
  });
  it('up then down then up: each leg counted, and ascent - descent is the net change', () => {
    const r = climb([0, 50, 100, 60, 20, 70, 120]);
    expect(r.ascent).toBe(100 + 100);
    expect(r.descent).toBe(80);
    expect(r.ascent - r.descent).toBe(120);
  });
  it('ignores wiggles smaller than the threshold', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 1.2 : -1.2)); // flat ground with terrain-model noise
    expect(climb(noisy)).toEqual({ ascent: 0, descent: 0 });
    // a real 50 m climb with that noise on top is still about 50 m, not 120 m
    const hill = Array.from({ length: 200 }, (_, i) => i * 0.25 + (i % 2 ? 1.2 : -1.2));
    const r = climb(hill);
    expect(r.ascent).toBeGreaterThan(45);
    expect(r.ascent).toBeLessThan(56);
  });
  it('is zero for flat, single or empty profiles', () => {
    expect(climb([10, 10, 10])).toEqual({ ascent: 0, descent: 0 });
    expect(climb([10])).toEqual({ ascent: 0, descent: 0 });
    expect(climb([])).toEqual({ ascent: 0, descent: 0 });
  });
});

describe('along the route', () => {
  const east: Line = [[153, -27], [153.1, -27]]; // about 9.9 km
  it('samplesAlong includes both ends and increases evenly', () => {
    const s = samplesAlong([east], 1);
    expect(s[0].km).toBe(0);
    expect(s.at(-1)!.km).toBeCloseTo(lineKm(east), 9);
    expect(s.slice(1, -1).map((x) => x.km)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(samplesAlong([], 1)).toEqual([]);
  });
  it('km runs on across strokes without counting the gap', () => {
    const a: Line = [[0, 0], [0, 0.0045]];
    const b: Line = [[1, 0], [1, 0.0135]];
    const s = samplesAlong([a, b], 1);
    expect(s.at(-1)!.km).toBeCloseTo(totalKm([a, b]), 9);
    expect(s[1].pos[0]).toBe(1); // 1 km is 0.5 km into the second stroke
  });
  it('pointAtKm finds the spot, clamps to the ends', () => {
    const p = pointAtKm([east], lineKm(east) / 2)!;
    expect(p[0]).toBeCloseTo(153.05, 6);
    expect(pointAtKm([east], -5)).toEqual([153, -27]);
    expect(pointAtKm([east], 999)![0]).toBeCloseTo(153.1, 6);
    expect(pointAtKm([], 1)).toBeNull();
  });
});

describe('buildProfile', () => {
  it('climbs a known slope: ascent matches the ground, descent is zero', async () => {
    const plane = (lng: number): number => 100 + (lng - 153) * 1000; // 100 m per 0.1 degree east
    const p = await buildProfile([[[153.0, -27.0], [153.1, -27.0]]], tileFrom(plane));
    expect(p.start).toBeCloseTo(100, 0);
    expect(p.end).toBeCloseTo(200, 0);
    expect(Math.abs(p.ascent - 100)).toBeLessThan(3);
    expect(p.descent).toBeLessThan(1);
    expect(p.max).toBeGreaterThan(p.min);
    expect(p.km[0]).toBe(0);
    expect(p.km.at(-1)).toBeCloseTo(p.totalKm, 9);
    expect(p.gaps).toBe(0);
  });
  it('a hill: up one side and down the other', async () => {
    const hill = (lng: number): number => 300 - Math.abs(lng - 153.05) * 2000; // peaks at 300 m in the middle, 200 m at each end
    const p = await buildProfile([[[153.0, -27.0], [153.1, -27.0]]], tileFrom(hill));
    expect(Math.abs(p.ascent - 100)).toBeLessThan(6);
    expect(Math.abs(p.descent - 100)).toBeLessThan(6);
    expect(p.max).toBeGreaterThan(290);
  });
  it('flat ground has no climb', async () => {
    const p = await buildProfile([[[153.0, -27.0], [153.1, -27.1]]], tileFrom(() => 42));
    expect(p.ascent).toBe(0);
    expect(p.descent).toBe(0);
    expect(p.min).toBeCloseTo(42, 1);
  });
  it('says so plainly when no terrain can be loaded, or there is no route', async () => {
    await expect(buildProfile([[[153, -27], [153.1, -27]]], async () => null)).rejects.toThrow(/Terrain data could not be loaded/);
    await expect(buildProfile([], async () => null)).rejects.toBeInstanceOf(ElevationError);
    await expect(buildProfile([[[1, 1]]], async () => null)).rejects.toThrow(/Draw a route/);
  });
  it('survives a missing tile in the middle (gap filled from its neighbours)', async () => {
    const good = tileFrom((lng) => 100 + (lng - 153) * 1000);
    const load: TileLoader = async (z, x, y) => (x === 3790 ? null : good(z, x, y));
    const p = await buildProfile([[[153.0, -27.0], [153.25, -27.0]]], load);
    expect(p.gaps).toBeGreaterThan(0);
    expect(p.ele.every(Number.isFinite)).toBe(true);
  });
});
