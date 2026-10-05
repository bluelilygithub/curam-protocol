import { describe, expect, it } from 'vitest';
import { boxBlur3, scaleFor, tidyPixels } from '../src/state/tagScan';

const px = (rgbs: Array<[number, number, number]>): Uint8ClampedArray => Uint8ClampedArray.from(rgbs.flatMap(([r, g, b]) => [r, g, b, 255]));
const greyAt = (a: Uint8ClampedArray, i: number): number => a[i * 4];

describe('preparing a tag photo for reading', () => {
  it('shrinks a big phone photo, enlarges a small one (at most 2x), and leaves a sensible one alone', () => {
    expect(scaleFor(4000, 3000)).toBeCloseTo(0.45, 2);
    expect(scaleFor(800, 600)).toBe(2);
    expect(scaleFor(900, 600)).toBe(1);
    expect(scaleFor(1500, 1000)).toBe(1);
    expect(scaleFor(0, 0)).toBe(2);
  });

  it('turns the picture grey and stretches a washed-out tag to full contrast', () => {
    // dark grey text (120) on pale grey plastic (170): low contrast, as photographed
    const a = px([[120, 120, 120], [170, 170, 170], [170, 170, 170], [170, 170, 170], [120, 120, 120], [170, 170, 170], [170, 170, 170], [170, 170, 170], [170, 170, 170], [170, 170, 170]]);
    tidyPixels(a);
    expect(greyAt(a, 0)).toBeLessThan(40); // text goes dark
    expect(greyAt(a, 1)).toBeGreaterThan(215); // plastic goes light
    expect(Array.from(a).filter((_, i) => i % 4 === 3).every((x) => x === 255)).toBe(true);
    for (let i = 0; i < 10; i += 1) expect(a[i * 4]).toBe(a[i * 4 + 1]); // grey: r = g = b
  });

  it('turns colour to the grey a person would see (green weighs more than blue)', () => {
    const a = px([[0, 0, 255], [0, 255, 0], [255, 0, 0], [255, 255, 255]]);
    tidyPixels(a);
    expect(greyAt(a, 1)).toBeGreaterThan(greyAt(a, 2));
    expect(greyAt(a, 2)).toBeGreaterThan(greyAt(a, 0));
  });

  it('does not blow up the noise in a nearly flat image', () => {
    const a = px(Array.from({ length: 100 }, (_, i) => [128 + (i % 3), 128, 128] as [number, number, number]));
    tidyPixels(a);
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => greyAt(a, i))) - Math.min(...Array.from({ length: 100 }, (_, i) => greyAt(a, i)))).toBeLessThan(10);
  });

  it('a light blur takes grain out of a flat area but keeps a hard edge', () => {
    const w = 20, h = 20;
    const rgb: Array<[number, number, number]> = [];
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const base = x < 10 ? 60 : 200; const v = Math.round(base + (rnd() - 0.5) * 60); rgb.push([v, v, v]); }
    const grain = (a: Uint8ClampedArray, x0: number, x1: number): number => { const v: number[] = []; for (let y = 2; y < h - 2; y += 1) for (let x = x0; x < x1; x += 1) v.push(a[(y * w + x) * 4]); const m = v.reduce((s, q) => s + q, 0) / v.length; return Math.sqrt(v.reduce((s, q) => s + (q - m) ** 2, 0) / v.length); };
    const plain = px(rgb); tidyPixels(plain);
    const blurred = px(rgb); tidyPixels(blurred, w);
    expect(grain(blurred, 2, 7)).toBeLessThan(grain(plain, 2, 7) * 0.75);
    expect(greyAt(blurred, 5 * w + 3)).toBeLessThan(80); // dark side still dark
    expect(greyAt(blurred, 5 * w + 16)).toBeGreaterThan(175); // light side still light
  });

  it('box blur averages the 3x3 neighbourhood and copes with the edges', () => {
    const g = Uint8ClampedArray.from([0, 0, 0, 0, 90, 0, 0, 0, 0]);
    expect(Array.from(boxBlur3(g, 3))[4]).toBe(10);
    expect(Array.from(boxBlur3(Uint8ClampedArray.from([100, 100, 100, 100]), 2))).toEqual([100, 100, 100, 100]);
  });

  it('copes with an empty image', () => {
    const a = new Uint8ClampedArray(0);
    expect(() => tidyPixels(a)).not.toThrow();
  });
});
