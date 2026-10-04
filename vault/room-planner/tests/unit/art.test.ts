// Wall art, stage 1 (M4.9): the built-in artworks, the picture and mirror pieces, and hanging height.
import { describe, expect, it } from 'vitest';
import { FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { ART_KINDS, artSize, generateArt } from '../../src/render3d/artData';
import { furnitureParts } from '../../src/render3d/furnitureParts';
import { realisticLookOf } from '../../src/render3d/materials';
import { glyphFor } from '../../src/render2d/glyphs';
import { validateRoom } from '../../src/engine/validation';
import { makeInstance, makeRoom } from '../helpers';

const ART_IDS = ['art-landscape', 'art-abstract', 'art-arches', 'art-seascape', 'art-portrait'];
const defs = FURNITURE_LIBRARY;

describe('built-in artworks', () => {
  it('are deterministic, opaque, in full colour and not flat', () => {
    for (const k of ART_KINDS) {
      const a = generateArt(k, 96, 64);
      const b = generateArt(k, 96, 64);
      expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)), k).toBe(0);
      expect(a.data.length).toBe(96 * 64 * 4);
      const colours = new Set<string>();
      let coloured = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        expect(a.data[i + 3]).toBe(255);
        colours.add(`${a.data[i] >> 4},${a.data[i + 1] >> 4},${a.data[i + 2] >> 4}`);
        if (Math.abs(a.data[i] - a.data[i + 2]) > 20) coloured++;
      }
      expect(colours.size, `${k} variety`).toBeGreaterThan(4); // the arches print is deliberately flat colour
      expect(coloured, `${k} colour`).toBeGreaterThan(a.data.length / 4 / 10);
    }
  });
  it('are drawn the right way up (sky above ground in the landscape)', () => {
    const a = generateArt('landscape', 64, 64);
    const px = (x: number, y: number) => [a.data[(y * 64 + x) * 4], a.data[(y * 64 + x) * 4 + 1], a.data[(y * 64 + x) * 4 + 2]];
    const top = px(10, 4);
    const bottom = px(10, 60);
    expect(top[2]).toBeGreaterThan(top[0]); // blue sky at the top
    expect(bottom[1]).toBeGreaterThan(bottom[2]); // green ground at the bottom
  });
  it('are sized to the picture: 256 on the long side, proportions kept', () => {
    expect(artSize(0.9, 0.6)).toEqual({ width: 256, height: 168 });
    expect(artSize(0.6, 0.8)).toEqual({ width: 192, height: 256 });
    expect(artSize(1, 1)).toEqual({ width: 256, height: 256 });
  });
});

describe('wall art pieces', () => {
  it('are in the "wall art" category with a hanging height and a thin depth', () => {
    for (const id of [...ART_IDS, 'mirror-wall', 'mirror-round']) {
      const d = defs.find((x) => x.id === id)!;
      expect(d.category, id).toBe('wall art');
      expect(d.defaultElevation, id).toBeGreaterThan(0.5);
      expect(d.defaultLength, id).toBeLessThanOrEqual(0.05);
      expect(d.defaultElevation! + d.defaultHeight, id).toBeLessThan(2.4);
    }
  });
  it('pictures have a frame, a mat and an artwork on the front face; mirrors have a mirror panel', () => {
    for (const id of ART_IDS) {
      const d = defs.find((x) => x.id === id)!;
      const parts = furnitureParts(id, d.defaultWidth, d.defaultLength, d.defaultHeight);
      expect(parts.map((p) => p.role), id).toEqual(['frame', 'frame', 'frame', 'frame', 'fabric', 'picture']);
      const pic = parts[5];
      expect(pic.art, id).toBeDefined();
      // the artwork lies inside the frame's depth and does not stick out of the front
      expect(pic.centre[2] + pic.size[2] / 2).toBeLessThanOrEqual(d.defaultLength / 2 + 1e-9);
    }
    expect(furnitureParts('mirror-wall', 0.8, 0.04, 1.2).some((p) => p.role === 'mirror')).toBe(true);
    expect(furnitureParts('mirror-round', 0.7, 0.04, 0.7).some((p) => p.role === 'mirror' && p.shape === 'cylinder')).toBe(true);
  });
  it('the realistic look gives a picture its artwork and a mirror a reflective surface', () => {
    const pic = furnitureParts('art-landscape', 0.9, 0.03, 0.6).find((p) => p.role === 'picture')!;
    const look = realisticLookOf('art-landscape', pic, undefined, []);
    expect(look.art).toMatchObject({ kind: 'landscape', width: 256 });
    const mirror = realisticLookOf('mirror-wall', { role: 'mirror' }, undefined, []);
    expect(mirror.metalness).toBeGreaterThan(0.8);
    expect(mirror.roughness).toBeLessThan(0.15);
  });
  it('have their own 2D drawing', () => {
    for (const id of [...ART_IDS, 'mirror-wall', 'mirror-round']) {
      const d = defs.find((x) => x.id === id)!;
      const g = glyphFor(id, d.defaultWidth, d.defaultLength);
      expect(g.shapes.length, id).toBeGreaterThan(1);
    }
  });
  it('hang above a sofa without a collision, but a picture low enough to touch it does collide', () => {
    const sofa = makeInstance({ id: 'sofa', definitionId: 'sofa-3', position: { x: 2, y: 4.5 }, width: 2.2, length: 0.95, height: 0.85 });
    const high = makeInstance({ id: 'art', definitionId: 'art-landscape', position: { x: 2, y: 4.985 }, width: 0.9, length: 0.03, height: 0.6, elevation: 1.3 });
    const low = { ...high, id: 'art2', elevation: 0.6 };
    expect(validateRoom(makeRoom({ furniture: [sofa, high] }), defs).violations.filter((v) => v.type === 'physical_collision')).toEqual([]);
    expect(validateRoom(makeRoom({ furniture: [sofa, low] }), defs).violations.some((v) => v.type === 'physical_collision')).toBe(true);
  });
});
