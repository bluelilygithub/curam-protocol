// Generated textures for the Realistic look (Spec Addition A2, decision 3): no image files, so no licence question, and the pixels are
// a pure function of (kind, seed, size). Planks and plaster are for the floor and walls; the other kinds are what a designer can give a material. Each texture is a greyscale DETAIL map (values about 0.75–1.0) that multiplies the finish's
// colour, and doubles as the bump map. All noise is periodic, so every texture tiles without a seam. No three.js here.

import type { FinishTexture } from '../engine/types';

export type TextureKind = 'wood' | 'planks' | 'linen' | 'leather' | 'metal' | 'plaster' | 'paint';
export type { FinishTexture };

export interface TextureSpec {
  /** Pixels per side. */
  size: number;
  /** Metres of surface covered by one tile (box-projected UVs are in metres). */
  tile: number;
  /** Bump strength for the material. */
  bump: number;
}

export const TEXTURE_SPECS: Record<TextureKind, TextureSpec> = {
  wood: { size: 256, tile: 0.7, bump: 0.35 },
  planks: { size: 512, tile: 1.2, bump: 0.5 },
  linen: { size: 128, tile: 0.14, bump: 0.9 },
  leather: { size: 256, tile: 0.3, bump: 0.7 },
  metal: { size: 256, tile: 0.4, bump: 0.2 },
  plaster: { size: 256, tile: 1.2, bump: 0.35 },
  paint: { size: 128, tile: 1.0, bump: 0.08 },
};

export interface RawTexture { width: number; height: number; data: Uint8ClampedArray }

/** Deterministic hash of an integer lattice point to [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise at (x, y) in cell units, repeating every `px` × `py` cells. */
function noise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ix0 = ((x0 % px) + px) % px;
  const iy0 = ((y0 % py) + py) % py;
  const ix1 = (ix0 + 1) % px;
  const iy1 = (iy0 + 1) % py;
  const a = hash(ix0, iy0, seed);
  const b = hash(ix1, iy0, seed);
  const c = hash(ix0, iy1, seed);
  const d = hash(ix1, iy1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

type Sampler = (u: number, v: number, i: number, j: number, size: number) => number;

function build(size: number, f: Sampler): RawTexture {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const g = Math.round(clamp01(f(i / size, j / size, i, j, size)) * 255);
      const o = (j * size + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = g;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Wood grain: long wavy rings along u, with fine pores. */
function wood(u: number, v: number, seed: number): number {
  const warp = noise(u * 4, v * 3, 4, 3, seed) * 0.9 + noise(u * 12, v * 8, 12, 8, seed + 1) * 0.25;
  const ring = Math.sin(2 * Math.PI * (v * 12 + warp * 2.4));
  const pores = noise(u * 64, v * 6, 64, 6, seed + 2);
  return 0.84 + 0.07 * ring + 0.06 * (pores - 0.5) + 0.04 * (noise(u * 2, v * 2, 2, 2, seed + 3) - 0.5);
}

const generators: Record<TextureKind, (seed: number, size: number) => RawTexture> = {
  wood: (seed, size) => build(size, (u, v) => wood(u, v, seed)),

  // floor boards: 6 boards across the tile, each its own tone and grain, dark seams, staggered end joints
  planks: (seed, size) => build(size, (u, v) => {
    const boards = 6;
    const row = Math.floor(v * boards);
    const local = v * boards - row;
    const tone = 0.9 + 0.1 * (hash(row, 0, seed) - 0.5);
    const joint = hash(row, 1, seed); // where this board ends along u
    const board = Math.floor(((u + joint) % 1 + 1) % 1 * 2); // two boards per row per tile
    const t2 = tone * (0.96 + 0.08 * hash(row, 2 + board, seed));
    let g = wood((u + joint * 0.5) % 1, (v * boards) % 1, seed + row * 7 + board) * t2;
    const seamV = Math.min(local, 1 - local);
    if (seamV < 0.025) g *= 0.55 + 0.45 * (seamV / 0.025); // the long gap between boards
    const seamU = Math.min(((u + joint) % 0.5) , 0.5 - ((u + joint) % 0.5));
    if (seamU < 0.004) g *= 0.6 + 0.4 * (seamU / 0.004); // the short joint at the end of a board
    return g;
  }),

  // linen/fabric weave: a basket weave every 4 pixels with slubs
  linen: (seed, size) => build(size, (u, v, i, j) => {
    const cell = ((i >> 1) + (j >> 1)) & 1;
    const thread = cell ? 0.07 : -0.07;
    const slub = noise(u * 16, v * 16, 16, 16, seed) - 0.5;
    return 0.86 + thread + 0.07 * slub + 0.03 * (noise(u * 64, v * 64, 64, 64, seed + 1) - 0.5);
  }),

  // leather: a pebbled grain
  leather: (seed, size) => build(size, (u, v) => {
    const a = noise(u * 36, v * 36, 36, 36, seed);
    const b = noise(u * 72, v * 72, 72, 72, seed + 1);
    const cells = Math.abs(a - 0.5) * 2; // ridges between pebbles
    return 0.82 + 0.1 * (1 - cells) * (0.7 + 0.3 * b) + 0.04 * (noise(u * 6, v * 6, 6, 6, seed + 2) - 0.5);
  }),

  // brushed metal: fine streaks along u
  metal: (seed, size) => build(size, (u, v) => 0.86 + 0.1 * (noise(u * 3, v * 96, 3, 96, seed) - 0.5) + 0.05 * (noise(u * 12, v * 200, 12, 200, seed + 1) - 0.5)),

  // plaster / render: an orange-peel stipple
  plaster: (seed, size) => build(size, (u, v) => 0.94 + 0.05 * (noise(u * 80, v * 80, 80, 80, seed) - 0.5) + 0.03 * (noise(u * 9, v * 9, 9, 9, seed + 1) - 0.5)),

  // painted surface: almost flat, a hint of roller texture
  paint: (seed, size) => build(size, (u, v) => 0.975 + 0.02 * (noise(u * 48, v * 48, 48, 48, seed) - 0.5)),
};

/** The pixels of a texture. Deterministic: the same arguments always give the same bytes. */
export function generateTexture(kind: TextureKind, seed = 1, size = TEXTURE_SPECS[kind].size): RawTexture {
  return generators[kind](seed, size);
}

export const FINISH_TEXTURES: FinishTexture[] = ['wood', 'linen', 'leather', 'metal', 'paint'];
export const isFinishTexture = (v: unknown): v is FinishTexture => typeof v === 'string' && (FINISH_TEXTURES as string[]).includes(v);
