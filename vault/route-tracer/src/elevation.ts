import { pointCount, segmentKm, totalKm, type Lines, type Pos } from './geo';

/**
 * Elevation along a route from MapTiler's terrain-rgb-v2 tiles (RGB-encoded heights: metres = -10000 + (R*65536 + G*256 + B) * 0.1).
 * The tiles are fetched straight from MapTiler with the browser key (like the map itself), decoded here, and sampled along the line.
 * It is a terrain model: a bridge or tunnel reads as the ground, and heights are good to a few metres, not centimetres.
 */

export const MAX_ZOOM = 12; // the highest zoom terrain-rgb-v2 has
const MAX_TILES = 36;
const MAX_SAMPLES = 500;
const MIN_STEP_KM = 0.02;
/** A rise or fall only counts as climb once it is this many metres from the last high or low (kills the noise of a terrain model). */
export const CLIMB_THRESHOLD_M = 3;

export interface TileData { size: number; data: Uint8ClampedArray }
export type TileLoader = (z: number, x: number, y: number) => Promise<TileData | null>;

/** Fractional web-mercator tile coordinates of a point at zoom z. */
export function tileXY(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

export const decodeHeight = (r: number, g: number, b: number): number => -10000 + (r * 65536 + g * 256 + b) * 0.1;

/** The smallest number of unique tiles at the highest zoom that stays under the cap (a long route is sampled from lower-zoom tiles). */
export function chooseZoom(points: Pos[], maxTiles = MAX_TILES): number {
  for (let z = MAX_ZOOM; z > 4; z -= 1) {
    const seen = new Set<string>();
    for (const [lng, lat] of points) {
      const t = tileXY(lng, lat, z);
      seen.add(`${Math.floor(t.x)},${Math.floor(t.y)}`);
      if (seen.size > maxTiles) break;
    }
    if (seen.size <= maxTiles) return z;
  }
  return 4;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Terrain height at each point (null where the tile could not be loaded), bilinear between the four nearest tile pixels. */
export async function elevationsAt(points: Pos[], z: number, load: TileLoader): Promise<(number | null)[]> {
  const wanted = new Map<string, [number, number]>();
  const where = points.map(([lng, lat]) => {
    const t = tileXY(lng, lat, z);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    wanted.set(`${tx},${ty}`, [tx, ty]);
    return { t, tx, ty };
  });
  const tiles = new Map<string, TileData | null>();
  await inBatches([...wanted.entries()], 6, async ([key, [tx, ty]]) => { tiles.set(key, await load(z, tx, ty)); });

  return where.map(({ t, tx, ty }) => {
    const tile = tiles.get(`${tx},${ty}`);
    if (!tile) return null;
    const { size, data } = tile;
    const fx = Math.min(size - 1, Math.max(0, (t.x - tx) * size - 0.5));
    const fy = Math.min(size - 1, Math.max(0, (t.y - ty) * size - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(size - 1, x0 + 1);
    const y1 = Math.min(size - 1, y0 + 1);
    const h = (px: number, py: number): number => {
      const i = (py * size + px) * 4;
      return decodeHeight(data[i], data[i + 1], data[i + 2]);
    };
    const ax = fx - x0;
    const ay = fy - y0;
    return h(x0, y0) * (1 - ax) * (1 - ay) + h(x1, y0) * ax * (1 - ay) + h(x0, y1) * (1 - ax) * ay + h(x1, y1) * ax * ay;
  });
}

/** Fill the nulls by interpolating between the nearest known heights; null if there is nothing known at all. */
export function fillGaps(v: (number | null)[]): number[] | null {
  const known = v.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);
  if (!known.length) return null;
  return v.map((x, i) => {
    if (x !== null) return x;
    const before = [...known].reverse().find((k) => k < i);
    const after = known.find((k) => k > i);
    if (before === undefined) return v[after!] as number;
    if (after === undefined) return v[before] as number;
    const t = (i - before) / (after - before);
    return (v[before] as number) * (1 - t) + (v[after] as number) * t;
  });
}

/** Moving average over 2*radius+1 samples (fewer at the ends). Terrain models are a little jagged. */
export function smooth(v: number[], radius = 1): number[] {
  return v.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(v.length - 1, i + radius); j += 1) { sum += v[j]; n += 1; }
    return sum / n;
  });
}

/** Total metres climbed and descended, ignoring wiggles smaller than `threshold` (peak and valley detection). */
export function climb(ele: number[], threshold = CLIMB_THRESHOLD_M): { ascent: number; descent: number } {
  if (ele.length < 2) return { ascent: 0, descent: 0 };
  let ascent = 0;
  let descent = 0;
  let trend = 0; // 1 rising, -1 falling, 0 not yet decided
  let start = ele[0]; // the last committed high or low
  let ext = ele[0]; // the highest (rising) or lowest (falling) height since
  for (let i = 1; i < ele.length; i += 1) {
    const e = ele[i];
    if (trend === 0) {
      if (e - start >= threshold) { trend = 1; ext = e; } else if (start - e >= threshold) { trend = -1; ext = e; }
    } else if (trend === 1) {
      if (e > ext) ext = e;
      else if (ext - e >= threshold) { ascent += ext - start; start = ext; trend = -1; ext = e; }
    } else if (e < ext) ext = e;
    else if (e - ext >= threshold) { descent += start - ext; start = ext; trend = 1; ext = e; }
  }
  if (trend === 1) ascent += ext - start;
  if (trend === -1) descent += start - ext;
  return { ascent, descent };
}

export interface Profile {
  km: number[];
  ele: number[];
  pos: Pos[];
  totalKm: number;
  ascent: number;
  descent: number;
  min: number;
  max: number;
  start: number;
  end: number;
  /** Tile zoom used and how many sample points had no terrain data (filled in from their neighbours). */
  zoom: number;
  gaps: number;
}

/** Sample the route every `step` km (including both ends) as { pos, km } with km = distance along, strokes joined without the gap. */
export function samplesAlong(lines: Lines, stepKm: number): { pos: Pos; km: number }[] {
  const total = totalKm(lines);
  if (!(stepKm > 0) || total === 0) return [];
  const start = lines.find((l) => l.length >= 2)![0];
  const out = [{ pos: start, km: 0 }];
  let done = 0;
  let next = stepKm;
  let last: Pos = start;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const len = segmentKm(a, b);
      while (len > 0 && next <= done + len + 1e-9 && next < total - 1e-9) {
        const t = Math.min(1, Math.max(0, (next - done) / len));
        out.push({ pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], km: next });
        next += stepKm;
      }
      done += len;
      if (len > 0) last = b;
    }
  }
  out.push({ pos: last, km: total });
  return out;
}

/** Where a distance along the route falls (clamped to the ends). */
export function pointAtKm(lines: Lines, km: number): Pos | null {
  let done = 0;
  let last: Pos | null = null;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const len = segmentKm(a, b);
      if (len > 0 && km <= done + len) {
        const t = Math.min(1, Math.max(0, (km - done) / len));
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      done += len;
      if (len > 0) last = b;
    }
  }
  return last ?? lines.find((l) => l.length)?.[0] ?? null;
}

export class ElevationError extends Error {}

/** Heights along the whole route, with climb. Throws ElevationError with a plain message when there is no terrain data. */
export async function buildProfile(lines: Lines, load: TileLoader): Promise<Profile> {
  const total = totalKm(lines);
  if (pointCount(lines) < 2 || total === 0) throw new ElevationError('Draw a route first.');
  const samples = samplesAlong(lines, Math.max(MIN_STEP_KM, total / MAX_SAMPLES));
  const points = samples.map((s) => s.pos);
  const zoom = chooseZoom(points);
  const raw = await elevationsAt(points, zoom, load);
  const filled = fillGaps(raw);
  if (!filled) throw new ElevationError('Terrain data could not be loaded for this area.');
  const ele = smooth(filled);
  const { ascent, descent } = climb(ele);
  return {
    km: samples.map((s) => s.km), ele, pos: points, totalKm: total, ascent, descent,
    min: Math.min(...ele), max: Math.max(...ele), start: ele[0], end: ele[ele.length - 1], zoom, gaps: raw.filter((x) => x === null).length,
  };
}

// ---- the real tile source ------------------------------------------------------------------------------------------------------

const loaders = new Map<string, TileLoader>();

/** Tiles from MapTiler with the browser key, decoded without any colour management (the pixels are numbers, not a picture). */
export function maptilerTiles(key: string): TileLoader {
  let loader = loaders.get(key);
  if (loader) return loader;
  const cache = new Map<string, Promise<TileData | null>>();
  const fetchTile = async (z: number, x: number, y: number): Promise<TileData | null> => {
    try {
      const res = await fetch(`https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      bmp.close();
      return { size: canvas.width, data };
    } catch { return null; }
  };
  loader = (z, x, y) => {
    const k = `${z}/${x}/${y}`;
    let p = cache.get(k);
    if (!p) {
      p = fetchTile(z, x, y).then((t) => { if (!t) cache.delete(k); return t; }); // a failure is tried again next time
      cache.set(k, p);
    }
    return p;
  };
  loaders.set(key, loader);
  return loader;
}
