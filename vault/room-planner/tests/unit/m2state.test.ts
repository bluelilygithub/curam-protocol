import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canvasToWorld, fitView, MAX_SCALE, metresPerPixel, MIN_SCALE, panBy, worldToCanvas, zoomAt,
} from '../../src/adapters/canvas';
import { FIXTURE_LIBRARY, FURNITURE_LIBRARY } from '../../src/data/furnitureLibrary';
import { isCCW, proposeCreateRoom, validatePolygon, type Project } from '../../src/engine';
import { frontMarker, glyphFor, type GlyphShape } from '../../src/render2d/glyphs';
import { createFeedbackBus, MESSAGE_THROTTLE_MS } from '../../src/state/feedbackBus';
import {
  clearStoredProject, loadStoredProject, parseProjectFile, projectFileName, saveProject, startAutosave, STORAGE_KEY,
  type StorageLike,
} from '../../src/state/persistence';
import { counterIds, newProject, rectangleRoom } from '../../src/state/projectFactory';
import { createProjectStore } from '../../src/state/projectStore';
import { createUiStore } from '../../src/state/uiStore';
import { makeInstance, makeProject, makeRoom } from '../helpers';

describe('canvas adapter (the only Y-flip)', () => {
  const view = { scale: 100, offsetX: 50, offsetY: 400 };
  it('world +Y is canvas up (smaller y)', () => {
    expect(worldToCanvas({ x: 1, y: 2 }, view)).toEqual({ x: 150, y: 200 });
    expect(worldToCanvas({ x: 0, y: 0 }, view)).toEqual({ x: 50, y: 400 });
  });
  it('round-trips', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 3.21, y: -1.5 }, { x: -7, y: 12 }]) {
      const back = canvasToWorld(worldToCanvas(p, view), view);
      expect(back.x).toBeCloseTo(p.x, 12);
      expect(back.y).toBeCloseTo(p.y, 12);
    }
  });
  it('zoomAt keeps the world point under the cursor fixed and clamps the scale', () => {
    const cursor = { x: 300, y: 250 };
    const before = canvasToWorld(cursor, view);
    const z = zoomAt(view, cursor, 1.5);
    expect(z.scale).toBe(150);
    const after = canvasToWorld(cursor, z);
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
    expect(zoomAt(view, cursor, 1e6).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, cursor, 1e-6).scale).toBe(MIN_SCALE);
  });
  it('pan and metres-per-pixel', () => {
    expect(panBy(view, 10, -5)).toEqual({ scale: 100, offsetX: 60, offsetY: 395 });
    expect(metresPerPixel(view)).toBe(0.01);
  });
  it('fitView centres the box with padding', () => {
    const v = fitView({ min: { x: 0, y: 0 }, max: { x: 4, y: 5 } }, { width: 1000, height: 700 }, 50);
    expect(v.scale).toBe(120); // limited by height: (700 - 100) / 5
    const c = worldToCanvas({ x: 2, y: 2.5 }, v);
    expect(c.x).toBeCloseTo(500, 9);
    expect(c.y).toBeCloseTo(350, 9);
  });
});

describe('projectStore', () => {
  const room = makeRoom();
  const start = (): Project => makeProject([room], FURNITURE_LIBRARY);
  const place = (id: string) => ({ type: 'PlaceFurniture' as const, instance: makeInstance({ id, position: { x: 2, y: 2 } }) });

  it('load resets history; commit records a labelled entry; undo/redo return the label', () => {
    const s = createProjectStore(start());
    expect(s.getState().canUndo).toBe(false);
    expect(s.getState().commit(place('a'), 'Place a')).toBe(true);
    expect(s.getState()).toMatchObject({ canUndo: true, undoLabel: 'Place a', redoLabel: undefined });
    expect(s.getState().undo()).toBe('Place a');
    expect(s.getState()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Place a' });
    expect(s.getState().redo()).toBe('Place a');
    s.getState().load(start());
    expect(s.getState()).toMatchObject({ canUndo: false, canRedo: false, undoLabel: undefined });
    expect(s.getState().historyLength()).toBe(0);
  });
  it('undo/redo with nothing to do return null and do not bump the revision', () => {
    const s = createProjectStore(start());
    const rev = s.getState().revision;
    expect(s.getState().undo()).toBeNull();
    expect(s.getState().redo()).toBeNull();
    expect(s.getState().revision).toBe(rev);
  });
  it('rejections and no-project commits change nothing', () => {
    const s = createProjectStore(null);
    expect(s.getState().commit(place('a'), 'x')).toBe(false);
    const t = createProjectStore(start());
    const rev = t.getState().revision;
    expect(t.getState().commitResult({ rejected: true, violations: [], noop: true }, 'x')).toBe(false);
    expect(t.getState().revision).toBe(rev);
  });
  it('a malformed command throws and leaves state and history untouched', () => {
    const s = createProjectStore(start());
    const before = s.getState().project;
    expect(() => s.getState().commit({ type: 'MoveFurniture', instanceId: 'ghost', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, 'bad')).toThrow();
    expect(s.getState().project).toBe(before);
    expect(s.getState().historyLength()).toBe(0);
  });
  it('onPush sees exactly the committed commands', () => {
    const seen: string[] = [];
    const s = createProjectStore(start(), { onPush: (c) => seen.push(c.type) });
    s.getState().commit(place('a'), 'Place');
    s.getState().commit(place('b'), 'Place');
    s.getState().undo();
    expect(seen).toEqual(['PlaceFurniture', 'PlaceFurniture']);
  });
  it('history is never part of the persisted project', () => {
    const s = createProjectStore(start());
    s.getState().commit(place('a'), 'Place');
    expect(JSON.stringify(s.getState().project)).not.toContain('Place a');
    expect(Object.keys(s.getState().project!)).not.toContain('history');
  });
});

describe('uiStore', () => {
  it('toggleSelect, clearSelection, tool change clears placing, startPlacing selects the select tool', () => {
    const ui = createUiStore();
    const a = { kind: 'furniture' as const, id: 'a' };
    ui.getState().toggleSelect(a);
    expect(ui.getState().selection).toEqual([a]);
    ui.getState().toggleSelect(a);
    expect(ui.getState().selection).toEqual([]);
    ui.getState().setTool('measure');
    ui.getState().startPlacing({ kind: 'furniture', definitionId: 'sofa-3' });
    expect(ui.getState().tool).toBe('select');
    ui.getState().setTool('pan');
    expect(ui.getState().placing).toBeNull();
  });
  it('recents are most-recent-first, unique, capped at 6', () => {
    const ui = createUiStore();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'c']) ui.getState().noteRecent(id);
    expect(ui.getState().recents).toEqual(['c', 'g', 'f', 'e', 'd', 'b']);
  });
});

describe('projectFactory ("Start from a rectangle", B8)', () => {
  it('a 4 × 5 CCW room with unique ids and 150 mm walls; polygon validates', () => {
    const r = rectangleRoom(counterIds('t'));
    expect(r.vertices.map((v) => v.position)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 5 }, { x: 0, y: 5 }]);
    expect(isCCW(r.vertices.map((v) => v.position))).toBe(true);
    expect(validatePolygon(r.vertices)).toEqual({ ok: true });
    expect(r.walls.map((w) => w.thickness)).toEqual([0.15, 0.15, 0.15, 0.15]);
    const ids = [r.id, ...r.vertices.map((v) => v.id), ...r.walls.map((w) => w.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.walls[3].endVertexId).toBe(r.vertices[0].id);
  });
  it('is one undoable CreateRoom; undo returns to the empty state', () => {
    const ids = counterIds('t');
    const s = createProjectStore(newProject(ids));
    const result = proposeCreateRoom(s.getState().project!, rectangleRoom(ids));
    expect(s.getState().commitResult(result, 'Create room')).toBe(true);
    expect(s.getState().project!.rooms).toHaveLength(1);
    expect(s.getState().historyLength()).toBe(1);
    s.getState().undo();
    expect(s.getState().project!.rooms).toHaveLength(0);
  });
  it('a new project carries the furniture library and starter materials', () => {
    const p = newProject(counterIds('t'));
    expect(p.furnitureDefinitions.map((d) => d.id)).toEqual(FURNITURE_LIBRARY.map((d) => d.id));
    expect(p.materials.length).toBeGreaterThan(3);
    expect(p.schemaVersion).toBe(1);
  });
});

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  fail = false;
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail) throw new Error('quota'); this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

describe('persistence (project only; undo history resets on reload)', () => {
  const p = (): Project => makeProject([makeRoom({ furniture: [makeInstance({ id: 'a' })] })], FURNITURE_LIBRARY);
  it('save → load round-trips the project exactly', () => {
    const st = new MemoryStorage();
    expect(saveProject(st, p())).toBe(true);
    expect(loadStoredProject(st)).toEqual(p());
    expect(st.data.has(STORAGE_KEY)).toBe(true);
  });
  it('nothing about undo history is stored', () => {
    const st = new MemoryStorage();
    saveProject(st, p());
    expect([...st.data.keys()]).toEqual([STORAGE_KEY]);
    expect(st.getItem(STORAGE_KEY)).not.toMatch(/undo|redo|history/i);
  });
  it('quota errors return false; corrupt storage loads as null', () => {
    const st = new MemoryStorage();
    st.fail = true;
    expect(saveProject(st, p())).toBe(false);
    st.fail = false;
    st.setItem(STORAGE_KEY, '{nope');
    expect(loadStoredProject(st)).toBeNull();
    clearStoredProject(st);
    expect(loadStoredProject(st)).toBeNull();
  });
  it('parseProjectFile never throws', () => {
    expect(parseProjectFile('{nope')).toEqual({ ok: false, error: 'invalid JSON' });
    expect(parseProjectFile('{"schemaVersion":2}')).toMatchObject({ ok: false });
    const ok = parseProjectFile(JSON.stringify(p()));
    expect(ok.ok && ok.project.id).toBe('p1');
  });
  // M5 projects: a project now has its own name, so the file is named after it; older projects fall back to the first room, then "project".
  it('file name comes from the project name, else the first room, else "project"', () => {
    expect(projectFileName({ ...makeProject([makeRoom({ name: 'Hall' })]), name: 'Flat #4' })).toBe('flat-4.roomplan.json');
    expect(projectFileName(makeProject([makeRoom({ name: 'Living Room #2' })]))).toBe('living-room-2.roomplan.json');
    expect(projectFileName(makeProject([]))).toBe('project.roomplan.json');
  });

  describe('autosave', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it('debounces: saving → (400 ms) → saved; one write for a burst of changes', () => {
      const st = new MemoryStorage();
      const writes = vi.spyOn(st, 'setItem');
      const s = createProjectStore(p());
      const states: string[] = [];
      let last = s.getState().revision;
      const a = startAutosave(st, () => s.getState().project, (cb) => s.subscribe((n) => { if (n.revision !== last) { last = n.revision; cb(); } }), (x) => states.push(x));
      s.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2 }, to: { x: 2.1, y: 2 } }, 'm');
      s.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2.1, y: 2 }, to: { x: 2.2, y: 2 } }, 'm');
      expect(a.status()).toBe('saving');
      expect(writes).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(a.status()).toBe('saved');
      expect(states).toEqual(['saving', 'saving', 'saved']);
      expect(loadStoredProject(st)!.rooms[0].furniture[0].position.x).toBe(2.2);
      a.dispose();
    });
    it('reports an error status when storage fails; dispose flushes a pending save', () => {
      const st = new MemoryStorage();
      const s = createProjectStore(p());
      let last = s.getState().revision;
      const a = startAutosave(st, () => s.getState().project, (cb) => s.subscribe((n) => { if (n.revision !== last) { last = n.revision; cb(); } }));
      st.fail = true;
      s.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2 }, to: { x: 2.1, y: 2 } }, 'm');
      vi.advanceTimersByTime(400);
      expect(a.status()).toBe('error');
      st.fail = false;
      s.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2.1, y: 2 }, to: { x: 2.3, y: 2 } }, 'm');
      a.dispose(); // flush now
      expect(loadStoredProject(st)!.rooms[0].furniture[0].position.x).toBe(2.3);
    });
  });
});

describe('feedback bus: constraint message throttle (B5, once per 100 ms)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const msg = (text: string) => ({ text, severity: 'hard' as const, violations: [] });

  it('the first message is immediate; changes inside the window are held and the latest wins', () => {
    const clock = { t: 0 };
    const bus = createFeedbackBus(() => clock.t);
    const seen: Array<string | undefined> = [];
    bus.subscribe((s) => seen.push(s.message?.text));
    bus.setMessage(msg('one'));
    clock.t = 30; bus.setMessage(msg('two'));
    clock.t = 60; bus.setMessage(msg('three'));
    expect(seen).toEqual(['one']);
    clock.t = MESSAGE_THROTTLE_MS;
    vi.advanceTimersByTime(MESSAGE_THROTTLE_MS);
    expect(seen).toEqual(['one', 'three']);
  });
  it('an unchanged message does not publish again; clearing is throttled the same way', () => {
    const clock = { t: 0 };
    const bus = createFeedbackBus(() => clock.t);
    bus.setMessage(msg('one'));
    const n = bus.publishCount;
    clock.t = 500; bus.setMessage(msg('one'));
    expect(bus.publishCount).toBe(n);
    bus.setMessage(null);
    expect(bus.get().message).toBeNull();
  });
  it('reset clears everything and cancels a pending message', () => {
    const clock = { t: 0 };
    const bus = createFeedbackBus(() => clock.t);
    bus.setMessage(msg('one'));
    clock.t = 10; bus.setMessage(msg('two'));
    bus.reset();
    vi.advanceTimersByTime(500);
    expect(bus.get().message).toBeNull();
    expect(bus.get().previews).toEqual([]);
  });
});

describe('glyphs: blueprint line drawings with a front marker (Spec §7, C20)', () => {
  const bounds = (shapes: GlyphShape[]): { minX: number; maxX: number; minY: number; maxY: number } => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of shapes) {
      if (s.t === 'rect') { xs.push(s.x, s.x + s.w); ys.push(s.y, s.y + s.h); }
      else if (s.t === 'line') s.pts.forEach((v, i) => (i % 2 ? ys : xs).push(v));
      else { xs.push(s.x - s.r, s.x + s.r); ys.push(s.y - s.r, s.y + s.r); }
    }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };

  it.each(FURNITURE_LIBRARY.map((d) => [d.id, d.defaultWidth, d.defaultLength] as const))('%s: outline matches W × L, details stay inside, there is more than a box', (id, w, l) => {
    const g = glyphFor(id, w, l);
    const outline = g.shapes[0];
    expect(outline).toMatchObject({ t: 'rect', weight: 'outline', x: -w / 2, y: -l / 2, w, h: l });
    const b = bounds(g.shapes);
    expect(b.minX).toBeGreaterThanOrEqual(-w / 2 - 1e-9);
    expect(b.maxX).toBeLessThanOrEqual(w / 2 + 1e-9);
    expect(b.minY).toBeGreaterThanOrEqual(-l / 2 - 1e-9);
    expect(b.maxY).toBeLessThanOrEqual(l / 2 + 1e-9);
    expect(g.shapes.length).toBeGreaterThan(1); // recognisable line drawing, not a raw rectangle
  });
  it.each(FURNITURE_LIBRARY.map((d) => [d.id, d.defaultWidth, d.defaultLength] as const))('%s: front marker is a triangle at the middle of the +Y (front) edge', (id, w, l) => {
    const m = glyphFor(id, w, l).frontMarker.pts;
    expect(m).toHaveLength(6);
    expect(m[4]).toBe(0); // apex centred
    expect(m[5]).toBeGreaterThan(0);
    expect(m[5]).toBeLessThanOrEqual(l / 2); // inside the footprint
    expect(m[5]).toBeGreaterThan(l / 2 - 0.1);
    expect(Math.abs(m[0] + m[2])).toBeLessThan(1e-12); // symmetric base
    expect(m[1]).toBeLessThan(m[5]); // base is behind the apex
    for (const v of [m[0], m[2]]) expect(Math.abs(v)).toBeLessThanOrEqual(w / 2);
  });
  it('sofa has a back rest, arms and seat cushions at the back (−Y), nothing there for the front', () => {
    const g = glyphFor('sofa-3', 2.2, 0.95);
    const horizontal = g.shapes.filter((s) => s.t === 'line' && s.pts[1] === s.pts[3]) as Array<Extract<GlyphShape, { t: 'line' }>>;
    expect(horizontal.length).toBe(1);
    expect(horizontal[0].pts[1]).toBeLessThan(0); // the back rest line sits on the back half
    expect(g.shapes.filter((s) => s.t === 'line').length).toBe(1 + 2 + 2); // back rest + 2 arms + 2 cushion splits
  });
  it('unknown definitions fall back to a crossed box (still with a front marker)', () => {
    const g = glyphFor('mystery', 1, 1);
    expect(g.shapes).toHaveLength(3);
    expect(g.frontMarker.pts).toEqual(frontMarker(1, 1).pts);
  });
  it('glyphs are deterministic and scale with the instance size', () => {
    expect(glyphFor('bed-queen', 1.6, 2.1)).toEqual(glyphFor('bed-queen', 1.6, 2.1));
    const wide = bounds(glyphFor('bookshelf', 1.5, 0.4).shapes);
    expect(wide.maxX).toBeCloseTo(0.75, 12);
  });
  it('the fixture library covers the demo door and window', () => {
    expect(FIXTURE_LIBRARY.map((d) => d.type).sort()).toEqual(['door', 'window']);
  });
});
