import { FIXTURE_LIBRARY, FURNITURE_LIBRARY, SEED_MATERIALS } from '../../src/data/furnitureLibrary';
import type { Command, Fixture, FurnitureInstance, Project, Room } from '../../src/engine';
import { Interaction, type KeyEv, type PointerEv } from '../../src/interaction/interaction';
import { createFeedbackBus } from '../../src/state/feedbackBus';
import { counterIds } from '../../src/state/projectFactory';
import { createProjectStore } from '../../src/state/projectStore';
import { createUiStore } from '../../src/state/uiStore';
import { createViewStore } from '../../src/state/viewStore';
import { makeRoom } from '../helpers';

export { FIXTURE_LIBRARY };

export interface Harness {
  project: ReturnType<typeof createProjectStore>;
  ui: ReturnType<typeof createUiStore>;
  view: ReturnType<typeof createViewStore>;
  bus: ReturnType<typeof createFeedbackBus>;
  it: Interaction;
  pushes: Array<{ command: Command; label: string }>;
  panned: Array<[number, number]>;
  clock: { t: number };
  /** Pointer event at world metres; screen = 100 px per metre, Y flipped. */
  ptr(x: number, y: number, o?: Partial<PointerEv>): PointerEv;
  key(key: string, o?: Partial<KeyEv>): boolean;
  /** Down, a series of moves, then up. */
  drag(from: [number, number], to: [number, number], steps?: number, o?: Partial<PointerEv>): void;
  inst(id: string): FurnitureInstance;
  fixture(id: string): Fixture;
  state(): Project;
  room(): Room;
}

export function inst(over: Partial<FurnitureInstance> & { id: string }): FurnitureInstance {
  return {
    definitionId: 'sofa-3', roomId: 'room-1', position: { x: 2, y: 2.5 }, elevation: 0, rotation: 0,
    width: 2.2, length: 0.95, height: 0.85, ...over,
  };
}

export function makeHarness(opts: { furniture?: FurnitureInstance[]; fixtures?: Fixture[]; room?: Partial<Room> } = {}): Harness {
  const pushes: Harness['pushes'] = [];
  const project = createProjectStore(null, { onPush: (command, label) => pushes.push({ command, label }) });
  const ui = createUiStore();
  const view = createViewStore();
  const clock = { t: 1000 };
  const bus = createFeedbackBus(() => clock.t);
  const panned: Array<[number, number]> = [];
  const it = new Interaction({
    project, ui, bus, newId: counterIds('new'), now: () => clock.t, panBy: (dx, dy) => panned.push([dx, dy]),
  });
  const room = makeRoom({ furniture: [...(opts.furniture ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1)), fixtures: opts.fixtures ?? [], ...opts.room });
  project.getState().load({
    schemaVersion: 1, id: 'p', units: 'metric', rooms: [room],
    furnitureDefinitions: structuredClone(FURNITURE_LIBRARY), materials: structuredClone(SEED_MATERIALS),
  });

  const h: Harness = {
    project, ui, view, bus, it, pushes, panned, clock,
    ptr: (x, y, o = {}) => ({ world: { x, y }, screen: { x: x * 100, y: -y * 100 }, shift: false, alt: false, ctrl: false, mpp: 0.01, ...o }),
    key: (key, o = {}) => it.keyDown({ key, shift: false, ctrl: false, alt: false, ...o }),
    drag(from, to, steps = 12, o = {}) {
      it.pointerDown(h.ptr(from[0], from[1], o));
      for (let i = 1; i <= steps; i++) {
        h.clock.t += 16;
        it.pointerMove(h.ptr(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, o));
      }
      it.pointerUp(h.ptr(to[0], to[1], o));
    },
    inst: (id) => project.getState().project!.rooms[0].furniture.find((f) => f.id === id)!,
    fixture: (id) => project.getState().project!.rooms[0].fixtures.find((f) => f.id === id)!,
    state: () => project.getState().project!,
    room: () => project.getState().project!.rooms[0],
  };
  return h;
}
