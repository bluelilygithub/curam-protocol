// 3D performance smoke tests: the committed scene is rebuilt only when the project changes, and a drag preview must be cheap
// enough to run every pointer move. Deterministic ceilings on the 100-object scenario, as for the engine (Test Plan §6).
import { describe, expect, it } from 'vitest';
import { Scene3D } from '../../src/render3d/Scene3D';
import { createFeedbackBus } from '../../src/state/feedbackBus';
import { createProjectStore } from '../../src/state/projectStore';
import { createUiStore } from '../../src/state/uiStore';
import { loadScenario } from '../helpers';

function timeMs(fn: () => void, runs = 9): number {
  fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe('perf-100 in 3D', () => {
  const project = loadScenario('perf-100.json');
  const store = createProjectStore(project);
  const ui = createUiStore();
  const bus = createFeedbackBus();
  const scene = new Scene3D({ project: store, ui, bus, invalidate: () => {}, animateMs: 0 });
  const inst = project.rooms[0].furniture[0];

  it('rebuilding the whole scene (100 objects, shadows, status tints): < 100 ms', () => {
    expect(timeMs(() => scene.rebuild(), 5)).toBeLessThan(100);
  });

  it('one drag-preview update (move the cached preview object): < 2 ms', () => {
    const pv = (x: number) => ({
      previews: [{ id: inst.id, kind: 'furniture' as const, instance: { ...inst, position: { x, y: inst.position.y } }, valid: true, violations: [], ghost: false }],
      hiddenIds: [inst.id],
    });
    bus.set(pv(inst.position.x));
    let x = inst.position.x;
    expect(timeMs(() => { x += 0.01; bus.set(pv(x)); }, 15)).toBeLessThan(2);
  });

  it('a pick ray over 100 objects: < 2 ms', async () => {
    const THREE = await import('three');
    const ray = new THREE.Raycaster(new THREE.Vector3(5, 12, 5), new THREE.Vector3(0, -1, 0));
    expect(timeMs(() => { scene.pick(ray); }, 15)).toBeLessThan(2);
  });
});
