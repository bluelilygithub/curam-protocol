import { describe, expect, it, vi } from 'vitest';
import { newCellarProject } from '../src/domain/projectFactory';
import { DEFAULT_RULES, goldenCase01 } from '../src/engine';
import { bayCountOf, cellarCodec, chooseLibrary } from '../src/state/library';
import { deserializeProject, loadDraft, ParseError, projectFileName, serializeProject, startDraftAutosave, DRAFT_KEY } from '../src/state/persistence';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

describe('the file format', () => {
  it('round-trips a project exactly', () => {
    const p = goldenCase01();
    expect(deserializeProject(serializeProject(p))).toEqual(p);
  });
  it('rejects other files with a plain message', () => {
    for (const bad of ['', 'not json', '{}', '{"schemaVersion":2,"id":"x","room":{"walls":[]}}', '{"schemaVersion":1,"id":"x"}', '[]', 'null']) {
      expect(() => deserializeProject(bad)).toThrow(ParseError);
    }
    expect(() => deserializeProject('nope')).toThrow(/not a Cellar Planner file/);
  });
  it('fills in what an older or hand-edited file lacks, and keeps the rules a person overrode', () => {
    const p = deserializeProject(JSON.stringify({ schemaVersion: 1, id: 'a', room: { walls: [{ id: 'w', start: [0, 0], end: [1000, 0], startTermination: 'ROOM_WALL', endTermination: 'ROOM_WALL' }] }, rules: { boardMm: 18 } }));
    expect(p.rules).toEqual({ ...DEFAULT_RULES, boardMm: 18 });
    expect(p.room.walls[0].bays).toEqual([]);
    expect(p.room.doors).toEqual([]);
    expect(p.name).toBe('My cellar');
    expect(p.cornerOwnershipMode).toBe('LONGEST_WALL_FIRST');
  });
  it('makes a safe file name', () => {
    expect(projectFileName(newCellarProject('Dad\'s Cellar #1!', 'x'))).toBe('dad-s-cellar-1.cellar.json');
    expect(projectFileName({ ...newCellarProject('x', 'x'), name: '***' })).toBe('cellar.cellar.json');
  });
});

describe('the browser draft', () => {
  it('saves shortly after a change, and recovers', () => {
    vi.useFakeTimers();
    const s = mem();
    let p = newCellarProject('One', 'p');
    let fire: () => void = () => undefined;
    const auto = startDraftAutosave(s, () => p, (cb) => { fire = cb; return () => undefined; }, 400);
    fire();
    expect(s.m.has(DRAFT_KEY)).toBe(false);
    vi.advanceTimersByTime(401);
    expect(loadDraft(s)?.name).toBe('One');
    p = newCellarProject('Two', 'p');
    fire();
    auto.dispose(); // disposing flushes a pending save
    expect(loadDraft(s)?.name).toBe('Two');
    vi.useRealTimers();
  });
  it('a corrupt draft is ignored', () => {
    const s = mem();
    s.setItem(DRAFT_KEY, '{broken');
    expect(loadDraft(s)).toBeNull();
  });
});

describe('the library binding', () => {
  it('names, counts and capacity (the engine\'s answer) for the list', () => {
    const p = goldenCase01();
    expect(bayCountOf(p)).toBe(3);
    expect(cellarCodec.extra(p)).toEqual({ bayCount: 3, capacity: 384 });
    expect(cellarCodec.nameOf(p)).toBe('Golden Test Case #01');
    expect(cellarCodec.nameOf({ ...p, name: '   ' })).toBe('Untitled cellar');
  });
  it('reads a wire entry', () => {
    expect(cellarCodec.entryFromWire({ id: 7, name: 'x', bayCount: '3', capacity: '384', updatedAt: '2026-01-01T00:00:00Z' })).toEqual({ id: '7', name: 'x', bayCount: 3, capacity: 384, updatedAt: '2026-01-01T00:00:00.000Z' });
  });
  it('with no server, saves to and lists from this browser', async () => {
    const storage = mem();
    let n = 0;
    const chosen = await chooseLibrary({ storage, fetch: undefined, newId: () => `id${++n}` });
    const p = goldenCase01();
    const created = await chosen.library.create(p);
    expect(created.name).toBe('Golden Test Case #01');
    const list = await chosen.library.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ bayCount: 3, capacity: 384 });
    const { project: back } = await chosen.library.load(created.id);
    expect(back).toEqual(p);
  });
});
