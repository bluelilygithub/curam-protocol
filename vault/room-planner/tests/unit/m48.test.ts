// M4.8: more library items (rugs, plants, lamp, mirror, seating, storage, beds), colour palettes, and the photo panel's expectation text.
import { describe, expect, it } from 'vitest';
import { apply, inverse } from '../../src/engine/commands';
import { validateRoom } from '../../src/engine/validation';
import { DEFAULT_FINISHES, FURNITURE_LIBRARY, SEED_MATERIALS } from '../../src/data/furnitureLibrary';
import { PALETTES, paletteOf } from '../../src/data/palettes';
import { glyphFor } from '../../src/render2d/glyphs';
import { furnitureParts, partsBounds } from '../../src/render3d/furnitureParts';
import { paletteColour, realisticLookOf } from '../../src/render3d/materials';
import { DEFAULT_SIZE_ID, INSIDE_FOV, ORBIT_FOV, PHOTO_EXPECTATIONS, PHOTO_TIPS, sizeById } from '../../src/render3d/photo';
import { withLibrary } from '../../src/state/projectStore';
import { makeDoor, makeInstance, makeProject, makeRoom } from '../helpers';
import type { Command } from '../../src/engine/types';

const defs = FURNITURE_LIBRARY;
const NEW_IDS = ['loveseat', 'ottoman', 'bench', 'office-chair', 'console-table', 'round-table', 'sideboard', 'dresser', 'bed-single', 'bed-king', 'plant-large', 'plant-small', 'floor-lamp', 'mirror-floor', 'rug-rect', 'rug-round', 'rug-runner'];

describe('the new library items', () => {
  it('are all in the library with a 3D model, default finishes and a 2D drawing', () => {
    for (const id of NEW_IDS) {
      const d = defs.find((x) => x.id === id);
      expect(d, id).toBeDefined();
      expect(DEFAULT_FINISHES[id], id).toBeDefined();
      expect(furnitureParts(id, d!.defaultWidth, d!.defaultLength, d!.defaultHeight).length, id).toBeGreaterThan(1);
      const g = glyphFor(id, d!.defaultWidth, d!.defaultLength);
      expect(g.shapes.length, id).toBeGreaterThan(1);
      // a drawing of its own, not the crossed-box fallback
      expect(g.shapes.some((s) => s.t === 'line' && s.weight === 'faint' && s.pts.length === 4 && Math.abs(s.pts[0] + s.pts[2]) < 1e-9 && Math.abs(s.pts[1] + s.pts[3]) < 1e-9 && s.pts[0] !== 0 && s.pts[1] !== 0), id).toBe(false);
    }
  });
  it('fit their envelope exactly at several sizes', () => {
    for (const id of NEW_IDS) {
      const d = defs.find((x) => x.id === id)!;
      for (const [sw, sl, sh] of [[1, 1, 1], [1.4, 0.8, 1.2], [0.7, 1.3, 0.9]]) {
        const w = d.defaultWidth * sw, l = d.defaultLength * sl, h = d.defaultHeight * sh;
        const b = partsBounds(furnitureParts(id, w, l, h));
        expect([b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]].map((v) => Number(v.toFixed(6)))).toEqual([-w / 2, w / 2, 0, h, -l / 2, l / 2].map((v) => Number(v.toFixed(6))));
      }
    }
  });
  it('every finish they name exists in the starter materials', () => {
    const ids = new Set(SEED_MATERIALS.map((m) => m.id));
    for (const id of NEW_IDS) for (const m of Object.values(DEFAULT_FINISHES[id])) expect(ids.has(m as string), `${id} ${m}`).toBe(true);
  });
  it('plants have foliage and a pot; the lamp has a shade; a mirror has a mirror panel; a single bed has one pillow, a double two', () => {
    const roles = (id: string) => furnitureParts(id, 0.5, 0.5, 1.4).map((p) => p.role);
    expect(roles('plant-large')).toEqual(expect.arrayContaining(['foliage', 'pot']));
    expect(furnitureParts('floor-lamp', 0.35, 0.35, 1.65).some((p) => p.role === 'shade')).toBe(true);
    expect(furnitureParts('mirror-floor', 0.7, 0.06, 1.7).some((p) => p.role === 'mirror')).toBe(true);
    const pillows = (id: string, w: number) => furnitureParts(id, w, 2.0, 0.9).filter((p) => p.role === 'fabric' && p.size[1] < 0.12 && p.size[1] > 0.05).length;
    expect(pillows('bed-single', 0.95)).toBe(1);
    expect(pillows('bed-king', 1.9)).toBe(2);
  });
});

describe('rugs lie on the floor', () => {
  const room = makeRoom({ furniture: [] });
  const rug = makeInstance({ id: 'rug', definitionId: 'rug-rect', position: { x: 2, y: 2.5 }, width: 2.4, length: 1.7, height: 0.015 });
  const sofa = makeInstance({ id: 'sofa', definitionId: 'sofa-3', position: { x: 2, y: 2.5 }, width: 2.2, length: 0.95, height: 0.85 });

  it('furniture may stand on a rug: no overlap or clearance finding', () => {
    const r = { ...room, furniture: [rug, sofa] };
    expect(validateRoom(r, defs).violations).toEqual([]);
  });
  it('but two sofas still overlap', () => {
    const sofa2 = { ...sofa, id: 'sofa2' };
    expect(validateRoom({ ...room, furniture: [sofa, sofa2] }, defs).valid).toBe(false);
  });
  it('a rug under a door swing is fine, and a rug must still stay inside the room', () => {
    const r = makeRoom({ furniture: [{ ...rug, position: { x: 1.2, y: 1.0 } }], fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1.2, width: 0.9, height: 2.04 })] });
    expect(validateRoom(r, defs).violations.filter((v) => v.type !== 'outside_room')).toEqual([]);
    const out = makeRoom({ furniture: [{ ...rug, position: { x: -3, y: 2 } }] });
    expect(validateRoom(out, defs).violations.some((v) => v.type === 'outside_room')).toBe(true);
  });
});

describe('colour palettes', () => {
  it('have unique ids, valid colours and a note', () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    expect(PALETTES.length).toBeGreaterThanOrEqual(6);
    for (const p of PALETTES) {
      for (const c of [p.wall, p.floor, p.trim, p.upholstery, p.wood, p.rug, p.rugAccent]) expect(c, p.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.note.length, p.id).toBeGreaterThan(5);
    }
    expect(paletteOf('coastal')?.name).toBe('Coastal');
    expect(paletteOf('nope')).toBeUndefined();
    expect(paletteOf(undefined)).toBeUndefined();
  });
  it('recolour fabric sofas, wood tops and rugs, but not dark legs, plants or metal', () => {
    const p = paletteOf('coastal')!;
    const linen = { id: 'grey-fabric', texture: 'linen' as const };
    const wood = { id: 'pale-oak', texture: 'wood' as const };
    expect(paletteColour(p, 'sofa-3', 'upholstery', linen)).toBe(p.upholstery);
    expect(paletteColour(p, 'coffee-table', 'top', wood)).toBe(p.wood);
    expect(paletteColour(p, 'coffee-table', 'leg', { id: 'dark-wood', texture: 'wood' })).toBeUndefined();
    expect(paletteColour(p, 'rug-rect', 'fabric', { id: 'x', texture: 'linen' })).toBe(p.rug);
    expect(paletteColour(p, 'rug-rect', 'accent', { id: 'x', texture: 'linen' })).toBe(p.rugAccent);
    expect(paletteColour(p, 'plant-large', 'foliage', { id: 'leaf-green', texture: 'paint' })).toBeUndefined();
    expect(paletteColour(p, 'desk', 'handle', { id: 'brushed-steel', texture: 'metal' })).toBeUndefined();
    expect(paletteColour(undefined, 'sofa-3', 'upholstery', linen)).toBeUndefined();
  });
  it('are applied through the realistic look, and a finish the designer chose wins', () => {
    const p = paletteOf('moody')!;
    const base = realisticLookOf('sofa-3', { role: 'upholstery' }, undefined, [], undefined).colour;
    expect(realisticLookOf('sofa-3', { role: 'upholstery' }, undefined, [], p).colour).toBe(p.upholstery);
    expect(realisticLookOf('sofa-3', { role: 'upholstery' }, undefined, [], p).colour).not.toBe(base);
    const mine = realisticLookOf('sofa-3', { role: 'upholstery' }, { finishOverrides: { upholstery: 'leather-tan' } }, [], p);
    expect(mine.colour).toBe('#a0623a');
  });

  const project = makeProject([makeRoom()]);
  const cmd = (to: object, from: object): Command => ({ type: 'UpdateRoom', roomId: 'room-1', from, to } as Command);
  it('choosing one is a single undoable command, and removing it works', () => {
    const c = cmd({ palette: 'coastal' }, { palette: null });
    const after = apply(c, project);
    expect(after.rooms[0].palette).toBe('coastal');
    expect(after.rooms[0].name).toBe(project.rooms[0].name);
    const back = apply(inverse(c), after);
    expect(back.rooms[0].palette).toBeUndefined();
    expect('palette' in back.rooms[0]).toBe(false);
    expect(apply(JSON.parse(JSON.stringify(c)) as Command, project).rooms[0].palette).toBe('coastal');
  });
  it('a rename keeps the palette, and a palette change keeps the name', () => {
    const withPalette = apply(cmd({ palette: 'sage' }, { palette: null }), project);
    const renamed = apply(cmd({ name: 'Lounge' }, { name: project.rooms[0].name }), withPalette);
    expect(renamed.rooms[0]).toMatchObject({ name: 'Lounge', palette: 'sage' });
  });
  it('rejects a malformed palette change', () => {
    expect(() => apply(cmd({ palette: 5 }, {}), project)).toThrow();
    expect(() => apply(cmd({}, {}), project)).toThrow();
    expect(() => apply(cmd({ name: ' ' }, {}), project)).toThrow();
  });
});

describe('older projects get the new library items', () => {
  it('a project saved with only the starter set still offers the new pieces, without changing the saved file', () => {
    const old = makeProject([makeRoom()], defs.slice(0, 12));
    const merged = withLibrary(old)!;
    expect(merged.furnitureDefinitions).toHaveLength(defs.length);
    expect(old.furnitureDefinitions).toHaveLength(12);
    expect(withLibrary(merged)).toBe(merged); // nothing missing: same object
    expect(withLibrary(null)).toBeNull();
  });
});

describe('Render photo expectation text', () => {
  it('tells people what the picture is and how long it takes, and gives tips', () => {
    expect(PHOTO_EXPECTATIONS).toMatch(/not a studio photograph/);
    expect(PHOTO_EXPECTATIONS).toMatch(/grainy/);
    expect(PHOTO_EXPECTATIONS).toMatch(/Draft/);
    expect(PHOTO_TIPS.length).toBeGreaterThanOrEqual(3);
  });
  it('defaults to 1280 × 720 and uses a wider lens inside the room', () => {
    expect(DEFAULT_SIZE_ID).toBe('hd');
    expect(sizeById('nope').width).toBe(1280);
    expect(INSIDE_FOV).toBeGreaterThan(ORBIT_FOV);
  });
});
