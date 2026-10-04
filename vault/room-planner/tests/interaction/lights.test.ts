// Ceiling lights (M4.10): they hang from the ceiling and light the room in the Realistic look.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { FURNITURE_LIBRARY, LIGHT_EMITTERS } from '../../src/data/furnitureLibrary';
import { furnitureParts } from '../../src/render3d/furnitureParts';
import { Scene3D } from '../../src/render3d/Scene3D';
import { inst, makeHarness, type Harness } from './harness';

const scenes: Scene3D[] = [];
afterEach(() => { while (scenes.length) scenes.pop()!.dispose(); });
function rig(furniture = [inst({ id: 'l', definitionId: 'ceiling-light', position: { x: 2, y: 2.5 }, width: 0.45, length: 0.45, height: 0.1, elevation: 2.6 })]): { h: Harness; scene: Scene3D } {
  const h = makeHarness({ furniture });
  h.ui.getState().setViewMode('3d');
  const scene = new Scene3D({ project: h.project, ui: h.ui, bus: h.bus, invalidate: () => {}, onAnimationDone: () => h.it.animationDone(), animateMs: 0 });
  scenes.push(scene);
  return { h, scene };
}
const lights = (s: Scene3D): THREE.PointLight[] => { const out: THREE.PointLight[] = []; s.root.traverse((o) => { if ((o as THREE.PointLight).isPointLight) out.push(o as THREE.PointLight); }); return out; };
const glowing = (s: Scene3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; s.root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if ((o as THREE.Mesh).isMesh && (m?.emissiveIntensity ?? 0) > 1) out.push(o as THREE.Mesh); }); return out; };

describe('ceiling light pieces', () => {
  it('are in the library as ceiling-mounted lighting, with a model that fills its envelope and a glowing diffuser', () => {
    for (const id of ['ceiling-light', 'pendant-light', 'downlight']) {
      const d = FURNITURE_LIBRARY.find((x) => x.id === id)!;
      expect(d.category).toBe('lighting');
      expect(d.mount).toBe('ceiling');
      expect(LIGHT_EMITTERS[id].intensity).toBeGreaterThan(0);
      expect(furnitureParts(id, d.defaultWidth, d.defaultLength, d.defaultHeight).some((p) => p.role === 'bulb')).toBe(true);
    }
  });
  it('start hanging from the ceiling whatever its height', () => {
    const h = makeHarness({ furniture: [], room: { ceilingHeight: 3.0, wallHeight: 3.0 } });
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'pendant-light' });
    h.it.pointerMove(h.ptr(2, 2.5));
    h.it.pointerDown(h.ptr(2, 2.5));
    const p = h.room().furniture[0];
    expect(p.elevation + p.height).toBeCloseTo(3.0, 3);
  });
});

describe('light in the scene', () => {
  it('a ceiling light lights the room in the Realistic look, and its diffuser glows', () => {
    const { h, scene } = rig();
    h.ui.getState().setCinematic(true);
    h.ui.getState().setLook('realistic');
    const l = lights(scene);
    expect(l).toHaveLength(1);
    expect(l[0].intensity).toBe(LIGHT_EMITTERS['ceiling-light'].intensity);
    expect(glowing(scene).length).toBeGreaterThan(0);
  });
  it('the Lights switch turns the light off and on', () => {
    const { h, scene } = rig();
    h.ui.getState().setCinematic(true);
    h.ui.getState().setLook('realistic');
    h.ui.getState().setLightsOn(false);
    expect(lights(scene)).toHaveLength(0);
    h.ui.getState().setLightsOn(true);
    expect(lights(scene)).toHaveLength(1);
  });
  it('there is no light in the Clay look or the ordinary 3D view', () => {
    const { h, scene } = rig();
    expect(lights(scene)).toHaveLength(0);
    h.ui.getState().setCinematic(true);
    expect(lights(scene)).toHaveLength(0);
  });
  it('a floor lamp lights the room too, and a piece with no emitter does not', () => {
    const { h, scene } = rig([inst({ id: 'f', definitionId: 'floor-lamp', width: 0.35, length: 0.35, height: 1.65 }), inst({ id: 's', definitionId: 'sofa-3', position: { x: 2, y: 4 } })]);
    h.ui.getState().setCinematic(true);
    h.ui.getState().setLook('realistic');
    expect(lights(scene)).toHaveLength(1);
  });
});
