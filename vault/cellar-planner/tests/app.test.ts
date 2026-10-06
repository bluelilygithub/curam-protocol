import { describe, expect, it } from 'vitest';
import { analyseApp, deserializeApp, ParseError, sampleProject, serializeApp, sortIssues } from '../src/app/model';
import { createAppStore } from '../src/app/store';
import type { Issue } from '../src/engine';

describe('the starting project', () => {
  const p = sampleProject();
  it('has the sample enclosure, NO rack values and NO walkway minimum', () => {
    expect(p.enclosure.outerWidthMm).toBe(2850);
    expect(Object.values(p.rackSpec).every((v) => v === null || v === undefined)).toBe(true);
    expect(p.walkwayMm).toBeNull();
    expect(p.runs).toEqual([]);
  });
  it('analyses with no errors and total capacity 0 because there are no runs (a real zero, not "not set")', () => {
    const a = analyseApp(p);
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(a.racks.total).toEqual({ status: 'OK', capacity: 0 });
  });
  it('adding a run with the blank rack spec makes the total "not set", with RACK_SPEC_MISSING', () => {
    const q = { ...p, runs: [{ id: 'r1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    const a = analyseApp(q);
    expect(a.racks.total).toEqual({ status: 'NOT_SET', unsetRuns: 1 });
    expect(a.issues.map((i) => i.code)).toContain('RACK_SPEC_MISSING');
  });
  it('carries advisories separately from issues, all with the sign-off wording', () => {
    const a = analyseApp(p);
    expect(a.advisories.length).toBeGreaterThan(0);
    expect(a.advisories.every((x) => x.text.startsWith('Advisory only: requires mechanical engineer / HVAC sign-off.'))).toBe(true);
  });
});

describe('sorting issues', () => {
  it('errors, then warnings, then information, keeping order within each', () => {
    const mk = (code: string, severity: Issue['severity']): Issue => ({ code, severity, message: code });
    const sorted = sortIssues([mk('i1', 'info'), mk('w1', 'warning'), mk('e1', 'error'), mk('e2', 'error'), mk('i2', 'info')]);
    expect(sorted.map((i) => i.code)).toEqual(['e1', 'e2', 'w1', 'i1', 'i2']);
  });
});

describe('saving and loading', () => {
  it('round-trips, keeping blanks blank (a blank is never turned into 0)', () => {
    const p = sampleProject();
    const back = deserializeApp(serializeApp(p));
    expect(back).toEqual(p);
    expect(back.rackSpec.unitWidthMm).toBeNull();
    expect(back.walkwayMm).toBeNull();
  });
  it('rejects other files with a plain message', () => {
    for (const bad of ['', 'x', '{}', '[]', '{"schemaVersion":2}', '{"schemaVersion":1}', '{"schemaVersion":1,"enclosure":{}}']) expect(() => deserializeApp(bad)).toThrow(ParseError);
    expect(() => deserializeApp('nope')).toThrow(/not a Cellar Planner file/);
  });
  it('fills in what an older file lacks, with the rack spec staying blank', () => {
    const p = sampleProject();
    const old = JSON.stringify({ schemaVersion: 1, enclosure: p.enclosure });
    const back = deserializeApp(old);
    expect(back.rackSpec.unitWidthMm).toBeNull();
    expect(back.runs).toEqual([]);
    expect(back.name).toBe('My enclosure');
  });
});

describe('the store', () => {
  it('edits are one undo step each; undo, redo and a new edit clearing redo', () => {
    const s = createAppStore();
    s.getState().edit((p) => ({ ...p, name: 'One' }));
    s.getState().edit((p) => ({ ...p, name: 'Two' }));
    expect(s.getState().project.name).toBe('Two');
    expect(s.getState().undo()).toBe(true);
    expect(s.getState().project.name).toBe('One');
    expect(s.getState().redo()).toBe(true);
    expect(s.getState().project.name).toBe('Two');
    s.getState().undo();
    s.getState().edit((p) => ({ ...p, name: 'Three' }));
    expect(s.getState().future).toHaveLength(0);
    expect(s.getState().redo()).toBe(false);
  });
  it('an edit that changes nothing is not recorded', () => {
    const s = createAppStore();
    const rev = s.getState().revision;
    s.getState().edit((p) => p);
    expect(s.getState().past).toHaveLength(0);
    expect(s.getState().revision).toBe(rev);
    expect(s.getState().undo()).toBe(false);
  });
  it('loading starts fresh history', () => {
    const s = createAppStore();
    s.getState().edit((p) => ({ ...p, name: 'X' }));
    s.getState().load(sampleProject());
    expect(s.getState().past).toHaveLength(0);
    expect(s.getState().project.name).toBe('Sample enclosure (A101 as read)');
  });
});
