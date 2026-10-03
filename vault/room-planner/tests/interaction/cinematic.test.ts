// Spec Addition A1 (M4.5): the Cinematic look, Quality setting and fly-through controls, against the real scene and stores (Node, no WebGL).
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { addSavedView, deleteSavedView, type Fixture } from '../../src/engine';
import { createApp } from '../../src/createApp';
import { CLAY_AMBIENT, CLAY_COLOUR, CLAY_FLOOR_COLOUR, CLAY_SUN, Scene3D, SHADOW_MAP_BY_QUALITY } from '../../src/render3d/Scene3D';
import { makeDoor } from '../helpers';
import { inst, makeHarness, type Harness } from './harness';

const win = (over: Partial<Fixture> = {}): Fixture => ({ id: 'win', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9, ...over });
const sofa = (over = {}) => inst({ id: 'a', ...over });

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
const colours = (o: THREE.Object3D): string[] => meshes(o).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString());
const sun = (s: Scene3D): THREE.DirectionalLight => { let l!: THREE.DirectionalLight; s.root.traverse((o) => { if ((o as THREE.DirectionalLight).isDirectionalLight) l = o as THREE.DirectionalLight; }); return l; };
const ambient = (s: Scene3D): THREE.AmbientLight => { let l!: THREE.AmbientLight; s.root.traverse((o) => { if ((o as THREE.AmbientLight).isAmbientLight) l = o as THREE.AmbientLight; }); return l; };

describe('the clay look', () => {
  it('is off by default and does not change the ordinary 3D view', () => {
    const { h, scene } = rig({ furniture: [sofa()] });
    expect(h.ui.getState().cinematic).toBe(false);
    expect(colours(scene.furnitureObject('a')!)).toContain('8d949c'); // the sofa's own upholstery colour
    expect(sun(scene).intensity).toBeCloseTo(0.8 * Math.PI, 12);
  });

  it('turns every furniture part, wall and the floor into the same white matte clay (the floor a little darker)', () => {
    const { h, scene } = rig({ furniture: [sofa()], fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1 }), win()] });
    h.ui.getState().setCinematic(true);
    for (const id of ['a']) for (const c of colours(scene.furnitureObject(id)!)) expect(c).toBe(CLAY_COLOUR.slice(1));
    for (const w of ['w1', 'w2', 'w3', 'w4']) expect(scene.wallMaterial(w)!.color.getHexString()).toBe(CLAY_COLOUR.slice(1));
    expect(((scene.root.getObjectByName('floor') as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()).toBe(CLAY_FLOOR_COLOUR.slice(1));
    expect(((scene.root.getObjectByName('floor') as THREE.Mesh).material as THREE.MeshStandardMaterial).roughness).toBe(1);
  });

  it('keeps window glass a pale translucent pane so openings still read, and shows no problem tints', () => {
    const a = sofa({ id: 'a', position: { x: 2, y: 2 } });
    const b = sofa({ id: 'b', position: { x: 2.2, y: 2.1 } }); // overlapping: hard-invalid in the ordinary view
    const { h, scene } = rig({ furniture: [a, b], fixtures: [win()] });
    h.ui.getState().setCinematic(true);
    const glass = meshes(scene.fixtureObject('win')!).map((m) => m.material as THREE.MeshStandardMaterial).find((m) => m.transparent)!;
    expect(glass.opacity).toBeCloseTo(0.3, 12);
    for (const id of ['a', 'b']) for (const m of meshes(scene.furnitureObject(id)!)) expect((m.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('000000');
  });

  it('switching back restores the real finishes and the problem tints', () => {
    const a = sofa({ id: 'a', position: { x: 2, y: 2 } });
    const b = sofa({ id: 'b', position: { x: 2.2, y: 2.1 } });
    const { h, scene } = rig({ furniture: [a, b] });
    h.ui.getState().setCinematic(true);
    h.ui.getState().setCinematic(false);
    expect(colours(scene.furnitureObject('a')!)).toContain('8d949c');
    const first = meshes(scene.furnitureObject('a')!)[0].material as THREE.MeshStandardMaterial;
    expect(first.emissive.getHexString()).toBe('ef4444');
  });

  it('uses soft studio light levels, and ordinary (spec) levels again when off', () => {
    const { h, scene } = rig({ furniture: [] });
    h.ui.getState().setCinematic(true);
    expect(sun(scene).intensity).toBe(CLAY_SUN);
    expect(ambient(scene).intensity).toBe(CLAY_AMBIENT);
    h.ui.getState().setCinematic(false);
    expect(sun(scene).intensity).toBeCloseTo(0.8 * Math.PI, 12);
    expect(ambient(scene).intensity).toBeCloseTo(0.6 * Math.PI, 12);
  });

  it('never touches the project or its history: one scene rebuild per look change, nothing else', () => {
    const { h, scene } = rig({ furniture: [sofa()] });
    const project = h.state();
    const rebuilds = scene.rebuildCount;
    h.ui.getState().setCinematic(true);
    h.ui.getState().setQuality('high');
    h.ui.getState().setCinematic(false);
    expect(scene.rebuildCount).toBe(rebuilds + 3);
    expect(h.state()).toBe(project);
    expect(h.pushes).toHaveLength(0);
    expect(h.project.getState().canUndo).toBe(false);
  });
});

describe('Quality (default low)', () => {
  it('defaults to low, with a 1024 shadow map; high uses 2048', () => {
    const { h, scene } = rig({ furniture: [] });
    expect(h.ui.getState().quality).toBe('low');
    expect(sun(scene).shadow.mapSize.x).toBe(SHADOW_MAP_BY_QUALITY.low);
    h.ui.getState().setQuality('high');
    expect(sun(scene).shadow.mapSize.x).toBe(SHADOW_MAP_BY_QUALITY.high);
    expect(sun(scene).shadow.mapSize.y).toBe(2048);
    h.ui.getState().setQuality('low');
    expect(sun(scene).shadow.mapSize.x).toBe(1024);
  });

  it('is remembered per browser (not in the project), and an unreadable store falls back to low', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    const a = createApp(storage);
    expect(a.ui.getState().quality).toBe('low');
    a.setQuality('high');
    expect(store.get('room-planner:quality:v1')).toBe('high');
    expect(createApp(storage).ui.getState().quality).toBe('high');
    store.set('room-planner:quality:v1', 'ultra');
    expect(createApp(storage).ui.getState().quality).toBe('low');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => undefined };
    expect(createApp(broken).ui.getState().quality).toBe('low');
    expect(() => createApp(broken).setQuality('high')).not.toThrow();
  });
});

describe('cut-away walls in Cinematic', () => {
  const camera = { x: 12, y: 12 };
  it('removes the walls between the camera and the room (and their doors and windows) instead of fading them', () => {
    const { h, scene } = rig({ furniture: [sofa()], fixtures: [win(), makeDoor({ id: 'd', wallId: 'w1', offsetAlongWall: 1 })] });
    h.ui.getState().setCinematic(true);
    scene.updateFade(camera, Math.PI / 3);
    expect(scene.fadedWalls).toEqual(['w2', 'w3']);
    for (const id of ['w2', 'w3']) {
      const m = scene.wallMaterial(id)!;
      expect(m.visible).toBe(false);
      expect(m.opacity).toBe(1);
      expect(m.transparent).toBe(false);
    }
    expect(scene.wallMaterial('w1')!.visible).toBe(true);
    expect(scene.fixtureObject('win')!.visible).toBe(false); // the window is on the cut wall (w2)
    expect(scene.fixtureObject('d')!.visible).toBe(true); // the door is on w1, which stays
  });

  it('the ordinary view still fades them see-through, and keeps their openings', () => {
    const { h, scene } = rig({ furniture: [], fixtures: [win()] });
    scene.updateFade(camera, Math.PI / 3);
    const m = scene.wallMaterial('w2')!;
    expect(m.visible).toBe(true);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeLessThan(0.2);
    expect(scene.fixtureObject('win')!.visible).toBe(true);
    h.ui.getState().setCinematic(true); // switching look re-applies the rule
    expect(scene.wallMaterial('w2')!.visible).toBe(false);
    h.ui.getState().setCinematic(false);
    expect(scene.wallMaterial('w2')!.visible).toBe(true);
    expect(scene.wallMaterial('w2')!.opacity).toBeLessThan(0.2);
  });

  it('a camera inside the room cuts nothing away', () => {
    const { h, scene } = rig({ furniture: [], fixtures: [win()] });
    h.ui.getState().setCinematic(true);
    scene.updateFade({ x: 2, y: 2.5 }, Math.PI / 2.2);
    expect(scene.fadedWalls).toEqual([]);
    for (const w of ['w1', 'w2', 'w3', 'w4']) expect(scene.wallMaterial(w)!.visible).toBe(true);
  });
});

describe('Cinematic and fly-through state', () => {
  it('turning Cinematic off, or leaving 3D, stops the tour and leaves the presentation view', () => {
    const { h } = rig({ furniture: [] });
    const u = h.ui.getState();
    u.setCinematic(true);
    u.setTourPlaying(true);
    u.setImmersive(true);
    h.ui.getState().setCinematic(false);
    expect([h.ui.getState().tourPlaying, h.ui.getState().immersive, h.ui.getState().tourProgress]).toEqual([false, false, null]);
    h.ui.getState().setCinematic(true);
    h.ui.getState().setTourPlaying(true);
    h.ui.getState().setImmersive(true);
    h.it.switchView('2d');
    expect([h.ui.getState().tourPlaying, h.ui.getState().immersive]).toEqual([false, false]);
  });

  it('Space plays and pauses the tour in Cinematic 3D, and does nothing otherwise', () => {
    const { h } = rig({ furniture: [] });
    h.key(' ');
    expect(h.ui.getState().tourPlaying).toBe(false); // not cinematic
    h.ui.getState().setCinematic(true);
    h.key(' ');
    expect(h.ui.getState().tourPlaying).toBe(true);
    h.key(' ');
    expect(h.ui.getState().tourPlaying).toBe(false);
  });

  it('Esc pauses a playing tour and leaves full screen; Esc in the presentation view while paused only leaves it', () => {
    const { h } = rig({ furniture: [] });
    const u = h.ui.getState();
    u.setCinematic(true);
    u.setImmersive(true);
    u.setTourPlaying(true);
    h.key('Escape');
    expect([h.ui.getState().tourPlaying, h.ui.getState().immersive]).toEqual([false, false]);
    h.ui.getState().setImmersive(true);
    h.key('Escape');
    expect(h.ui.getState().immersive).toBe(false);
  });

  it('while the tour plays no key edits the design: Delete, R, arrows, undo and redo are ignored', () => {
    const { h } = rig({ furniture: [sofa()] });
    h.ui.getState().setCinematic(true);
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.project.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2.5 }, to: { x: 2, y: 2.6 } }, 'move');
    const before = JSON.stringify(h.state());
    h.ui.getState().setTourPlaying(true);
    for (const k of ['Delete', 'r', 'ArrowUp', 'v']) h.key(k);
    h.key('z', { ctrl: true });
    h.key('y', { ctrl: true });
    expect(JSON.stringify(h.state())).toBe(before);
    expect(h.project.getState().canUndo).toBe(true);
    expect(h.ui.getState().viewMode).toBe('3d');
  });

  it('the tour summary says what it will visit: automatic, one saved view plus automatic, or saved views', () => {
    const store = new Map<string, string>();
    const app = createApp({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } });
    expect(app.tourSummary()).toBeNull(); // no room yet
    app.startRectangle();
    expect(app.tourSummary()).toMatchObject({ source: 'automatic' });
    const auto = app.tourSummary()!.stops;
    expect(auto).toBeGreaterThanOrEqual(3);
    const view = { id: 'v1', cameraPosition: [8, 7, 9] as [number, number, number], target: [2, 1, 2.5] as [number, number, number], projection: 'perspective' as const };
    app.project.getState().updateSilently((p) => addSavedView(p, view));
    expect(app.tourSummary()).toMatchObject({ source: 'saved view + automatic' });
    app.project.getState().updateSilently((p) => addSavedView(p, { ...view, id: 'v2' }));
    expect(app.tourSummary()).toEqual({ stops: 2, source: 'saved views' });
    app.project.getState().updateSilently((p) => deleteSavedView(deleteSavedView(p, 'v1'), 'v2'));
    expect(app.tourSummary()).toMatchObject({ source: 'automatic' });
  });
});
