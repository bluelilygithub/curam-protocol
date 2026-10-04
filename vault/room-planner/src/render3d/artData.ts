// Built-in artworks for the wall-art pieces (M4.9, stage 1): small generated pictures, so no image files and no licences. Each is a pure
// function of (kind, width, height): same inputs, same pixels. Colour RGBA, not the greyscale detail maps in textureData.ts. No three.js here.
export type ArtKind = 'landscape' | 'abstract' | 'arches' | 'seascape' | 'portrait';
export const ART_KINDS: ArtKind[] = ['landscape', 'abstract', 'arches', 'seascape', 'portrait'];

export interface RawArt { width: number; height: number; data: Uint8ClampedArray }

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

function hash(x: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Colour of the picture at (u, v), both 0–1, v up. `ar` = width / height. */
type Painter = (u: number, v: number, ar: number) => RGB;

const SKY_TOP = hex('#7fb0dc');
const SKY_LOW = hex('#f4dcb6');

const landscape: Painter = (u, v) => {
  let c = mix(SKY_LOW, SKY_TOP, smooth(0.35, 1, v));
  const sun = Math.hypot((u - 0.72) * 1.4, v - 0.62);
  c = mix(c, hex('#fff1c9'), 1 - smooth(0.07, 0.1, sun));
  c = mix(c, hex('#ffe2a6'), (1 - smooth(0.1, 0.3, sun)) * 0.35);
  const ridge = (base: number, amp: number, f: number, ph: number): number => base + amp * Math.sin(u * f + ph) + amp * 0.5 * Math.sin(u * f * 2.3 + ph * 1.7);
  const layers: Array<[number, number, number, number, string]> = [
    [0.5, 0.05, 5, 0.4, '#a7b7c9'], [0.38, 0.06, 6.5, 2.1, '#6f8f8a'], [0.27, 0.05, 8, 4.0, '#4f7a5a'], [0.14, 0.04, 9, 1.2, '#36553f'],
  ];
  for (const [b, a, f, p, col] of layers) c = mix(c, hex(col), smooth(-0.004, 0.004, ridge(b, a, f, p) - v));
  return c;
};

const abstract: Painter = (u, v, ar) => {
  let c = hex('#ebe3d4');
  const palette = ['#c4694a', '#d9a441', '#2f6f73', '#243b5a', '#e8d5b5', '#8a9a6b'].map(hex);
  for (let i = 0; i < 7; i++) {
    const cx = hash(i, 11) * 0.8 + 0.1;
    const cy = hash(i, 23) * 0.8 + 0.1;
    const r = 0.1 + hash(i, 37) * 0.2;
    const col = palette[Math.floor(hash(i, 51) * palette.length)];
    const d = Math.hypot((u - cx) * ar, v - cy);
    const rectLike = Math.max(Math.abs((u - cx) * ar), Math.abs(v - cy));
    const m = hash(i, 63) > 0.5 ? 1 - smooth(r - 0.004, r + 0.004, d) : 1 - smooth(r * 0.9 - 0.004, r * 0.9 + 0.004, rectLike);
    c = mix(c, col, m * 0.95);
  }
  // a thin line across the composition
  const stripe = Math.abs(v - (0.25 + 0.5 * u)) < 0.006 ? 1 : 0;
  return mix(c, hex('#1d2430'), stripe * 0.85);
};

const arches: Painter = (u, v, ar) => {
  let c = hex('#f1e8d9');
  const cols = ['#c98a6b', '#e1b98f', '#9aa88a', '#d9cdb4'].map(hex);
  const x = (u - 0.5) * ar;
  // nested arches, outermost first: a rectangle below the centre line topped by a half circle
  for (let i = 0; i < cols.length; i++) {
    const r = 0.46 - i * 0.1;
    const cy = 0.08 + r;
    const inArch = Math.abs(x) <= r && (v <= cy ? v >= 0.08 : Math.hypot(x, v - cy) <= r);
    if (inArch) c = cols[i];
  }
  return c;
};

const seascape: Painter = (u, v) => {
  const horizon = 0.5;
  if (v > horizon) {
    const t = (v - horizon) / (1 - horizon);
    let c = mix(hex('#f8d9b0'), hex('#8cb9e0'), smooth(0, 1, t));
    const sun = Math.hypot((u - 0.35) * 1.5, v - 0.62);
    c = mix(c, hex('#fff3d2'), 1 - smooth(0.05, 0.07, sun));
    return c;
  }
  const t = (horizon - v) / horizon;
  let c = mix(hex('#6aa5c8'), hex('#1f4e72'), smooth(0, 1, t));
  const glint = Math.exp(-Math.pow((u - 0.35) * 9, 2)) * (0.55 + 0.45 * Math.sin(v * 160)) * (1 - t);
  c = mix(c, hex('#fff0cc'), clamp01(glint) * 0.7);
  return c;
};

const portrait: Painter = (u, v) => {
  let c = mix(hex('#d9c7ae'), hex('#b9a58c'), smooth(0, 1, v));
  const cx = 0.5;
  // head and shoulders silhouette against a soft backdrop
  const head = Math.hypot((u - cx) * 1.1, (v - 0.6) * 1.0) < 0.17 ? 1 : 0;
  const shoulders = v < 0.42 && Math.abs(u - cx) < 0.12 + (0.42 - v) * 0.9 ? 1 : 0;
  const neck = Math.abs(u - cx) < 0.05 && v > 0.38 && v < 0.5 ? 1 : 0;
  c = mix(c, hex('#4a3d35'), Math.max(head, shoulders, neck) * 0.9);
  const vig = Math.hypot(u - 0.5, v - 0.5);
  return mix(c, hex('#2b231d'), smooth(0.35, 0.75, vig) * 0.55);
};

const PAINTERS: Record<ArtKind, Painter> = { landscape, abstract, arches, seascape, portrait };

/** The pixels of an artwork at the given size. Deterministic. */
export function generateArt(kind: ArtKind, width: number, height: number): RawArt {
  const paint = PAINTERS[kind];
  const data = new Uint8ClampedArray(width * height * 4);
  const ar = width / height;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const [r, g, b] = paint((i + 0.5) / width, 1 - (j + 0.5) / height, ar); // image rows run top to bottom, v runs up
      const o = (j * width + i) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Texture size for a picture of the given proportions: 256 px on the longer side. */
export function artSize(w: number, h: number): { width: number; height: number } {
  const long = 256;
  const ar = w / h;
  return ar >= 1 ? { width: long, height: Math.max(16, Math.round(long / ar / 8) * 8) } : { width: Math.max(16, Math.round(long * ar / 8) * 8), height: long };
}
