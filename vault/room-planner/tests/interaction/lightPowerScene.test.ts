// Light power in the 3D scene: sliders retune the lights in place (no rebuild), and the Lights switch still works.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { LIGHT_EMITTERS } from '../../src/data/furnitureLibrary';
import { Scene3D } from '../../src/render3d/Scene3D';
import { withLightPower } from '../../src/render3d/lightPower';
import { inst, makeHarness } from './harness';

const scenes: Scene3D[] = [];
afterEach(() => { while (scenes.length) scenes.pop()!.dispose(); });
const lamps = (s: Scene3D): THREE.PointLight[] => { const out: THREE.PointLight[] = []; s.root.traverse((o) => { if ((o as THREE.PointLight).isPointLight) out.push(o as THREE.PointLight); }); return out; };
const sorted = (s: Scene3D): number[] => lamps(s).map((l) => l.intensity).sort((a, b) => a - b);
function rig() {
  const h = makeHarness({ furniture: [inst({ id: 'l', definitionId: 'ceiling-light', position: { x: 2, y: 2.5 }, width: 0.45, length: 0.45, height: 0.1, elevation: 2.6 }), inst({ id: 'f', definitionId: 'floor-lamp', position: { x: 3, y: 1 }, width: 0.35, length: 0.35, height: 1.65 })] });
  h.ui.getState().setViewMode('3d');
  h.ui.getState().setCinematic(true);
  h.ui.getState().setLook('realistic');
  const scene = new Scene3D({ project: h.project, ui: h.ui, bus: h.bus, invalidate: () => {}, onAnimationDone: () => h.it.animationDone(), animateMs: 0 });
  scenes.push(scene);
  return { h, scene };
}
const ceiling = LIGHT_EMITTERS['ceiling-light'].intensity;
const floor = LIGHT_EMITTERS['floor-lamp'].intensity;
const asc = (...v: number[]) => [...v].sort((a, b) => a - b);

describe('all-lights power', () => {
  it('dims and brightens every light without rebuilding the room', () => {
    const { h, scene } = rig();
    const rebuilds = scene.rebuildCount;
    expect(sorted(scene)).toEqual(asc(ceiling, floor));
    h.ui.getState().setLightPower(0.5);
    expect(sorted(scene)).toEqual(asc(ceiling * 0.5, floor * 0.5));
    h.ui.getState().setLightPower(2);
    expect(sorted(scene)).toEqual(asc(ceiling * 2, floor * 2));
    expect(scene.rebuildCount).toBe(rebuilds);
    h.ui.getState().setLightPower(0);
    expect(lamps(scene).every((l) => l.intensity === 0)).toBe(true);
  });
});

describe('one light has its own power', () => {
  it('retunes just that light in place, and multiplies with the all-lights power', () => {
    const { h, scene } = rig();
    const rebuilds = scene.rebuildCount;
    h.project.getState().updateSilently((p) => withLightPower(p, 'l', 2));
    expect(sorted(scene)).toEqual(asc(ceiling * 2, floor));
    expect(scene.rebuildCount).toBe(rebuilds);
    h.ui.getState().setLightPower(0.5);
    expect(sorted(scene)).toEqual(asc(ceiling, floor * 0.5));
  });
  it('a rebuild keeps both powers', () => {
    const { h, scene } = rig();
    h.ui.getState().setLightPower(0.5);
    h.project.getState().updateSilently((p) => withLightPower(p, 'f', 3));
    h.ui.getState().setLightsOn(false);
    h.ui.getState().setLightsOn(true);
    expect(sorted(scene)).toEqual(asc(ceiling * 0.5, floor * 0.5 * 3));
  });
  it('the Lights switch still removes and restores them', () => {
    const { h, scene } = rig();
    h.ui.getState().setLightsOn(false);
    expect(lamps(scene)).toHaveLength(0);
    h.ui.getState().setLightsOn(true);
    expect(lamps(scene)).toHaveLength(2);
  });
});
