import { describe, expect, it } from 'vitest';
import { apply, CommandHistory, deserializeProject, serializeProject, SerializeError, canonicalStringify } from '../../src/engine';
import type { Command, Project } from '../../src/engine';
import { expectProjectEqual, makeInstance, makeProject, makeRoom } from '../helpers';

const place = (id: string, x: number, y: number): Command => ({ type: 'PlaceFurniture', instance: makeInstance({ id, position: { x, y } }) });
const move = (id: string, from: [number, number], to: [number, number]): Command => ({
  type: 'MoveFurniture', instanceId: id, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] },
});

describe('CommandHistory', () => {
  const start = (): Project => makeProject([makeRoom()]);

  it('place → move → undo → redo', () => {
    const h = new CommandHistory();
    let s = start();
    for (const c of [place('a', 1, 1), move('a', [1, 1], [2, 2])]) { s = apply(c, s); h.push(c); }
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    s = h.undo(s)!;
    expect(s.rooms[0].furniture[0].position).toEqual({ x: 1, y: 1 });
    expect(h.canRedo()).toBe(true);
    s = h.redo(s)!;
    expect(s.rooms[0].furniture[0].position).toEqual({ x: 2, y: 2 });
  });
  it('undo/redo return null at the ends', () => {
    const h = new CommandHistory();
    expect(h.undo(start())).toBeNull();
    expect(h.redo(start())).toBeNull();
    expect(h.canUndo()).toBe(false);
  });
  it('pushing after an undo discards the redo branch', () => {
    const h = new CommandHistory();
    let s = start();
    for (const c of [place('a', 1, 1), place('b', 3, 3)]) { s = apply(c, s); h.push(c); }
    s = h.undo(s)!;
    const c = place('c', 2, 2);
    s = apply(c, s);
    h.push(c);
    expect(h.canRedo()).toBe(false);
  });
  it('a Composite is ONE history entry and undo restores both objects', () => {
    const h = new CommandHistory();
    let s = start();
    for (const c of [place('a', 1, 1), place('b', 3, 3)]) { s = apply(c, s); h.push(c); }
    const before = s;
    const group: Command = { type: 'Composite', commands: [move('a', [1, 1], [1.5, 1]), move('b', [3, 3], [3.5, 3])] };
    s = apply(group, s);
    h.push(group);
    expect(h.length).toBe(3);
    s = h.undo(s)!;
    expectProjectEqual(s, before);
    expect(h.length).toBe(2);
  });
  it('a failing undo leaves the stacks unchanged', () => {
    const h = new CommandHistory();
    h.push(move('ghost', [0, 0], [1, 1]));
    expect(() => h.undo(start())).toThrow();
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });
  it('round-trips through JSON (commands are serialisable)', () => {
    const h = new CommandHistory();
    let s = start();
    for (const c of [place('a', 1, 1), move('a', [1, 1], [2, 2])]) { s = apply(c, s); h.push(c); }
    s = h.undo(s)!;
    const restored = CommandHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(restored.canUndo()).toBe(true);
    expect(restored.canRedo()).toBe(true);
    expectProjectEqual(restored.redo(s)!, apply(move('a', [1, 1], [2, 2]), s));
  });
});

describe('serialize', () => {
  const project = (): Project =>
    apply(place('a', 1.5, 2), makeProject([makeRoom({ fixtures: [] })]));

  it('round-trips with schemaVersion present, linear values exact', () => {
    const p = project();
    const json = serializeProject(p);
    expect(JSON.parse(json).schemaVersion).toBe(1);
    expectProjectEqual(deserializeProject(json), p);
  });
  it('output is canonical: serialize(deserialize(x)) is byte-identical', () => {
    const json = serializeProject(project());
    expect(serializeProject(deserializeProject(json))).toBe(json);
  });
  it('rotation survives within 1e-9 rad', () => {
    const p = project();
    p.rooms[0].furniture[0].rotation = (37 * Math.PI) / 180;
    const back = deserializeProject(serializeProject(p));
    expect(Math.abs(back.rooms[0].furniture[0].rotation - p.rooms[0].furniture[0].rotation)).toBeLessThan(1e-9);
  });
  it('canonicalStringify sorts keys, drops undefined, and never writes -0', () => {
    expect(canonicalStringify({ b: 1, a: undefined, c: { z: -0, y: 2 } })).toBe('{"b":1,"c":{"y":2,"z":0}}');
  });
  it('rejects bad input with SerializeError', () => {
    expect(() => deserializeProject('{nope')).toThrow(SerializeError);
    expect(() => deserializeProject('null')).toThrow(SerializeError);
    expect(() => deserializeProject(JSON.stringify({ ...project(), schemaVersion: 2 }))).toThrow(/schemaVersion/);
    expect(() => deserializeProject(JSON.stringify({ schemaVersion: 1, id: 'x' }))).toThrow(/malformed/);
  });
});
