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

// ---------------------------------------------------------------- the ready-made test case
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BEST_GUESS_RACK, ESTIMATE_FIELDS, fillBlankRackWithGuesses, testCaseProject } from '../src/app/model';

describe('the test case (best-guess rack values, all marked estimated)', () => {
  const p = testCaseProject();
  const a = analyseApp(p);

  it('is the sample enclosure with racks on every wall, so there are bottles to count', () => {
    expect(p.enclosure).toEqual(sampleProject().enclosure);
    expect([...new Set(p.runs.map((r) => r.wall))].sort()).toEqual(['EAST', 'NORTH', 'SOUTH', 'WEST']);
    expect(p.runs.reduce((n, r) => n + r.units, 0)).toBe(8);
  });
  it('holds 1120 bottles: 8 units x 20 rows (2000 / 100) x 7 per row', () => {
    expect(a.racks.total).toEqual({ status: 'OK', capacity: 8 * 20 * 7 });
  });
  it('has no errors; the missing walkway minimum is only an information note', () => {
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(a.issues.map((i) => i.code)).toContain('WALKWAY_NOT_SET');
    expect(p.walkwayMm).toBeNull(); // the business's number, not a guess
  });
  it('marks EVERY guessed value as estimated (bottles per row is calculated, not a guess), and nothing else', () => {
    expect([...(p.estimated ?? [])].sort()).toEqual([...ESTIMATE_FIELDS].sort());
    for (const k of ESTIMATE_FIELDS) expect(p.rackSpec[k], k).not.toBeNull();
  });
  it('leaves the default project and the Sample blank (guesses only ever come from the Test case button)', () => {
    expect(sampleProject().estimated).toBeUndefined();
    expect(sampleProject().rackSpec.unitWidthMm).toBeNull();
  });
  it('overwriting works: type a bottles-per-row and it wins over the calculated one', () => {
    const changed = { ...p, rackSpec: { ...p.rackSpec, bottlesPerRow: 6 } };
    expect(analyseApp(changed).racks.total).toEqual({ status: 'OK', capacity: 8 * 20 * 6 });
    expect(changed.estimated).toContain('unitWidthMm');
  });
  it('bottles per row is CALCULATED (unit width / the bottle\'s pitch), so the Bottle setting moves the count: Bordeaux 7, Burgundy 6, Champagne 5', () => {
    expect(p.rackSpec.bottlesPerRow).toBeNull();
    const total = (bottle: 'BORDEAUX' | 'BURGUNDY' | 'CHAMPAGNE') => analyseApp({ ...p, bottle }).racks.total;
    expect(total('BORDEAUX')).toEqual({ status: 'OK', capacity: 8 * 20 * 7 });
    expect(total('BURGUNDY')).toEqual({ status: 'OK', capacity: 8 * 20 * 6 });
    expect(total('CHAMPAGNE')).toEqual({ status: 'OK', capacity: 8 * 20 * 5 });
  });
  it('a bottle the racks cannot hold (Magnum: too deep, pitch too small) puts every run in "not counted", never into the headline total', () => {
    const t = analyseApp({ ...p, bottle: 'MAGNUM' }).racks.total;
    expect(t).toEqual({ status: 'OK', capacity: 0, uncounted: { runs: 5, bottles: 8 * 20 * 4 } });
  });
  it('the estimated markers survive saving and opening; unknown markers are dropped', () => {
    expect(deserializeApp(serializeApp(p)).estimated).toEqual(p.estimated);
    const odd = JSON.parse(serializeApp(p));
    odd.estimated = ['unitWidthMm', 'nonsense', 42];
    expect(deserializeApp(JSON.stringify(odd)).estimated).toEqual(['unitWidthMm']);
  });
  it('the example file you can open is exactly the button\'s test case (run `npm run example` after changing it)', () => {
    const file = readFileSync(join(__dirname, '../examples/test-case-1.cellar.json'), 'utf8');
    expect(deserializeApp(file)).toEqual(p);
  });
});

describe('filling only the blanks with best guesses', () => {
  it('fills every blank rack field and marks just those estimated; rows per unit is left alone', () => {
    const p = fillBlankRackWithGuesses(sampleProject());
    for (const k of ESTIMATE_FIELDS) expect(p.rackSpec[k], k).toEqual(BEST_GUESS_RACK[k]);
    expect([...(p.estimated ?? [])].sort()).toEqual([...ESTIMATE_FIELDS].sort());
    expect(p.rackSpec.rowsPerUnit).toBeNull();
  });
  it('keeps anything the person has entered, and does not call it estimated', () => {
    const start = { ...sampleProject(), rackSpec: { ...sampleProject().rackSpec, unitWidthMm: 800, bottlesPerRow: 9 } };
    const p = fillBlankRackWithGuesses(start);
    expect(p.rackSpec.unitWidthMm).toBe(800);
    expect(p.rackSpec.bottlesPerRow).toBe(9);
    expect(p.rackSpec.unitDepthMm).toBe(350);
    expect(p.estimated).not.toContain('unitWidthMm');
    expect(p.estimated).not.toContain('bottlesPerRow');
    expect(p.estimated).toHaveLength(5);
  });
  it('does nothing (the same object) when nothing is blank, and is safe to repeat', () => {
    const full = testCaseProject();
    expect(fillBlankRackWithGuesses(full)).toBe(full);
    const once = fillBlankRackWithGuesses(sampleProject());
    expect(fillBlankRackWithGuesses(once)).toBe(once);
  });
  it('adds to existing estimated markers without duplicating them', () => {
    const start = { ...sampleProject(), rackSpec: { ...BEST_GUESS_RACK, postsPerUnit: null }, estimated: ['unitWidthMm' as const] };
    const p = fillBlankRackWithGuesses(start);
    expect(p.estimated).toEqual(['unitWidthMm', 'postsPerUnit']);
  });
  it('the Test case uses the same guesses', () => {
    expect(testCaseProject().rackSpec).toEqual(BEST_GUESS_RACK);
  });
});
