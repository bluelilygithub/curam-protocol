// Test Plan §4, M2 gates: the first 2D editing loop. Everything here drives the real interaction engine.
import { describe, expect, it } from 'vitest';
import {
  apply, generateSnapCandidates, quantizeRotation, rankSnapCandidates, wallFlushAngle, type Command, type Project,
} from '../../src/engine';
import { computeHandles } from '../../src/interaction/handles';
import { expectProjectEqual, hashProject, loadScenario, makeDoor } from '../helpers';
import { inst, makeHarness } from './harness';

const sofa = (over = {}) => inst({ id: 'a', ...over });

describe('gate: one drag = exactly one command = one history entry', () => {
  it('a 12-frame drag commits a single MoveFurniture', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.drag([2, 2.5], [2.5, 3]);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].command.type).toBe('MoveFurniture');
    expect(h.pushes[0].label).toBe('Move 3-seat sofa');
    expect(h.state().rooms[0].furniture[0].position.x).toBeGreaterThan(2.3);
    expect(h.project.getState().historyLength()).toBe(1);
  });
  it('a group drag is one Composite and one entry; undo restores both', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a', position: { x: 1.6, y: 1 } }), sofa({ id: 'b', position: { x: 1.6, y: 3.5 } })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }, { kind: 'furniture', id: 'b' }]);
    const before = h.state();
    h.drag([1.6, 1], [2.0, 1]);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].command.type).toBe('Composite');
    h.project.getState().undo();
    expectProjectEqual(h.state(), before);
  });
  it('a resize drag and a rotate drag are each one command', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.drag([3.1, 2.5], [3.5, 2.5]); // right-edge handle
    expect(h.pushes.map((p) => p.command.type)).toEqual(['ResizeFurniture']);
    const rotateHandle = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
    h.drag([rotateHandle.x, rotateHandle.y], [3.4, h.inst('a').position.y]);
    expect(h.pushes.map((p) => p.command.type)).toEqual(['ResizeFurniture', 'RotateFurniture']);
  });
  it('a click without moving commits nothing', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.drag([2, 2.5], [2, 2.5], 0);
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
  });
});

describe('gate: invalid drag animates back with zero history entries', () => {
  it('releasing outside the room commits nothing and asks the renderer to animate back', () => {
    const h = makeHarness({ furniture: [sofa()] });
    const before = h.state();
    h.drag([2, 2.5], [0.3, 2.5]);
    expect(h.pushes).toHaveLength(0);
    expectProjectEqual(h.state(), before);
    expect(h.bus.get().animateBack).toBe(true);
    expect(h.bus.get().previews).toHaveLength(1); // still drawn (red) until the animation ends
    expect(h.bus.get().previews[0].valid).toBe(false);
    h.it.animationDone();
    expect(h.bus.get().previews).toEqual([]);
    expect(h.bus.get().hiddenIds).toEqual([]);
    expect(h.project.getState().canUndo).toBe(false);
  });
  it('colliding with another object is invalid; the constraint message names both', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a', position: { x: 2, y: 1 } }), sofa({ id: 'b', definitionId: 'coffee-table', position: { x: 2, y: 3.5 }, width: 1.2, length: 0.6, height: 0.42 })] });
    h.it.pointerDown(h.ptr(2, 1));
    h.it.pointerMove(h.ptr(2.05, 1.5));
    h.clock.t += 500;
    h.it.pointerMove(h.ptr(2, 3.4));
    h.clock.t += 500;
    h.it.pointerMove(h.ptr(2, 3.3));
    expect(h.bus.get().message?.text).toBe('3-seat sofa overlaps Coffee table');
    h.it.pointerUp(h.ptr(2, 3.3));
    expect(h.pushes).toHaveLength(0);
  });
});

describe('gate: a rejected commit leaves state and history untouched', () => {
  it('Delete on a locked object', () => {
    const h = makeHarness({ furniture: [sofa({ locked: true })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    const snap = JSON.stringify(h.state());
    expect(h.key('Delete')).toBe(true);
    expect(JSON.stringify(h.state())).toBe(snap);
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().status?.text).toBe('3-seat sofa is locked');
  });
  it('an arrow nudge into a wall is rejected with a status message', () => {
    const h = makeHarness({ furniture: [sofa({ position: { x: 1.1, y: 2.5 } })] }); // left edge exactly at x = 0
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.key('ArrowLeft');
    expect(h.pushes).toHaveLength(0);
    expect(h.inst('a').position.x).toBe(1.1);
    expect(h.ui.getState().status?.text).toBe('3-seat sofa is outside the room');
  });
  it('store.commitResult with a rejection returns false and changes nothing', () => {
    const h = makeHarness({ furniture: [sofa()] });
    const rev = h.project.getState().revision;
    expect(h.project.getState().commitResult({ rejected: true, violations: [] }, 'x')).toBe(false);
    expect(h.project.getState().revision).toBe(rev);
  });
});

describe('gate: pointer moves cause ZERO store updates (A12)', () => {
  function countUpdates(h: ReturnType<typeof makeHarness>): () => { project: number; ui: number; view: number } {
    const n = { project: 0, ui: 0, view: 0 };
    h.project.subscribe(() => n.project++);
    h.ui.subscribe(() => n.ui++);
    h.view.subscribe(() => n.view++);
    return () => ({ ...n });
  }
  const moves = (h: ReturnType<typeof makeHarness>, path: Array<[number, number]>): void => {
    for (const [x, y] of path) { h.clock.t += 16; h.it.pointerMove(h.ptr(x, y)); }
  };
  const path = (a: [number, number], b: [number, number], n = 60): Array<[number, number]> =>
    Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n]);

  it('dragging furniture: 60 pointer moves, no project/ui/view update, but plenty of feedback publishes', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.it.pointerDown(h.ptr(2, 2.5)); // selection changes here (a click, not a move)
    const read = countUpdates(h);
    const published = h.bus.publishCount;
    moves(h, path([2, 2.5], [2.8, 3.2]));
    expect(read()).toEqual({ project: 0, ui: 0, view: 0 });
    expect(h.bus.publishCount - published).toBeGreaterThanOrEqual(60);
    expect(h.it.stateName).toBe('drag');
    h.it.pointerUp(h.ptr(2.8, 3.2));
    expect(read().project).toBe(1); // the single commit
  });
  it('resizing', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.it.pointerDown(h.ptr(3.1, 2.5));
    expect(h.it.stateName).toBe('resize');
    const read = countUpdates(h);
    moves(h, path([3.1, 2.5], [3.5, 2.5]));
    expect(read()).toEqual({ project: 0, ui: 0, view: 0 });
  });
  it('rotating', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    const r = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
    h.it.pointerDown(h.ptr(r.x, r.y));
    expect(h.it.stateName).toBe('rotate');
    const read = countUpdates(h);
    moves(h, path([r.x, r.y], [3.2, 2.5]));
    expect(read()).toEqual({ project: 0, ui: 0, view: 0 });
  });
  it('placement ghost following the pointer', () => {
    const h = makeHarness({ furniture: [] });
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'sofa-3' });
    const read = countUpdates(h);
    moves(h, path([1, 1], [2.5, 3]));
    expect(read()).toEqual({ project: 0, ui: 0, view: 0 });
    expect(h.bus.get().previews[0].ghost).toBe(true);
  });
  it('fixture ghost sliding along a wall', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'fixture', definitionId: 'door-single' });
    const read = countUpdates(h);
    moves(h, path([0.6, 0.3], [3.2, 0.3]));
    expect(read()).toEqual({ project: 0, ui: 0, view: 0 });
  });
  it('marquee and measure rubber-band', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.it.pointerDown(h.ptr(0.5, 0.5));
    const read = countUpdates(h);
    moves(h, path([0.5, 0.5], [3.5, 4.5]));
    expect(read()).toEqual({ project: 0, ui: 0, view: 0 });
    expect(h.it.stateName).toBe('marquee');
  });
  it('the constraint message is throttled to once per 100 ms', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.it.pointerDown(h.ptr(2, 2.5));
    const messages: Array<string | undefined> = [];
    h.bus.subscribe((s) => { if (messages[messages.length - 1] !== s.message?.text) messages.push(s.message?.text); });
    // wiggle the sofa in and out of the wall every 10 ms for 200 ms
    for (let i = 0; i < 20; i++) {
      h.clock.t += 10;
      h.it.pointerMove(h.ptr(i % 2 ? 2 : 0.4, 2.5));
    }
    expect(messages.filter((m) => m === '3-seat sofa is outside the room').length).toBeLessThanOrEqual(3);
  });
});

describe('B7 Escape and cancel semantics', () => {
  it('placement ghost: discard, no history', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'sofa-3' });
    h.it.pointerMove(h.ptr(2, 2));
    h.key('Escape');
    expect(h.ui.getState().placing).toBeNull();
    expect(h.bus.get().previews).toEqual([]);
    expect(h.pushes).toHaveLength(0);
  });
  it.each([
    ['dragging', [2, 2.5], [2.5, 2.5]],
    ['resizing', [3.1, 2.5], [3.5, 2.5]],
  ] as const)('%s: restore the last committed transform, no history', (_n, from, to) => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    const before = h.state();
    h.it.pointerDown(h.ptr(from[0], from[1]));
    h.it.pointerMove(h.ptr(to[0], to[1]));
    h.key('Escape');
    expect(h.it.stateName).toBe('idle');
    expect(h.bus.get().previews).toEqual([]);
    expect(h.pushes).toHaveLength(0);
    expectProjectEqual(h.state(), before);
  });
  it('rotating', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    const r = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
    h.it.pointerDown(h.ptr(r.x, r.y));
    h.it.pointerMove(h.ptr(3, 2.5));
    h.key('Escape');
    expect(h.it.stateName).toBe('idle');
    expect(h.pushes).toHaveLength(0);
    expect(h.inst('a').rotation).toBe(0);
  });
  it('marquee: clear the marquee, keep the current selection', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.it.pointerDown(h.ptr(0.2, 4.5));
    h.it.pointerMove(h.ptr(1, 3.8));
    expect(h.bus.get().marquee).not.toBeNull();
    h.key('Escape');
    expect(h.bus.get().marquee).toBeNull();
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
  });
  it('measure: clear the measurement, stay in the tool', () => {
    const h = makeHarness();
    h.key('4');
    expect(h.ui.getState().tool).toBe('measure');
    h.it.pointerDown(h.ptr(1, 1));
    h.it.pointerDown(h.ptr(3, 1));
    expect(h.bus.get().measure?.b).toEqual({ x: 3, y: 1 });
    h.key('Escape');
    expect(h.bus.get().measure).toBeNull();
    expect(h.ui.getState().tool).toBe('measure');
  });
  it('Escape never exits a persistent tool; tools change only via shortcut 1–4', () => {
    const h = makeHarness();
    for (const [k, tool] of [['2', 'pan'], ['4', 'measure'], ['1', 'select']] as const) {
      h.key(k);
      expect(h.ui.getState().tool).toBe(tool);
      h.key('Escape');
      expect(h.ui.getState().tool).toBe(tool);
    }
  });
  it('shortcut 3 is the wall tool (M3); Escape does not leave it', () => {
    const h = makeHarness();
    h.key('3');
    expect(h.ui.getState().tool).toBe('wall_edit');
    h.key('Escape');
    expect(h.ui.getState().tool).toBe('wall_edit');
  });
  it('switching tools mid-drag cancels the drag first', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.it.pointerDown(h.ptr(2, 2.5));
    h.it.pointerMove(h.ptr(2.6, 2.5));
    expect(h.it.stateName).toBe('drag');
    h.key('2');
    expect(h.it.stateName).toBe('idle');
    expect(h.ui.getState().tool).toBe('pan');
    expect(h.pushes).toHaveLength(0);
    expect(h.inst('a').position.x).toBe(2);
  });
  it('idle Escape clears the selection', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.key('Escape');
    expect(h.ui.getState().selection).toEqual([]);
  });
});

describe('keyboard', () => {
  it('R adds 45° to the STORED quantized rotation: 16 presses return to the start with no float drift', () => {
    const h = makeHarness({ furniture: [sofa({ position: { x: 2, y: 2.5 }, width: 0.8, length: 0.8 })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    for (let n = 1; n <= 16; n++) {
      h.key('r');
      const expected = quantizeRotation((n * Math.PI) / 4);
      expect(Math.abs(h.inst('a').rotation - expected), `press ${n}`).toBeLessThan(1e-9);
      expect(h.inst('a').rotation).toBe(quantizeRotation(h.inst('a').rotation)); // already on the grid, exactly
    }
    expect(h.inst('a').rotation).toBe(0);
    expect(h.pushes).toHaveLength(16);
  });
  it('R on a 1000-press run never drifts', () => {
    const h = makeHarness({ furniture: [sofa({ width: 0.8, length: 0.8 })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    for (let n = 1; n <= 1000; n++) h.key('r');
    expect(h.inst('a').rotation).toBe(quantizeRotation((1000 * Math.PI) / 4));
  });
  it('Arrow = 1 cm, Shift+Arrow = one grid unit; Up is +Y (up the plan)', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.key('ArrowRight');
    expect(h.inst('a').position).toEqual({ x: 2.01, y: 2.5 });
    h.key('ArrowUp', { shift: true });
    expect(h.inst('a').position).toEqual({ x: 2.01, y: 2.6 });
    expect(h.pushes).toHaveLength(2);
  });
  it('Delete removes the selection as one command; group delete is a Composite', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a', position: { x: 1.6, y: 1 } }), sofa({ id: 'b', position: { x: 1.6, y: 3.5 } })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }, { kind: 'furniture', id: 'b' }]);
    h.key('Delete');
    expect(h.state().rooms[0].furniture).toEqual([]);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].command.type).toBe('Composite');
    expect(h.pushes[0].label).toBe('Delete 2 objects');
  });
  it('Ctrl+Z / Ctrl+Shift+Z use the same entries and confirm in the status bar (B9)', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.drag([2, 2.5], [2.5, 2.5]);
    expect(h.project.getState().undoLabel).toBe('Move 3-seat sofa');
    h.key('z', { ctrl: true });
    expect(h.ui.getState().status?.text).toBe('Undid: Move 3-seat sofa');
    expect(h.project.getState().redoLabel).toBe('Move 3-seat sofa');
    h.key('z', { ctrl: true, shift: true });
    expect(h.ui.getState().status?.text).toBe('Redid: Move 3-seat sofa');
  });
  it('Ctrl+D duplicates; when the +0.1 offset collides, the copy rides the pointer as a ghost (A6)', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.key('d', { ctrl: true });
    expect(h.pushes).toHaveLength(0); // the offset copy would overlap its source: nothing committed
    expect(h.ui.getState().placing).toMatchObject({ kind: 'furniture', definitionId: 'sofa-3' });
    h.it.pointerMove(h.ptr(2, 4.2));
    expect(h.bus.get().previews[0]).toMatchObject({ ghost: true, valid: true });
    h.it.pointerDown(h.ptr(2, 4.2));
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].label).toBe('Duplicate 3-seat sofa');
    expect(h.state().rooms[0].furniture).toHaveLength(2);
    expect(h.ui.getState().placing).toBeNull();
  });
  it('Ctrl+A selects every furniture instance', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a', position: { x: 1.6, y: 1 } }), sofa({ id: 'b', position: { x: 1.6, y: 3.5 } })] });
    h.key('a', { ctrl: true });
    expect(h.ui.getState().selection).toHaveLength(2);
  });
});

describe('placement', () => {
  it('furniture ghost: translucent, valid = commit on click, selects the new object', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'coffee-table' });
    h.it.pointerMove(h.ptr(2.04, 2.51));
    const ghost = h.bus.get().previews[0];
    expect(ghost).toMatchObject({ ghost: true, valid: true, kind: 'furniture' });
    h.it.pointerDown(h.ptr(2.04, 2.51));
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].label).toBe('Place Coffee table');
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'new-0001' }]);
    expect(h.ui.getState().recents[0]).toBe('coffee-table');
  });
  it('an invalid ghost shows red and a click does not commit', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'sofa-3' });
    h.it.pointerMove(h.ptr(0.3, 2.5));
    expect(h.bus.get().previews[0].valid).toBe(false);
    h.it.pointerDown(h.ptr(0.3, 2.5));
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().placing).not.toBeNull();
  });
  it('R rotates the ghost by 45° before placing', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'furniture', definitionId: 'coffee-table' });
    h.it.pointerMove(h.ptr(2, 2.5));
    h.key('r');
    h.it.pointerMove(h.ptr(2, 2.5));
    h.it.pointerDown(h.ptr(2, 2.5));
    expect(Math.abs(h.inst('new-0001').rotation - Math.PI / 4)).toBeLessThan(1e-9);
  });
  it('door ghost snaps to the nearest wall (A4), clamps, and commits PlaceFixture', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'fixture', definitionId: 'door-single' });
    h.it.pointerMove(h.ptr(1.234, 0.3));
    const g = h.bus.get().previews[0];
    expect(g.fixture).toMatchObject({ wallId: 'w1', offsetAlongWall: 1.234, width: 0.82, height: 2.04, elevation: 0, type: 'door' });
    expect(g.valid).toBe(true);
    h.it.pointerDown(h.ptr(1.234, 0.3));
    expect(h.pushes[0]).toMatchObject({ label: 'Place Door', command: { type: 'PlaceFixture' } });
    expect(h.ui.getState().selection).toEqual([{ kind: 'fixture', id: 'new-0001' }]);
  });
  it('window uses 1.20 × 1.20 at a 0.90 sill; far from any wall it is a free red marker', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'fixture', definitionId: 'window-std' });
    h.it.pointerMove(h.ptr(2, 2.5));
    expect(h.bus.get().previews[0]).toMatchObject({ valid: false, ghost: true, freeAt: { x: 2, y: 2.5 } });
    h.it.pointerMove(h.ptr(3.8, 2.5));
    expect(h.bus.get().previews[0].fixture).toMatchObject({ wallId: 'w2', width: 1.2, height: 1.2, elevation: 0.9 });
  });
  it('H flips the hinge side of a door ghost', () => {
    const h = makeHarness();
    h.ui.getState().startPlacing({ kind: 'fixture', definitionId: 'door-single' });
    h.it.pointerMove(h.ptr(2, 0.3));
    h.key('h');
    h.it.pointerMove(h.ptr(2, 0.3));
    expect(h.bus.get().previews[0].fixture?.hingeSide).toBe('right');
  });
  it('a door whose swing hits furniture is a red ghost and is not placed', () => {
    const h = makeHarness({ furniture: [inst({ id: 'a', definitionId: 'side-table', position: { x: 2, y: 0.6 }, width: 0.3, length: 0.3 })] });
    h.ui.getState().startPlacing({ kind: 'fixture', definitionId: 'door-single' });
    h.it.pointerMove(h.ptr(2, 0.3));
    expect(h.bus.get().previews[0].valid).toBe(false);
    h.it.pointerDown(h.ptr(2, 0.3));
    expect(h.pushes).toHaveLength(0);
  });
});

describe('selection', () => {
  it('click selects; shift-click toggles; click empty clears; fixtures and walls are selectable', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a', position: { x: 1.6, y: 1 } }), sofa({ id: 'b', position: { x: 1.6, y: 3.5 } })], fixtures: [makeDoor({ id: 'd', offsetAlongWall: 3.2 })] });
    h.drag([1.6, 1], [1.6, 1], 0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
    h.drag([1.6, 3.5], [1.6, 3.5], 0, { shift: true });
    expect(h.ui.getState().selection).toHaveLength(2);
    h.drag([1.6, 3.5], [1.6, 3.5], 0, { shift: true });
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
    h.drag([3.2, -0.05], [3.2, -0.05], 0); // through the door opening
    expect(h.ui.getState().selection).toEqual([{ kind: 'fixture', id: 'd' }]);
    h.clock.t += 1000;
    h.drag([0.8, -0.05], [0.8, -0.05], 0); // wall body
    expect(h.ui.getState().selection).toEqual([{ kind: 'wall', id: 'w1' }]);
    h.drag([0.2, 4.6], [0.2, 4.6], 0); // empty floor
    expect(h.ui.getState().selection).toEqual([]);
  });
  it('marquee needs the full footprint inside', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a', position: { x: 1.6, y: 1 } }), sofa({ id: 'b', position: { x: 1.6, y: 3.5 } })] });
    h.drag([0.1, 0.1], [3.0, 2.0]); // contains a fully (x 0.5..2.7, y 0.525..1.475)
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a' }]);
    h.drag([0.1, 2.0], [2.2, 4.4]); // cuts b (x to 2.7)
    expect(h.ui.getState().selection).toEqual([]);
  });
  it('repeated clicks at the same point within 500 ms cycle deeper (stacked objects)', () => {
    const h = makeHarness({ furniture: [sofa({ id: 'a-low', definitionId: 'coffee-table', position: { x: 2, y: 2.5 }, width: 1.2, length: 0.6, height: 0.42 }), sofa({ id: 'z-tall', definitionId: 'wardrobe', position: { x: 2, y: 2.5 }, width: 1.2, length: 0.6, height: 2.1 })] });
    h.drag([2, 2.5], [2, 2.5], 0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'z-tall' }]); // above the cut-plane picks first
    h.clock.t += 200;
    h.drag([2, 2.5], [2, 2.5], 0);
    expect(h.ui.getState().selection).toEqual([{ kind: 'furniture', id: 'a-low' }]);
  });
  it('dragging a locked object does not start a drag and says why', () => {
    const h = makeHarness({ furniture: [sofa({ locked: true })] });
    h.drag([2, 2.5], [2.6, 2.5]);
    expect(h.pushes).toHaveLength(0);
    expect(h.ui.getState().status?.text).toBe('3-seat sofa is locked');
  });
});

describe('resize and rotate handles', () => {
  it('right-edge handle: opposite edge stays fixed, width follows the pointer', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.drag([3.1, 2.5], [3.5, 2.5]);
    const s = h.inst('a');
    expect(s.width).toBeCloseTo(2.6, 3);
    expect(s.position.x - s.width / 2).toBeCloseTo(0.9, 3); // left edge unchanged
  });
  it('the handle sticks at the last valid size when the pointer goes past the wall (B3)', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.drag([3.1, 2.5], [5.5, 2.5]);
    const s = h.inst('a');
    expect(s.position.x + s.width / 2).toBeLessThanOrEqual(4 + 1e-9); // right edge never crosses x = 4
    expect(s.width).toBeGreaterThan(2.2);
    expect(h.pushes).toHaveLength(1);
  });
  it('minimum size is 0.05 m', () => {
    const h = makeHarness({ furniture: [sofa()] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.drag([3.1, 2.5], [-3, 2.5]);
    expect(h.inst('a').width).toBeGreaterThanOrEqual(0.05);
  });
  it('rotation handle maps pointer arc 1:1 and snaps to 15°; Shift is free to 0.1°', () => {
    const h = makeHarness({ furniture: [sofa({ width: 0.8, length: 0.8 })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    const r = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
    const radius = r.y - 2.5;
    const toAngle = (deg: number): [number, number] => [2 + radius * Math.cos((deg * Math.PI) / 180), 2.5 + radius * Math.sin((deg * Math.PI) / 180)];
    h.drag([r.x, r.y], toAngle(90 + 37)); // +37° → snaps to 30°
    expect(Math.abs(h.inst('a').rotation - (30 * Math.PI) / 180)).toBeLessThan(1e-9);
    const r2 = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
    const radius2 = Math.hypot(r2.x - 2, r2.y - 2.5);
    const ang = Math.atan2(r2.y - 2.5, r2.x - 2);
    h.drag([r2.x, r2.y], [2 + radius2 * Math.cos(ang + (7.34 * Math.PI) / 180), 2.5 + radius2 * Math.sin(ang + (7.34 * Math.PI) / 180)], 12, { shift: true });
    expect(h.inst('a').rotation).toBeCloseTo(((30 + 7.3) * Math.PI) / 180, 6);
  });
  it('an invalid rotation releases back: no history, rotation unchanged, animate-back requested', () => {
    // 2.2 × 0.95 sofa in the bottom strip (y 0.025..0.975): a quarter turn would stick out through the floor wall
    const h = makeHarness({ furniture: [sofa({ position: { x: 2, y: 0.5 } })] });
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    const r = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
    h.it.pointerDown(h.ptr(r.x, r.y));
    expect(h.it.stateName).toBe('rotate');
    h.it.pointerMove(h.ptr(2.715, 0.5)); // 90° clockwise about the centre
    expect(h.bus.get().previews[0].valid).toBe(false);
    expect(h.bus.get().message?.text).toBe('3-seat sofa is outside the room');
    h.it.pointerUp(h.ptr(2.715, 0.5));
    expect(h.pushes).toHaveLength(0);
    expect(h.inst('a').rotation).toBe(0);
    expect(h.bus.get().animateBack).toBe(true);
  });
  describe('wall-flush rotation snap (B2, priority 70)', () => {
    // trapezoid whose bottom wall runs at 20°: (0,0) -> (5,1.82) -> (5,5) -> (0,5)
    const trap = {
      vertices: [
        { id: 'v1', position: { x: 0, y: 0 } }, { id: 'v2', position: { x: 5, y: 1.82 } },
        { id: 'v3', position: { x: 5, y: 5 } }, { id: 'v4', position: { x: 0, y: 5 } },
      ],
    };
    const deg = (d: number) => (d * Math.PI) / 180;
    it('pure rule: within 10° of a wall-flush angle and close to the wall -> that angle; otherwise none', () => {
      const room = makeHarness({ room: trap }).room();
      const obj = { position: { x: 2.5, y: 1.6 }, width: 0.8, length: 0.8 };
      const flush = wallFlushAngle(obj, deg(27), room)!;
      expect(flush).toBeCloseTo(Math.atan2(1.82, 5), 9); // 20.0012°
      expect(wallFlushAngle(obj, deg(33), room)).toBeNull(); // 13° away: outside the window
      expect(wallFlushAngle({ ...obj, position: { x: 2.5, y: 4 } }, deg(27), room)).toBeNull(); // nowhere near a wall
      expect(wallFlushAngle(obj, deg(20 + 90 + 4), room)).toBeCloseTo(Math.atan2(1.82, 5) + Math.PI / 2, 9); // facing into the wall
    });
    it('dragging the rotate handle to 27° lands on the wall angle (20.0°), not on the plain 15° step (30°)', () => {
      const h = makeHarness({ room: trap, furniture: [sofa({ position: { x: 2.5, y: 1.6 }, width: 0.8, length: 0.8 })] });
      h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
      const r = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
      const radius = r.y - 1.6;
      const to: [number, number] = [2.5 + radius * Math.cos(deg(90 + 27)), 1.6 + radius * Math.sin(deg(90 + 27))];
      h.drag([r.x, r.y], to);
      expect(h.pushes).toHaveLength(1);
      expect(Math.abs(h.inst('a').rotation - deg(20))).toBeLessThan(deg(0.06));
    });
    it('Shift disables the wall snap and the 15° step: free rotation to 0.1°', () => {
      const h = makeHarness({ room: trap, furniture: [sofa({ position: { x: 2.5, y: 1.6 }, width: 0.8, length: 0.8 })] });
      h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
      const r = computeHandles(h.state(), h.ui.getState().selection, 0.01).rotate!;
      const radius = r.y - 1.6;
      const to: [number, number] = [2.5 + radius * Math.cos(deg(90 + 27)), 1.6 + radius * Math.sin(deg(90 + 27))];
      h.drag([r.x, r.y], to, 12, { shift: true });
      expect(Math.abs(h.inst('a').rotation - deg(27))).toBeLessThan(deg(0.06));
    });
  });
});

describe('fixtures: drag along the wall and delete', () => {
  it('dragging a door along its wall is one UpdateFixture', () => {
    const h = makeHarness({ fixtures: [makeDoor({ id: 'd', offsetAlongWall: 1.0, width: 0.82 })] });
    h.drag([1.0, -0.05], [2.5, 0.2]);
    expect(h.pushes).toHaveLength(1);
    expect(h.pushes[0].command).toMatchObject({ type: 'UpdateFixture', fixtureId: 'd', from: { wallId: 'w1', offsetAlongWall: 1 }, to: { wallId: 'w1' } });
    expect(h.fixture('d').offsetAlongWall).toBeCloseTo(2.5, 2);
  });
  it('Delete on a selected fixture is DeleteFixture', () => {
    const h = makeHarness({ fixtures: [makeDoor({ id: 'd' })] });
    h.ui.getState().select([{ kind: 'fixture', id: 'd' }]);
    h.key('Delete');
    expect(h.pushes[0].command.type).toBe('DeleteFixture');
    expect(h.state().rooms[0].fixtures).toEqual([]);
  });
});

describe('gate: snap ranking is deterministic with the scenario fixtures', () => {
  it('candidates for a chair near the sofa in rect-room-basic rank identically however the room lists its objects', () => {
    const p = loadScenario('rect-room-basic.json');
    const room = p.rooms[0];
    const moving = { position: { x: 3.4, y: 3.9 }, width: 0.5, length: 0.5, rotation: 0 };
    const rank = (others: typeof room.furniture) => rankSnapCandidates(generateSnapCandidates({ moving, room, others }));
    const forward = rank(room.furniture);
    const reversed = rank([...room.furniture].reverse());
    expect(forward.length).toBeGreaterThan(0);
    expect(reversed).toEqual(forward);
    // priority first, then distance
    for (let i = 1; i < forward.length; i++) {
      expect(forward[i - 1].priority >= forward[i].priority).toBe(true);
      if (forward[i - 1].priority === forward[i].priority) expect(forward[i - 1].distance <= forward[i].distance + 1e-12).toBe(true);
    }
  });
});

describe('gate: a scripted 50-step random session ends in the replayed state', () => {
  function mulberry32(a: number): () => number {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function session(seed: number): { final: Project; start: Project; commands: Command[]; steps: number } {
    const rnd = mulberry32(seed);
    const h = makeHarness({ furniture: [
      inst({ id: 'a', position: { x: 1.4, y: 1.0 }, width: 0.8, length: 0.8 }),
      inst({ id: 'b', definitionId: 'coffee-table', position: { x: 3, y: 3.5 }, width: 1.2, length: 0.6, height: 0.42 }),
    ] });
    const start = h.state();
    for (let step = 0; step < 50; step++) {
      h.clock.t += 700;
      const ids = h.room().furniture.map((f) => f.id);
      const pick = ids.length ? ids[Math.floor(rnd() * ids.length)] : null;
      const roll = rnd();
      if (roll < 0.35 && pick) {
        const f = h.inst(pick);
        h.ui.getState().select([{ kind: 'furniture', id: pick }]);
        h.drag([f.position.x, f.position.y], [0.5 + rnd() * 3, 0.5 + rnd() * 4]);
      } else if (roll < 0.5 && pick) {
        h.ui.getState().select([{ kind: 'furniture', id: pick }]);
        h.key('r');
      } else if (roll < 0.62 && pick) {
        h.ui.getState().select([{ kind: 'furniture', id: pick }]);
        h.key(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'][Math.floor(rnd() * 4)], { shift: rnd() < 0.5 });
      } else if (roll < 0.72 && pick) {
        h.ui.getState().select([{ kind: 'furniture', id: pick }]);
        h.ui.getState().select([{ kind: 'furniture', id: pick }]);
        h.key('Delete');
      } else if (roll < 0.82) {
        h.ui.getState().startPlacing({ kind: 'furniture', definitionId: ['side-table', 'armchair', 'bookshelf'][Math.floor(rnd() * 3)] });
        const x = 0.6 + rnd() * 2.8; const y = 0.6 + rnd() * 3.8;
        h.it.pointerMove(h.ptr(x, y));
        h.it.pointerDown(h.ptr(x, y));
        h.key('Escape');
      } else if (roll < 0.92) {
        h.key('z', { ctrl: true });
      } else {
        h.key('z', { ctrl: true, shift: true });
      }
    }
    return { final: h.state(), start, commands: h.project.getState().historyJSON().done, steps: 50 };
  }

  it.each([1, 2, 3, 4, 5, 6])('seed %i: replaying the stored history from the start reproduces the final project exactly', (seed) => {
    const { final, start, commands } = session(seed);
    const replayed = commands.reduce<Project>((s, c) => apply(c, s), start);
    expect(hashProject(replayed)).toBe(hashProject(final));
    expectProjectEqual(replayed, final);
  });
  it('the session is deterministic: the same seed gives the same hash twice', () => {
    expect(hashProject(session(9).final)).toBe(hashProject(session(9).final));
  });
  it('the sessions actually do things (commands are committed, undo and redo both occur)', () => {
    const counts = [1, 2, 3, 4, 5, 6].map((s) => session(s).commands.length);
    expect(Math.max(...counts)).toBeGreaterThan(5);
  });
});
