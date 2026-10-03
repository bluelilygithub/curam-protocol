// Spec Addition A2 (M4.6): the Realistic look inside Cinematic, against the real scene and stores (Node, no WebGL).
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { Fixture } from '../../src/engine';
import { createApp } from '../../src/createApp';
import { DEFAULT_FINISHES, SEED_MATERIALS } from '../../src/data/furnitureLibrary';
import { furnitureParts } from '../../src/render3d/furnitureParts';
import { fixtureModel } from '../../src/render3d/fixtureParts';
import { realisticLookOf } from '../../src/render3d/materials';
import { CLAY_COLOUR, Scene3D } from '../../src/render3d/Scene3D';
import { skirtingPieces } from '../../src/render3d/wallPieces';
import { makeDoor, makeRoom } from '../helpers';
import { inst, makeHarness, type Harness } from './harness';

const win = (over: Partial<Fixture> = {}): Fixture => ({ id: 'win', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9, ...over });

const scenes: Scene3D[] = [];
afterEach(() => { while (scenes.length) scenes.pop()!.dispose(); });

function rig(opts: Parameters<typeof makeHarness>[0] = {}): { h: Harness; scene: Scene3D } {
  const h = makeHarness(opts);
  h.ui.getState().setViewMode('3d');
  const scene = new Scene3D({ project: h.project, ui: h.ui, bus: h.bus, invalidate: () => {}, onAnimationDone: () => h.it.animationDone(), animateMs: 0 });
  scenes.push(scene);
  return { h, scene };
}
const meshes = (o: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.visible) out.push(c as THREE.Mesh); }); return out; };
const mats = (o: THREE.Object3D): THREE.MeshStandardMaterial[] => meshes(o).map((m) => m.material as THREE.MeshStandardMaterial);

describe('the realistic look', () => {
  it('is clay by default; Cinematic alone does not turn on textures', () => {
    const { h, scene } = rig({ furniture: [inst({ id: 'a' })] });
    expect(h.ui.getState().look).toBe('clay');
    h.ui.getState().setCinematic(true);
    for (const m of mats(scene.furnitureObject('a')!)) { expect(m.map).toBeNull(); expect(m.color.getHexString()).toBe(CLAY_COLOUR.slice(1)); }
  });

  it('gives furniture textured finishes: fabric weave on the sofa upholstery, wood on its legs, no problem tints', () => {
    const { h, scene } = rig({ furniture: [inst({ id: 'a' }), inst({ id: 'b', position: { x: 2.2, y: 2.6 } })] });
    h.ui.getState().setCinematic(true);
    h.ui.getState().setLook('realistic');
    const ms = mats(scene.furnitureObject('a')!);
    expect(ms.length).toBeGreaterThan(8);
    expect(ms.every((m) => m.map !== null)).toBe(true);
    expect(new Set(ms.map((m) => m.color.getHexString())).size).toBeGreaterThan(1);
    expect(ms.every((m) => m.emissive.getHexString() === '000000')).toBe(true);
  });

  it('textures the floor (planks) and walls (plaster) and adds skirting boards that are cut away with a cut-away wall', () => {
    const { h, scene } = rig({ furniture: [] });
    h.ui.getState().setCinematic(true);
    h.ui.getState().setLook('realistic');
    expect(((scene.root.getObjectByName('floor') as THREE.Mesh).material as THREE.MeshStandardMaterial).map).not.toBeNull();
    expect(scene.wallMaterial('w1')!.map).not.toBeNull();
    const skirting: THREE.Mesh[] = [];
    scene.root.traverse((o) => { if (o.name === 'skirting') skirting.push(o as THREE.Mesh); });
    expect(skirting.length).toBe(4);
  });

  it('switching back to clay (or off Cinematic) restores exactly the earlier look', () => {
    const { h, scene } = rig({ furniture: [inst({ id: 'a' })], fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1 }), win()] });
    const ordinary = mats(scene.furnitureObject('a')!).map((m) => m.color.getHexString());
    h.ui.getState().setCinematic(true);
    const clay = mats(scene.furnitureObject('a')!).map((m) => m.color.getHexString());
    h.ui.getState().setLook('realistic');
    h.ui.getState().setLook('clay');
    expect(mats(scene.furnitureObject('a')!).map((m) => m.color.getHexString())).toEqual(clay);
    expect(mats(scene.furnitureObject('a')!).every((m) => m.map === null)).toBe(true);
    h.ui.getState().setCinematic(false);
    expect(mats(scene.furnitureObject('a')!).map((m) => m.color.getHexString())).toEqual(ordinary);
    let skirting = 0;
    scene.root.traverse((o) => { if (o.name === 'skirting') skirting++; });
    expect(skirting).toBe(0);
  });

  it('changing look rebuilds once (not once per object)', () => {
    const { h, scene } = rig({ furniture: [inst({ id: 'a' })] });
    h.ui.getState().setCinematic(true);
    const before = scene.rebuildCount;
    h.ui.getState().setLook('realistic');
    expect(scene.rebuildCount).toBe(before + 1);
  });

  it('keeps ordinary-view behaviour when look is realistic but Cinematic is off', () => {
    const { h, scene } = rig({ furniture: [inst({ id: 'a' })] });
    h.ui.getState().setLook('realistic');
    expect(mats(scene.furnitureObject('a')!).every((m) => m.map === null)).toBe(true);
  });
});

describe('realistic finishes', () => {
  const noMats: never[] = [];

  it('every library item has default finishes pointing at real seed materials with textures', () => {
    for (const [id, finishes] of Object.entries(DEFAULT_FINISHES)) {
      for (const [role, mid] of Object.entries(finishes)) {
        const m = SEED_MATERIALS.find((x) => x.id === mid);
        expect(m, `${id}.${role} → ${mid}`).toBeDefined();
        expect(m!.texture, `${id}.${role}`).toBeDefined();
      }
    }
  });

  it('a designer finish override beats the default finish', () => {
    const part = { role: 'upholstery' as const };
    const dflt = realisticLookOf('sofa-3', part, undefined, []);
    const mine = realisticLookOf('sofa-3', part, { finishOverrides: { upholstery: 'leather-tan' } }, noMats);
    expect(mine.texture).toBe('leather');
    expect(mine.colour).not.toBe(dflt.colour);
    // a project's own material with the same id wins over the built-in one
    const custom = realisticLookOf('sofa-3', part, { finishOverrides: { upholstery: 'x' } }, [{ id: 'x', name: 'X', colour: '#123456', roughness: 0.5, metalness: 0 }]);
    expect(custom.colour).toBe('#123456');
    expect(custom.texture).toBeUndefined();
  });

  it('books take their own colour; glass stays glass', () => {
    const book = realisticLookOf('bookshelf', { role: 'accent', tint: '#8c3b2e' }, undefined, []);
    expect(book.colour).toBe('#8c3b2e');
    expect(realisticLookOf('bookshelf', { role: 'glass' }, undefined, []).opacity).toBeLessThan(1);
  });
});

describe('furniture shapes v2 and room details', () => {
  it('uses rounded boxes and tapered legs, and every part has positive extents and a sane radius', () => {
    const shapes = new Set<string>();
    for (const id of Object.keys(DEFAULT_FINISHES)) {
      for (const p of furnitureParts(id, 1.2, 0.7, 0.8)) {
        shapes.add(p.shape);
        for (const s of p.size) expect(s, `${id} ${p.role}`).toBeGreaterThan(0);
        if (p.shape === 'rbox') expect(p.radius!).toBeLessThan(Math.min(...p.size) / 2);
      }
    }
    expect(shapes.has('rbox')).toBe(true);
    expect(shapes.has('taper')).toBe(true);
  });

  it('a bookshelf holds books; a sofa has several cushions', () => {
    const books = furnitureParts('bookshelf', 1, 0.3, 2).filter((p) => p.tint);
    expect(books.length).toBeGreaterThan(10);
    const cushions = furnitureParts('sofa-3', 2.2, 0.95, 0.85).filter((p) => p.role === 'upholstery');
    expect(cushions.length).toBeGreaterThanOrEqual(8);
  });

  it('doors have panels and a handle; windows have a sill', () => {
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1, width: 0.9, height: 2.04 }), win()] });
    const door = fixtureModel(room, room.fixtures[0])!;
    expect(door.parts.filter((p) => p.role === 'door').length).toBe(3);
    expect(door.parts.filter((p) => p.role === 'handle').length).toBe(2);
    const window = fixtureModel(room, room.fixtures[1])!;
    expect(window.parts.some((p) => p.role === 'frame' && p.size[0] > 1.2)).toBe(true);
  });

  it('skirting stops at a door and runs under a window', () => {
    const room = makeRoom({ fixtures: [makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 2, width: 0.9, height: 2.04 }), win()] });
    const onW1 = skirtingPieces(room).filter((p) => p.wallId === 'w1');
    expect(onW1.length).toBe(2); // before and after the doorway
    expect(skirtingPieces(room).filter((p) => p.wallId === 'w2').length).toBe(1);
  });

  it('the look is a per-browser preference', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    const a = createApp(storage);
    a.setLook('realistic');
    expect(store.get('room-planner:look:v1')).toBe('realistic');
    const b = createApp(storage);
    expect(b.ui.getState().look).toBe('realistic');
  });
});
