// Own photos in picture frames (wall art stage 2), the table lamp, and lamps that glow only while the lights are on.
import { describe, expect, it } from 'vitest';
import { apply, inverse } from '../../src/engine/commands';
import { evaluateCommand, proposeUpdateFurniture } from '../../src/engine/pipeline';
import { FURNITURE_LIBRARY, LIGHT_EMITTERS } from '../../src/data/furnitureLibrary';
import { furnitureParts, partsBounds } from '../../src/render3d/furnitureParts';
import { realisticLookOf } from '../../src/render3d/materials';
import { addImage, fitSize, frameSizeFor, holdsPicture, imageOf, MAX_DATA_URL, MAX_IMAGES, pictureCommand, usedImageIds } from '../../src/state/pictures';
import { makeInstance, makeProject, makeRoom } from '../helpers';
import type { ProjectImage } from '../../src/engine/types';

const img = (n = 100): ProjectImage => ({ name: 'Holiday', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(n), width: 640, height: 480 });
const frame = (over = {}) => makeInstance({ id: 'f', definitionId: 'photo-frame', position: { x: 2, y: 4.985 }, width: 0.4, length: 0.03, height: 0.5, elevation: 1.4, ...over });
const project = (frames = [frame()]) => makeProject([makeRoom({ furniture: frames })], FURNITURE_LIBRARY);

describe('picture size rules', () => {
  it('shrinks to a longest side without enlarging', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 640, height: 480 });
    expect(fitSize(3000, 4000)).toEqual({ width: 480, height: 640 });
    expect(fitSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(fitSize(1, 5000).height).toBe(640);
    expect(fitSize(1, 5000).width).toBeGreaterThanOrEqual(1);
  });
  it('reshapes a frame to the photo, keeping its longer side', () => {
    expect(frameSizeFor(640, 480, 0.4, 0.5)).toEqual({ width: 0.5, height: 0.375 });
    expect(frameSizeFor(480, 640, 0.5, 0.4)).toEqual({ width: 0.375, height: 0.5 });
    expect(frameSizeFor(100, 100, 0.4, 0.5)).toEqual({ width: 0.5, height: 0.5 });
    expect(frameSizeFor(1000, 1, 0.4, 0.5).height).toBeGreaterThanOrEqual(0.15);
  });
  it('knows which pieces hold a replaceable picture (not mirrors)', () => {
    for (const id of ['art-landscape', 'art-abstract', 'art-arches', 'art-seascape', 'art-portrait', 'photo-frame']) expect(holdsPicture(id), id).toBe(true);
    for (const id of ['mirror-wall', 'mirror-round', 'sofa-3', 'rug-rect']) expect(holdsPicture(id), id).toBe(false);
  });
});

describe('storing photos in the project', () => {
  it('adds one to a project that had none', () => {
    const r = addImage(project(), 'i1', img());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.project.images!)).toEqual(['i1']);
  });
  it('drops photos no frame uses when another is added, keeps the ones in use', () => {
    const p0 = project([frame({ imageId: 'keep' })]);
    const withImages = { ...p0, images: { keep: img(), stale: img() } };
    const r = addImage(withImages, 'new', img());
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.project.images!).sort()).toEqual(['keep', 'new']);
    expect([...usedImageIds(withImages)]).toEqual(['keep']);
  });
  it('refuses a photo that is too big, or too many in use, with a plain message', () => {
    expect(addImage(project(), 'x', img(MAX_DATA_URL + 10))).toMatchObject({ ok: false });
    const frames = Array.from({ length: MAX_IMAGES }, (_, i) => frame({ id: `f${i}`, position: { x: 0.5 + i * 0.45, y: 4.985 }, imageId: `k${i}` }));
    const full = { ...project(frames), images: Object.fromEntries(frames.map((f, i) => [`k${i}`, img()])) };
    const r = addImage(full, 'one-more', img());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/up to 8 photos/);
  });
  it('finds the photo a frame shows, if it is still there', () => {
    const p = { ...project([frame({ imageId: 'a' })]), images: { a: img() } };
    expect(imageOf(p, p.rooms[0].furniture[0])?.name).toBe('Holiday');
    expect(imageOf(p, { imageId: 'gone' })).toBeUndefined();
    expect(imageOf(p, {})).toBeUndefined();
  });
});

describe('using a photo is one undoable step', () => {
  it('sets the photo and reshapes the frame together, and undo restores both', () => {
    const p = project();
    const command = pictureCommand(p.rooms[0].furniture[0], 'i1', { width: 0.5, height: 0.375 });
    expect(evaluateCommand(p, command, ['f']).ok).toBe(true);
    const after = apply(command, p);
    expect(after.rooms[0].furniture[0]).toMatchObject({ imageId: 'i1', width: 0.5, height: 0.375 });
    const back = apply(inverse(command), after);
    expect(back.rooms[0].furniture[0].width).toBeCloseTo(0.4, 9);
    expect(back.rooms[0].furniture[0].height).toBeCloseTo(0.5, 9);
    expect(back.rooms[0].furniture[0].imageId ?? null).toBeNull();
  });
  it('going back to the built-in picture clears it', () => {
    const p = project([frame({ imageId: 'i1' })]);
    const r = proposeUpdateFurniture(p, 'f', { imageId: null });
    expect(r.rejected).toBe(false);
    if (!r.rejected) expect(apply(r.command, p).rooms[0].furniture[0].imageId ?? null).toBeNull();
  });
  it('a frame that would grow into another piece is rejected', () => {
    const blocker = makeInstance({ id: 'b', definitionId: 'wardrobe', position: { x: 2.4, y: 4.7 }, width: 0.6, length: 0.6, height: 2.1 });
    const p = project([frame({ position: { x: 1.5, y: 4.985 } }), blocker]);
    expect(evaluateCommand(p, pictureCommand(p.rooms[0].furniture[0], 'i1', { width: 1.5, height: 0.5 }), ['f']).ok).toBe(false);
  });
});

describe('the photo frame piece and the table lamp', () => {
  it('the photo frame is wall art with a frame, mat and picture', () => {
    const d = FURNITURE_LIBRARY.find((x) => x.id === 'photo-frame')!;
    expect(d.category).toBe('wall art');
    expect(furnitureParts('photo-frame', d.defaultWidth, d.defaultLength, d.defaultHeight).map((p) => p.role)).toEqual(['frame', 'frame', 'frame', 'frame', 'fabric', 'picture']);
  });
  it('a photo replaces the built-in artwork in the realistic look', () => {
    const part = furnitureParts('photo-frame', 0.4, 0.03, 0.5).find((p) => p.role === 'picture')!;
    const look = realisticLookOf('photo-frame', part, undefined, [], undefined, true, { id: 'i1', dataUrl: 'data:x' });
    expect(look.photo).toEqual({ id: 'i1', dataUrl: 'data:x' });
    expect(look.art).toBeUndefined();
    expect(realisticLookOf('photo-frame', part, undefined, []).art).toBeDefined();
  });
  it('the table lamp settles on tables, is lighting, fills its envelope and emits light', () => {
    const d = FURNITURE_LIBRARY.find((x) => x.id === 'table-lamp')!;
    expect(d).toMatchObject({ category: 'lighting', settles: true });
    expect(LIGHT_EMITTERS['table-lamp'].intensity).toBeGreaterThan(0);
    const b = partsBounds(furnitureParts('table-lamp', d.defaultWidth, d.defaultLength, d.defaultHeight));
    expect(b.max[1]).toBeCloseTo(d.defaultHeight, 9);
    expect(b.min[1]).toBeCloseTo(0, 9);
  });
  it('bulbs and lampshades glow only while the lights are on', () => {
    for (const role of ['bulb', 'shade'] as const) {
      expect(realisticLookOf('table-lamp', { role }, undefined, [], undefined, true).glow, role).toBeDefined();
      expect(realisticLookOf('table-lamp', { role }, undefined, [], undefined, false).glow, role).toBeUndefined();
    }
  });
});
