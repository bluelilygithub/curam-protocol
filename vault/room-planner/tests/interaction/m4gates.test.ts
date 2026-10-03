// Test Plan §4, M4 gates: the 3D view as a renderer of the same project, driven by the same interaction engine.
// Everything runs in Node: a real three.js scene, a real perspective camera and ray casts, no WebGL.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { footprintOf, pickAll, type Fixture } from '../../src/engine';
import { presetCamera } from '../../src/render3d/cameraPresets';
import { Controller3D } from '../../src/render3d/controller3d';
import { Scene3D } from '../../src/render3d/Scene3D';
import { wallsToFade } from '../../src/render3d/wallFade';
import { makeDoor } from '../helpers';
import { inst, makeHarness, type Harness } from './harness';

const W = 1000;
const H = 700;
const sofa = (over = {}) => inst({ id: 'a', ...over });
const win = (over: Partial<Fixture> = {}): Fixture => ({ id: 'win', type: 'window', wallId: 'w2', offsetAlongWall: 2.5, width: 1.2, height: 1.2, elevation: 0.9, ...over });

interface Rig {
  h: Harness;
  scene: Scene3D;
  ctl: Controller3D;
  camera: THREE.PerspectiveCamera;
  orbit: boolean[];
  rebuilds: () => number;
  /** Screen position of a three-space point. */
  px(x: number, y: number, z: number): [number, number];
  click(x: number, y: number, z: number): void;
  drag(from: [number, number, number], to: [number, number, number], steps?: number): void;
  counts: { project: number; ui: number };
}

const rigs: Rig[] = [];
afterEach(() => { while (rigs.length) rigs.pop()!.scene.dispose(); });

function makeRig(opts: Parameters<typeof makeHarness>[0] = {}): Rig {
  const h = makeHarness(opts);
  h.ui.getState().setViewMode('3d');
  const scene = new Scene3D({ project: h.project, ui: h.ui, bus: h.bus, invalidate: () => {}, onAnimationDone: () => h.it.animationDone(), animateMs: 0 });
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 500);
  const c = presetCamera(h.room(), 'iso', null, { aspect: W / H, viewportW: W, viewportH: H });
  camera.position.set(...c.position);
  camera.lookAt(...c.target);
  camera.updateMatrixWorld(true);
  const orbit: boolean[] = [];
  const ctl = new Controller3D({ scene, interaction: h.it, ui: h.ui, camera: () => camera, size: () => ({ w: W, h: H }), setOrbitEnabled: (on) => orbit.push(on) });
  const counts = { project: 0, ui: 0 };
  h.project.subscribe(() => { counts.project++; });
  h.ui.subscribe(() => { counts.ui++; });
  const px = (x: number, y: number, z: number): [number, number] => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const mods = { shift: false, alt: false, ctrl: false };
  const rig: Rig = {
    h, scene, ctl, camera, orbit, counts, px,
    rebuilds: () => scene.rebuildCount,
    click(x, y, z) {
      const [sx, sy] = px(x, y, z);
      ctl.down(sx, sy, mods);
      ctl.up(sx, sy, mods);
    },
    drag(from, to, steps = 10) {
      const [ax, ay] = px(...from);
      const [bx, by] = px(...to);
      ctl.down(ax, ay, mods);
      for (let i = 1; i <= steps; i++) {
        h.clock.t += 16;
        ctl.move(ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps, mods);
      }
      ctl.up(bx, by, mods);
    },
  };
  rigs.push(rig);
  return rig;
}

describe('the 3D scene mirrors the project', () => {
  it('builds a floor, one material per wall, the fixtures and every furniture object', () => {
    const r = makeRig({ furniture: [sofa()], fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1 }), win()] });
    expect(r.scene.furnitureObject('a')).toBeDefined();
    expect(r.scene.fixtureObject('d')).toBeDefined();
    expect(r.scene.fixtureObject('win')).toBeDefined();
    for (const id of ['w1', 'w2', 'w3', 'w4']) expect(r.scene.wallMaterial(id)).toBeDefined();
    expect(r.scene.root.getObjectByName('floor')).toBeDefined();
  });

  it('a furniture model occupies exactly the engine footprint and height, at any rotation (axis mapping and rotation sign)', () => {
    const f = sofa({ rotation: (30 * Math.PI) / 180, position: { x: 2, y: 2.5 }, elevation: 0.1 });
    const r = makeRig({ furniture: [f] });
    const box = new THREE.Box3().setFromObject(r.scene.furnitureObject('a')!);
    const corners = footprintOf(r.h.inst('a'));
    expect(box.min.x).toBeCloseTo(Math.min(...corners.map((c) => c.x)), 5);
    expect(box.max.x).toBeCloseTo(Math.max(...corners.map((c) => c.x)), 5);
    expect(box.min.z).toBeCloseTo(Math.min(...corners.map((c) => c.y)), 5);
    expect(box.max.z).toBeCloseTo(Math.max(...corners.map((c) => c.y)), 5);
    expect(box.min.y).toBeCloseTo(0.1, 5);
    expect(box.max.y).toBeCloseTo(0.1 + 0.85, 5);
  });

  it('applies finish overrides by part name (C13): a walnut top on the coffee table', () => {
    const t = inst({ id: 't', definitionId: 'coffee-table', width: 1.2, length: 0.6, height: 0.42, position: { x: 2, y: 2 }, finishOverrides: { top: 'walnut' } });
    const r = makeRig({ furniture: [t] });
    const colours: string[] = [];
    r.scene.furnitureObject('t')!.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) colours.push(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()); });
    expect(colours).toContain('6b4a32');
  });

  it('tints an invalid object red and a clear one not at all', () => {
    const a = sofa({ id: 'a', position: { x: 2, y: 2 } });
    const b = sofa({ id: 'b', position: { x: 2.2, y: 2.1 } }); // overlaps a
    const c = inst({ id: 'c', definitionId: 'side-table', width: 0.5, length: 0.5, height: 0.55, position: { x: 3.5, y: 4.4 } });
    const r = makeRig({ furniture: [a, b, c] });
    const emissive = (id: string): string => {
      let hex = '';
      r.scene.furnitureObject(id)!.traverse((o) => { if (!hex && (o as THREE.Mesh).isMesh && o.visible) hex = ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.getHexString(); });
      return hex;
    };
    expect(emissive('a')).toBe('ef4444');
    expect(emissive('b')).toBe('ef4444');
    expect(emissive('c')).toBe('000000');
  });

  it('rebuilds only when the project changes, never on pointer moves (A12)', () => {
    const r = makeRig({ furniture: [sofa()] });
    const before = r.rebuilds();
    const [sx, sy] = r.px(1, 0, 1);
    for (let i = 0; i < 40; i++) r.ctl.move(sx + i, sy, { shift: false, alt: false, ctrl: false });
    expect(r.rebuilds()).toBe(before);
    r.h.project.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2.5 }, to: { x: 2, y: 3 } }, 'move');
    expect(r.rebuilds()).toBe(before + 1);
    expect(new THREE.Box3().setFromObject(r.scene.furnitureObject('a')!).getCenter(new THREE.Vector3()).z).toBeCloseTo(3, 5);
  });
});

describe('gate: selection in 3D is selection in 2D', () => {
  it('clicking a sofa in 3D selects the same ref a 2D click on it selects', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.click(2, 0.85, 2.5);
    const sel3d = r.h.ui.getState().selection;
    const h2 = makeHarness({ furniture: [sofa()] });
    h2.it.pointerDown(h2.ptr(2, 2.5));
    h2.it.pointerUp(h2.ptr(2, 2.5));
    expect(sel3d).toEqual([{ kind: 'furniture', id: 'a' }]);
    expect(sel3d).toEqual(h2.ui.getState().selection);
  });

  it('the pick list is depth-ordered and agrees with the plan pick on membership: a box on top of the sofa comes first, then the sofa', () => {
    const top = inst({ id: 'b', definitionId: 'side-table', width: 0.4, length: 0.4, height: 0.3, position: { x: 2, y: 2.5 }, elevation: 0.85 });
    const r = makeRig({ furniture: [sofa(), top] });
    const [sx, sy] = r.px(2, 1.15, 2.5);
    r.ctl['aim'](sx, sy);
    const refs = r.scene.pick(r.ctl['raycaster']);
    expect(refs.slice(0, 2)).toEqual([{ kind: 'furniture', id: 'b' }, { kind: 'furniture', id: 'a' }]);
    expect(pickAll(r.h.room(), { x: 2, y: 2.5 }).filter((x) => x.kind === 'furniture').map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('clicking the same spot again within 500 ms picks the next object deeper along the ray (B6)', () => {
    const top = inst({ id: 'b', definitionId: 'side-table', width: 0.4, length: 0.4, height: 0.3, position: { x: 2, y: 2.5 }, elevation: 0.85 });
    const r = makeRig({ furniture: [sofa(), top] });
    r.click(2, 1.15, 2.5);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'b' }]);
    r.h.clock.t += 200;
    r.click(2, 1.15, 2.5);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
    r.h.clock.t += 900; // window passed: back to the nearest
    r.click(2, 1.15, 2.5);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'b' }]);
  });

  it('a window is picked by its whole opening (not just the thin frame); the wall under the sill is the wall', () => {
    const r = makeRig({ furniture: [], fixtures: [win()] });
    r.click(4.075, 1.5, 2.5);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'fixture', id: 'win' }]);
    r.h.clock.t += 2000;
    r.click(4.075, 0.4, 2.5);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'wall', id: 'w2' }]);
  });

  it('selection survives a view switch and is drawn in 3D', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.click(2, 0.85, 2.5);
    expect(r.scene.selectionOutlineCount).toBe(1);
    r.h.it.switchView('2d');
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
    r.h.it.switchView('3d');
    expect(r.scene.selectionOutlineCount).toBe(1);
  });

  it('a selected object stays selected when something hides it (a faded wall in front, or a deeper pick)', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    r.scene.updateFade({ x: 12, y: 12 }, Math.PI / 3);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
  });
});

describe('gate: dragging furniture along the floor in 3D', () => {
  it('one drag = one MoveFurniture = one history entry; the elevation is untouched', () => {
    const r = makeRig({ furniture: [sofa({ elevation: 0.05 })] });
    r.drag([2, 0.9, 2.5], [2, 0.9, 3.5]);
    expect(r.h.pushes).toHaveLength(1);
    expect(r.h.pushes[0].command.type).toBe('MoveFurniture');
    expect(r.h.inst('a').position.y).toBeGreaterThan(3.4);
    expect(r.h.inst('a').position.y).toBeLessThan(3.6);
    expect(r.h.inst('a').elevation).toBe(0.05);
    expect(r.h.project.getState().historyLength()).toBe(1);
  });

  it('the object follows the pointer: grabbing the top of the sofa and moving by 1 m in plan moves the sofa 1 m (no sliding under the cursor)', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.drag([2, 0.85, 2.5], [2, 0.85, 3.5]);
    expect(r.h.inst('a').position.y).toBeCloseTo(3.5, 1);
    expect(Math.abs(r.h.inst('a').position.x - 2)).toBeLessThan(0.1);
  });

  it('orbiting is suspended for exactly the length of the drag', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.drag([2, 0.85, 2.5], [2, 0.85, 3]);
    expect(r.orbit).toEqual([false, true]);
  });

  it('a drag that starts on empty floor orbits instead: the camera is never taken, nothing changes, the selection is kept', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    r.drag([0.4, 0, 0.5], [1.4, 0, 0.9]);
    expect(r.orbit).toEqual([true, true]);
    expect(r.h.pushes).toHaveLength(0);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
  });

  it('a plain click on empty floor clears the selection', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    r.click(0.4, 0, 0.5);
    expect(r.h.ui.getState().selection).toEqual([]);
  });

  it('pointer moves during a drag cause zero project or UI store updates and no scene rebuilds, only feedback-bus publishes (A12)', () => {
    const r = makeRig({ furniture: [sofa()] });
    const [ax, ay] = r.px(2, 0.85, 2.5);
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.down(ax, ay, mods);
    const before = { p: r.counts.project, u: r.counts.ui, publishes: r.h.bus.publishCount, rebuilds: r.rebuilds() };
    for (let i = 1; i <= 30; i++) { r.h.clock.t += 16; r.ctl.move(ax, ay + i * 2, mods); }
    expect(r.counts.project).toBe(before.p);
    expect(r.counts.ui).toBe(before.u);
    expect(r.rebuilds()).toBe(before.rebuilds);
    expect(r.h.bus.publishCount).toBeGreaterThan(before.publishes);
    expect(r.scene.previewCount).toBe(1);
    expect(r.scene.furnitureObject('a')!.visible).toBe(false); // the committed copy is hidden while its preview is drawn
    r.ctl.up(ax, ay + 60, mods);
  });

  it('releasing in an invalid place commits nothing, animates back and restores the object', () => {
    const r = makeRig({ furniture: [sofa()] });
    const home = new THREE.Box3().setFromObject(r.scene.furnitureObject('a')!).getCenter(new THREE.Vector3());
    r.drag([2, 0.85, 2.5], [-1, 0.85, 2.5]);
    expect(r.h.pushes).toHaveLength(0);
    expect(r.scene.previewCount).toBe(0); // animation finished (0 ms in tests) and the preview cleared
    expect(r.scene.furnitureObject('a')!.visible).toBe(true);
    expect(new THREE.Box3().setFromObject(r.scene.furnitureObject('a')!).getCenter(new THREE.Vector3()).distanceTo(home)).toBeLessThan(1e-9);
    expect(r.h.inst('a').position).toEqual({ x: 2, y: 2.5 });
  });

  it('the drag shows the same constraint message as 2D when it overlaps another object', () => {
    const table = inst({ id: 'b', definitionId: 'coffee-table', width: 1.2, length: 0.6, height: 0.42, position: { x: 2, y: 4 } });
    const r = makeRig({ furniture: [sofa({ position: { x: 2, y: 1 } }), table] });
    const [ax, ay] = r.px(2, 0.85, 1);
    const [bx, by] = r.px(2, 0.85, 3.9);
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.down(ax, ay, mods);
    for (let i = 1; i <= 20; i++) { r.h.clock.t += 60; r.ctl.move(ax + ((bx - ax) * i) / 20, ay + ((by - ay) * i) / 20, mods); }
    expect(r.h.bus.get().message?.text).toBe('3-seat sofa overlaps Coffee table');
    r.ctl.up(bx, by, mods);
    expect(r.h.pushes).toHaveLength(0);
  });

  it('a locked object cannot be dragged: a message, no command', () => {
    const r = makeRig({ furniture: [sofa({ locked: true })] });
    r.drag([2, 0.85, 2.5], [2, 0.85, 3.5]);
    expect(r.h.pushes).toHaveLength(0);
    expect(r.h.ui.getState().status?.text).toBe('3-seat sofa is locked');
  });
});

describe('gate: switching 2D ↔ 3D', () => {
  it('mid-drag the drag is cancelled cleanly: no command, no history, the object restored, selection kept, camera store untouched', () => {
    const r = makeRig({ furniture: [sofa()] });
    const before = JSON.stringify(r.h.state());
    const [ax, ay] = r.px(2, 0.85, 2.5);
    const [bx, by] = r.px(2, 0.85, 3.2);
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.down(ax, ay, mods);
    for (let i = 1; i <= 8; i++) { r.h.clock.t += 16; r.ctl.move(ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8, mods); }
    expect(r.scene.previewCount).toBe(1);
    r.h.it.switchView('2d');
    expect(r.h.ui.getState().viewMode).toBe('2d');
    expect(r.h.pushes).toHaveLength(0);
    expect(r.h.project.getState().canUndo).toBe(false);
    expect(JSON.stringify(r.h.state())).toBe(before);
    expect(r.h.bus.get().previews).toEqual([]);
    expect(r.h.bus.get().hiddenIds).toEqual([]);
    expect(r.scene.furnitureObject('a')!.visible).toBe(true);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
    // the late pointer-up from the abandoned gesture must not commit anything
    r.ctl.up(bx, by, mods);
    expect(r.h.pushes).toHaveLength(0);
  });

  it('switching while placing from the library discards the ghost with no history (B7)', () => {
    const r = makeRig({ furniture: [] });
    r.h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'coffee-table' });
    const [sx, sy] = r.px(2, 0, 2);
    r.ctl.move(sx, sy, { shift: false, alt: false, ctrl: false });
    expect(r.scene.previewCount).toBe(1);
    r.h.it.switchView('2d');
    expect(r.h.ui.getState().placing).toBeNull();
    expect(r.scene.previewCount).toBe(0);
    expect(r.h.pushes).toHaveLength(0);
  });

  it('the V key toggles the view; 3D keeps only the Select tool and leaves the Walls tool on entry', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.h.it.switchView('2d');
    r.h.key('3');
    expect(r.h.ui.getState().tool).toBe('wall_edit');
    r.h.key('v');
    expect(r.h.ui.getState().viewMode).toBe('3d');
    expect(r.h.ui.getState().tool).toBe('select');
    r.h.key('3');
    r.h.key('2');
    r.h.key('4');
    expect(r.h.ui.getState().tool).toBe('select');
    r.h.key('v');
    expect(r.h.ui.getState().viewMode).toBe('2d');
  });

  it('Escape during a 3D drag cancels it (B7)', () => {
    const r = makeRig({ furniture: [sofa()] });
    const [ax, ay] = r.px(2, 0.85, 2.5);
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.down(ax, ay, mods);
    r.ctl.move(ax, ay + 40, mods);
    expect(r.scene.previewCount).toBe(1);
    r.h.key('Escape');
    expect(r.scene.previewCount).toBe(0);
    expect(r.h.pushes).toHaveLength(0);
    expect(r.scene.furnitureObject('a')!.visible).toBe(true);
  });
});

describe('placing from the library in 3D', () => {
  it('a furniture ghost follows the floor point and one click places it: one PlaceFurniture', () => {
    const r = makeRig({ furniture: [] });
    r.h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'coffee-table' });
    const [sx, sy] = r.px(2, 0, 2);
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.move(sx, sy, mods);
    expect(r.scene.previewCount).toBe(1);
    expect(r.ctl.down(sx, sy, mods)).toBe(true); // the click belongs to the editor, not the camera
    r.ctl.up(sx, sy, mods);
    expect(r.h.pushes.map((p) => p.command.type)).toEqual(['PlaceFurniture']);
    const placed = r.h.room().furniture[0];
    expect(placed.position.x).toBeCloseTo(2, 1);
    expect(placed.position.y).toBeCloseTo(2, 1);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'furniture', id: placed.id }]);
    expect(r.scene.previewCount).toBe(0);
  });

  it('a door ghost snaps to the wall nearest the pointer and one click places it', () => {
    const r = makeRig({ furniture: [] });
    r.h.ui.getState().startPlacing({ kind: 'fixture', definitionId: 'door-single' });
    const [sx, sy] = r.px(2, 0, 0.2);
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.move(sx, sy, mods);
    expect(r.scene.previewCount).toBe(1);
    r.ctl.down(sx, sy, mods);
    r.ctl.up(sx, sy, mods);
    expect(r.h.pushes.map((p) => p.command.type)).toEqual(['PlaceFixture']);
    expect(r.h.room().fixtures[0].wallId).toBe('w1');
  });

  it('placing in an invalid spot keeps the ghost and commits nothing', () => {
    const r = makeRig({ furniture: [sofa()] });
    r.h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'coffee-table' });
    const [sx, sy] = r.px(2, 0, 2.5); // inside the sofa
    const mods = { shift: false, alt: false, ctrl: false };
    r.ctl.move(sx, sy, mods);
    r.ctl.down(sx, sy, mods);
    r.ctl.up(sx, sy, mods);
    expect(r.h.pushes).toHaveLength(0);
    expect(r.h.ui.getState().placing).not.toBeNull();
  });
});

describe('wall fading while orbiting (A7)', () => {
  it('fades the walls between the camera and the room, makes them see-through to picks, and restores them from above', () => {
    const r = makeRig({ furniture: [sofa()], fixtures: [win()] });
    const c = r.camera.position;
    r.scene.updateFade({ x: c.x, y: c.z }, Math.acos(c.y / c.length()));
    const expected = wallsToFade(r.h.room(), { x: c.x, y: c.z }, Math.acos(c.y / c.length()));
    expect(expected.length).toBeGreaterThan(0);
    expect(r.scene.fadedWalls).toEqual(expected);
    for (const id of expected) {
      const m = r.scene.wallMaterial(id)!;
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeLessThan(0.2);
    }
    // a faded wall cannot be picked: the click goes through to what is behind it
    const wallsHit: string[] = [];
    r.ctl['aim'](...r.px(4.075, 0.4, 2.5));
    for (const ref of r.scene.pick(r.ctl['raycaster'])) if (ref.kind === 'wall') wallsHit.push(ref.id);
    for (const id of expected) expect(wallsHit).not.toContain(id);
    // looking straight down: nothing is faded and every wall is opaque again
    r.scene.updateFade({ x: 2, y: 2.5 }, 0);
    expect(r.scene.fadedWalls).toEqual([]);
    expect(r.scene.wallMaterial('w2')!.opacity).toBe(1);
    expect(r.scene.wallMaterial('w2')!.transparent).toBe(false);
  });

  it('a selected wall stays selected while faded and is shown highlighted', () => {
    const r = makeRig({ furniture: [] });
    r.h.ui.getState().select([{ kind: 'wall', id: 'w2' }]);
    r.scene.updateFade({ x: 12, y: 3 }, Math.PI / 3);
    expect(r.h.ui.getState().selection).toEqual([{ kind: 'wall', id: 'w2' }]);
    expect(r.scene.wallMaterial('w2')!.emissive.getHexString()).toBe('cc785c');
  });
});
