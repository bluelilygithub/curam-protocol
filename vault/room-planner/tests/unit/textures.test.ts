// Generated textures (Spec Addition A2): deterministic, tileable, textured but not noisy, and well behaved as a multiplier.
import { describe, expect, it } from 'vitest';
import { FINISH_TEXTURES, generateTexture, isFinishTexture, TEXTURE_SPECS, type TextureKind } from '../../src/render3d/textureData';

const KINDS = Object.keys(TEXTURE_SPECS) as TextureKind[];
const px = (t: ReturnType<typeof generateTexture>, i: number, j: number): number => t.data[(j * t.width + i) * 4];
const stats = (t: ReturnType<typeof generateTexture>): { mean: number; sd: number; min: number; max: number } => {
  let s = 0, s2 = 0, min = 255, max = 0;
  const n = t.width * t.height;
  for (let k = 0; k < n; k++) { const v = t.data[k * 4]; s += v; s2 += v * v; min = Math.min(min, v); max = Math.max(max, v); }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), min, max };
};
/** Mean absolute difference between two columns (or rows) of pixels. */
const colDiff = (t: ReturnType<typeof generateTexture>, a: number, b: number): number => {
  let d = 0;
  for (let j = 0; j < t.height; j++) d += Math.abs(px(t, a, j) - px(t, b, j));
  return d / t.height;
};
const rowDiff = (t: ReturnType<typeof generateTexture>, a: number, b: number): number => {
  let d = 0;
  for (let i = 0; i < t.width; i++) d += Math.abs(px(t, i, a) - px(t, i, b));
  return d / t.width;
};

describe('generated textures', () => {
  it('have the declared size, opaque greyscale RGBA bytes', () => {
    for (const k of KINDS) {
      const t = generateTexture(k);
      expect(t.width, k).toBe(TEXTURE_SPECS[k].size);
      expect(t.height, k).toBe(TEXTURE_SPECS[k].size);
      expect(t.data.length, k).toBe(t.width * t.height * 4);
      for (let i = 0; i < t.data.length; i += 4 * 97) {
        expect(t.data[i]).toBe(t.data[i + 1]);
        expect(t.data[i]).toBe(t.data[i + 2]);
        expect(t.data[i + 3]).toBe(255);
      }
    }
  });

  it('are deterministic: the same kind, seed and size always give the same bytes; another seed gives different ones', () => {
    for (const k of KINDS) {
      const a = generateTexture(k, 7, 64);
      const b = generateTexture(k, 7, 64);
      expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)), k).toBe(0);
      const c = generateTexture(k, 8, 64);
      expect(Buffer.compare(Buffer.from(a.data), Buffer.from(c.data)), `${k} seed`).not.toBe(0);
    }
  });

  it('are detail maps: bright enough to multiply a colour (mean 0.75–1.0 of full scale), never black, never blown out to flat white', () => {
    for (const k of KINDS) {
      const s = stats(generateTexture(k));
      expect(s.mean, `${k} mean`).toBeGreaterThan(255 * 0.75);
      expect(s.mean, `${k} mean`).toBeLessThan(255 * 1.0);
      expect(s.min, `${k} min`).toBeGreaterThan(255 * (k === 'planks' ? 0.2 : 0.3)); // the seams between floor boards are deliberately dark
    }
  });

  it('have real texture: every kind varies, and the grains vary more than a painted surface', () => {
    const sd = (k: TextureKind): number => stats(generateTexture(k)).sd;
    for (const k of KINDS) expect(sd(k), k).toBeGreaterThan(0.8);
    for (const k of ['wood', 'planks', 'linen', 'leather'] as TextureKind[]) expect(sd(k), k).toBeGreaterThan(sd('paint') * 2);
  });

  it('tile without a seam: the join between the last and first column (and row) is no rougher than the roughest ordinary neighbours', () => {
    for (const k of KINDS) {
      const t = generateTexture(k);
      const n = t.width;
      let maxCol = 0, maxRow = 0;
      for (let a = 1; a < n - 2; a++) { maxCol = Math.max(maxCol, colDiff(t, a, a + 1)); maxRow = Math.max(maxRow, rowDiff(t, a, a + 1)); }
      expect(colDiff(t, n - 1, 0), `${k} columns`).toBeLessThanOrEqual(Math.max(maxCol * 1.5, 3));
      expect(rowDiff(t, n - 1, 0), `${k} rows`).toBeLessThanOrEqual(Math.max(maxRow * 1.5, 3));
    }
  });

  it('floor planks show boards: dark seams between rows of boards', () => {
    const t = generateTexture('planks', 1, 512);
    // a seam row is darker than the middle of a board, six times per tile
    let darker = 0;
    for (let b = 0; b < 6; b++) {
      const seamRow = Math.round((b / 6) * 512);
      const midRow = Math.round(((b + 0.5) / 6) * 512);
      let seam = 0, mid = 0;
      for (let i = 0; i < 512; i++) { seam += px(t, i, seamRow); mid += px(t, i, midRow); }
      if (seam < mid * 0.92) darker++;
    }
    expect(darker).toBeGreaterThanOrEqual(5);
  });

  it('linen is a regular weave: the pattern repeats every 4 pixels', () => {
    const t = generateTexture('linen', 1, 128);
    // the 2 × 2 basket cells alternate, so pixels 4 apart share their weave phase
    let phase = 0, off = 0;
    for (let j = 0; j < 124; j++) for (let i = 0; i < 124; i++) { phase += Math.abs(px(t, i, j) - px(t, i + 4, j)); off += Math.abs(px(t, i, j) - px(t, i + 2, j)); }
    expect(phase).toBeLessThan(off);
  });

  it('knows which kinds a designer can give a material', () => {
    expect([...FINISH_TEXTURES].sort()).toEqual(['leather', 'linen', 'metal', 'paint', 'wood']);
    expect(isFinishTexture('wood')).toBe(true);
    expect(isFinishTexture('planks')).toBe(false);
    expect(isFinishTexture(5)).toBe(false);
    expect(isFinishTexture(undefined)).toBe(false);
  });
});
