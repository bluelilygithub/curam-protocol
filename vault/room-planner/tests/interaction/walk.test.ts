// Walk mode state and controls (Spec Addition A1, C4): exclusive with the fly-through, edits blocked, Esc stops, nothing touches the design.
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/createApp';
import { makeInstance, makeProject, makeRoom } from '../helpers';
import { makeHarness } from './harness';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

describe('starting and stopping', () => {
  it('starts in a room with space, without touching the project or its history', () => {
    const app = createApp(store());
    app.startRectangle();
    app.setViewMode('3d');
    const before = app.project.getState().project;
    const hist = app.project.getState().historyLength();
    expect(app.startWalk()).toBe(true);
    expect(app.ui.getState().walking).toBe(true);
    app.stopWalk();
    expect(app.ui.getState().walking).toBe(false);
    expect(app.project.getState().project).toBe(before);
    expect(app.project.getState().historyLength()).toBe(hist);
  });

  it('says so, and stays put, when the floor is too small or full to stand on', () => {
    const app = createApp(store());
    const full = makeRoom({ furniture: [makeInstance({ id: 'big', position: { x: 2, y: 2.5 }, width: 4, length: 5, height: 1 })] });
    app.project.getState().load(makeProject([full]));
    app.setViewMode('3d');
    expect(app.startWalk()).toBe(false);
    expect(app.ui.getState().walking).toBe(false);
    expect(app.ui.getState().status?.severity).toBe('warn');
    expect(app.ui.getState().status?.text).toMatch(/no room to walk/i);
  });

  it('does nothing without a room', () => {
    const app = createApp(store());
    expect(app.startWalk()).toBe(false);
    expect(app.ui.getState().walking).toBe(false);
  });

  it('toggleWalk starts and stops', () => {
    const app = createApp(store());
    app.startRectangle();
    app.toggleWalk();
    expect(app.ui.getState().walking).toBe(true);
    app.toggleWalk();
    expect(app.ui.getState().walking).toBe(false);
  });

  it('is exclusive with the fly-through in both directions', () => {
    const app = createApp(store());
    app.startRectangle();
    app.ui.getState().setCinematic(true);
    app.ui.getState().setTourPlaying(true);
    app.startWalk();
    expect([app.ui.getState().walking, app.ui.getState().tourPlaying]).toEqual([true, false]);
    app.ui.getState().setTourPlaying(true);
    expect([app.ui.getState().walking, app.ui.getState().tourPlaying]).toEqual([false, true]);
  });

  it('leaving 3D stops walking', () => {
    const h = makeHarness({ furniture: [] });
    h.ui.getState().setViewMode('3d');
    h.ui.getState().setWalking(true);
    h.it.switchView('2d');
    expect(h.ui.getState().walking).toBe(false);
  });

  it('works with or without Cinematic (the look is independent)', () => {
    const app = createApp(store());
    app.startRectangle();
    app.startWalk();
    expect(app.ui.getState().cinematic).toBe(false);
    app.ui.getState().setCinematic(true);
    expect(app.ui.getState().walking).toBe(true);
  });
});

describe('while walking nothing edits the design', () => {
  it('Esc stops walking; every other key is swallowed (Delete, R, arrows, V, Space, tool keys, undo/redo)', () => {
    const h = makeHarness({ furniture: [makeInstance({ id: 'a', definitionId: 'sofa-3', width: 2.2, length: 0.95, height: 0.85, position: { x: 2, y: 2.5 } })] });
    h.ui.getState().setViewMode('3d');
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.project.getState().commit({ type: 'MoveFurniture', instanceId: 'a', from: { x: 2, y: 2.5 }, to: { x: 2, y: 2.6 } }, 'move');
    const before = JSON.stringify(h.state());
    h.ui.getState().setWalking(true);
    for (const k of ['Delete', 'r', 'ArrowUp', 'ArrowLeft', 'v', ' ', '1', '3', 'w', 'a', 's', 'd']) expect(h.key(k)).toBe(true);
    h.key('z', { ctrl: true });
    h.key('y', { ctrl: true });
    h.key('d', { ctrl: true });
    expect(JSON.stringify(h.state())).toBe(before);
    expect(h.project.getState().canUndo).toBe(true);
    expect(h.ui.getState().viewMode).toBe('3d');
    expect(h.ui.getState().walking).toBe(true);
    h.key('Escape');
    expect(h.ui.getState().walking).toBe(false);
    expect(JSON.stringify(h.state())).toBe(before);
  });

  it('after walking, keys work again', () => {
    const h = makeHarness({ furniture: [makeInstance({ id: 'a', definitionId: 'sofa-3', width: 2.2, length: 0.95, height: 0.85 })] });
    h.ui.getState().setViewMode('3d');
    h.ui.getState().setWalking(true);
    h.key('Escape');
    h.ui.getState().select([{ kind: 'furniture', id: 'a' }]);
    h.key('Delete');
    expect(h.room().furniture).toHaveLength(0);
  });
});

describe('the live input is not a store', () => {
  it('walkInput is a plain object that never notifies subscribers (A12)', () => {
    const app = createApp(store());
    let n = 0;
    app.ui.subscribe(() => { n++; });
    app.project.subscribe(() => { n++; });
    for (let i = 0; i < 100; i++) { app.walkInput.keys.add('forward'); app.walkInput.padX = Math.sin(i); app.walkInput.padY = Math.cos(i); }
    expect(n).toBe(0);
  });
});
