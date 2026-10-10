import { describe, expect, it } from 'vitest';
import { fixAll, suggestFix } from '../src/app/fixes';
import { analyseApp, sampleProject, testCaseProject, type AppProject } from '../src/app/model';
import { alongLength, errorsForRun, issuesForRun, nearestValidStart, placeRun, snapAnchors, snapStart, withRun } from '../src/app/runMove';

// The test case: inside 2750 x 1565 mm, a south-wall door opening from 890 to 1860 mm, units 600 wide and 350 deep.
//   north-1: 4 units from 0 (2400 long) | south-1: 1 unit from 0 | south-2: 1 unit from 1860 | west-1 and east-1: 1 unit from 350
const base = (): AppProject => testCaseProject();
const errorCount = (p: AppProject): number => analyseApp(p).issues.filter((i) => i.severity === 'error').length;
const run = (p: AppProject, id: string) => p.runs.find((r) => r.id === id)!;

describe('the starting design is clean', () => {
  it('has no errors', () => { expect(errorCount(base())).toBe(0); });
  it('wall lengths are the inside sizes', () => {
    const p = base();
    expect([alongLength(p, 'NORTH'), alongLength(p, 'SOUTH'), alongLength(p, 'EAST'), alongLength(p, 'WEST')]).toEqual([2750, 2750, 1565, 1565]);
  });
});

describe('where a run snaps', () => {
  it('to the ends of its wall, the door opening, other runs, and clear of runs on the end walls', () => {
    const north = snapAnchors(base(), 'north-1')!;
    expect(north.map((a) => a.at)).toEqual([0, 350]); // wall start/west-run clear, wall end/east-run clear
    const south = snapAnchors(base(), 'south-1')!;
    expect(south.map((a) => a.at)).toContain(290); // its end meets the door opening at 890: 890 - 600
    expect(south.find((a) => a.at === 290)!.label).toBe('the door opening');
    const s2 = snapAnchors(base(), 'south-2')!;
    expect(s2.some((a) => a.at === 1860 && a.label === 'the door opening')).toBe(true);
    expect(s2.map((a) => a.at)).toContain(2150); // the end of the wall: 2750 - 600
  });
  it('another run on the same wall offers its ends', () => {
    const p = withRun(base(), 'south-2', { startMm: 2000 });
    expect(snapAnchors(p, 'south-1')!.some((a) => a.label === 'the start of south-2' && a.at === 1400)).toBe(true);
    expect(snapAnchors(p, 'south-2')!.some((a) => a.label === 'the end of south-1' && a.at === 600)).toBe(true);
  });
  it('a run with no size yet cannot be placed by position', () => {
    const blank = { ...sampleProject(), runs: [{ id: 'run-1', wall: 'NORTH' as const, startMm: 0, units: 2 }] };
    expect(snapAnchors(blank, 'run-1')).toBeNull();
    expect(snapStart(blank, 'run-1', 100, 30)).toBeNull();
    expect(placeRun(blank, 'run-1', 100, 30)).toBeNull();
    expect(snapAnchors(base(), 'nope')).toBeNull();
  });
  it('snaps within the threshold, not outside it, keeps millimetres otherwise and stays inside the wall', () => {
    const p = base();
    expect(snapStart(p, 'north-1', 20, 30)).toEqual({ startMm: 0, snap: 'the start of the wall' });
    expect(snapStart(p, 'north-1', 340, 30)!.startMm).toBe(350);
    expect(snapStart(p, 'north-1', 200, 30)).toEqual({ startMm: 200, snap: null });
    expect(snapStart(p, 'north-1', 200.6, 30)!.startMm).toBe(201);
    expect(snapStart(p, 'north-1', -500, 30)!.startMm).toBe(0);
    expect(snapStart(p, 'north-1', 99999, 30)!.startMm).toBe(350); // past the end: the last place it fits
  });
  it('the nearest anchor wins when two are in range', () => {
    const p = withRun(base(), 'south-1', { startMm: 0 });
    // anchors 0 and 290 are 290 apart; with a huge threshold the nearer one is chosen
    expect(snapStart(p, 'south-1', 200, 1000)!.startMm).toBe(290);
    expect(snapStart(p, 'south-1', 100, 1000)!.startMm).toBe(0);
  });
});

describe('whether a position is acceptable', () => {
  it('against the door opening: refused, with the reason', () => {
    const r = placeRun(base(), 'south-1', 500, 0)!;
    expect(r.startMm).toBe(500);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('RUN_ON_DOOR');
  });
  it('snapped to the door opening: fine', () => {
    const r = placeRun(base(), 'south-1', 280, 30)!;
    expect([r.startMm, r.snap, r.ok, r.errors.length]).toEqual([290, 'the door opening', true, 0]);
  });
  it('past the wall end is impossible: the position is held inside the wall', () => {
    const r = placeRun(base(), 'north-1', 800, 0)!;
    expect(r.startMm).toBe(350); expect(r.ok).toBe(true);
  });
  it('overlapping another run is refused for BOTH runs\' sake and names the overlap', () => {
    const r = placeRun(base(), 'south-2', 1000, 0)!; // 1000..1600 across the door opening
    expect(r.ok).toBe(false);
    const west = withRun(base(), 'north-1', { startMm: 0 });
    const over = placeRun(west, 'west-1', 0, 0)!; // west unit up against the north run's depth
    expect(over.ok).toBe(false);
    expect(over.errors.map((e) => e.code)).toContain('RUN_OVERLAP');
  });
  it('a run that already has an error may move if it does not get worse', () => {
    const broken = withRun(base(), 'south-1', { startMm: 500 });
    expect(errorsForRun(broken, 'south-1').length).toBeGreaterThan(0);
    const still = placeRun(broken, 'south-1', 600, 0)!;
    expect(still.before).toBeGreaterThan(0); expect(still.ok).toBe(true); // moved, still on the door, not worse
    expect(placeRun(broken, 'south-1', 290, 0)!.errors).toEqual([]);
  });
  it('issuesForRun finds a run\'s own issues and overlaps it is either side of', () => {
    const p = withRun(base(), 'west-1', { startMm: 0 });
    const issues = analyseApp(p).issues;
    expect(issuesForRun(issues, 'west-1').some((i) => i.code === 'RUN_OVERLAP')).toBe(true);
    expect(issuesForRun(issues, 'north-1').some((i) => i.code === 'RUN_OVERLAP')).toBe(true);
    expect(issuesForRun(issues, 'south-2').filter((i) => i.code === 'RUN_OVERLAP')).toEqual([]);
  });
  it('does not change the design it was given', () => {
    const p = base(); const before = JSON.stringify(p);
    placeRun(p, 'south-1', 500, 30); nearestValidStart(p, 'south-1');
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('the nearest valid position', () => {
  it('slides to the closest place that has no error', () => {
    expect(nearestValidStart(withRun(base(), 'south-1', { startMm: 500 }), 'south-1')).toBe(290);
    expect(nearestValidStart(withRun(base(), 'north-1', { startMm: 600 }), 'north-1')).toBe(350);
  });
  it('is the current position when that is already fine', () => {
    expect(nearestValidStart(base(), 'south-1')).toBe(0);
  });
  it('can try fewer units, and says none when nothing fits', () => {
    const wide = withRun(base(), 'north-1', { units: 9 });
    expect(nearestValidStart(wide, 'north-1')).toBeNull();
    expect(nearestValidStart(wide, 'north-1', 4)).toBe(0);
    expect(nearestValidStart(base(), 'nope')).toBeNull();
  });
});

describe('one-click fixes', () => {
  const issue = (p: AppProject, code: string) => analyseApp(p).issues.find((i) => i.code === code)!;
  it('a run past the end of its wall: move it to the nearest place it fits', () => {
    const p = withRun(base(), 'north-1', { startMm: 600 });
    const f = suggestFix(p, issue(p, 'RUN_OUTSIDE'))!;
    expect(f.label).toBe('Move north-1 to 350 mm');
    const fixed = f.apply(p);
    expect(run(fixed, 'north-1').startMm).toBe(350);
    expect(analyseApp(fixed).issues.some((i) => i.code === 'RUN_OUTSIDE')).toBe(false);
    expect(errorCount(fixed)).toBe(0);
    expect(run(p, 'north-1').startMm).toBe(600); // the original is untouched
  });
  it('a run across the door: slides clear of it', () => {
    const p = withRun(base(), 'south-1', { startMm: 500 });
    const f = suggestFix(p, issue(p, 'RUN_ON_DOOR'))!;
    expect(f.label).toBe('Move south-1 to 290 mm'); expect(errorCount(f.apply(p))).toBe(0);
  });
  it('a run too long for its wall: shorten by whole units', () => {
    const p = withRun(base(), 'north-1', { units: 9 });
    const f = suggestFix(p, issue(p, 'RUN_OUTSIDE'))!;
    expect(f.label).toBe('Shorten north-1 to 4 units');
    expect(run(f.apply(p), 'north-1')).toMatchObject({ units: 4 }); expect(errorCount(f.apply(p))).toBe(0);
  });
  it('two overlapping runs: moves one of them', () => {
    const p = withRun(base(), 'west-1', { startMm: 0 });
    const f = suggestFix(p, issue(p, 'RUN_OVERLAP'))!;
    expect(f.label).toMatch(/^(Move|Shorten) /); expect(errorCount(f.apply(p))).toBeLessThan(errorCount(p));
  });
  it('a door too wide, too tall or off its wall', () => {
    const wide = { ...base(), enclosure: { ...base().enclosure, door: { ...base().enclosure.door, widthMm: 2800 } } };
    const fw = suggestFix(wide, issue(wide, 'DOOR_TOO_WIDE'))!;
    expect(fw.label).toBe('Make the door 2750 mm wide'); expect(analyseApp(fw.apply(wide)).issues.some((i) => i.code === 'DOOR_TOO_WIDE')).toBe(false);
    const tall = { ...base(), enclosure: { ...base().enclosure, door: { ...base().enclosure.door, heightMm: 5000 } } };
    const ft = suggestFix(tall, issue(tall, 'DOOR_TOO_TALL'))!;
    expect(ft.label).toBe('Make the door 2150 mm tall'); expect(analyseApp(ft.apply(tall)).issues.some((i) => i.code === 'DOOR_TOO_TALL')).toBe(false);
    const off = { ...base(), enclosure: { ...base().enclosure, door: { ...base().enclosure.door, offsetMm: 5000 } } };
    const fo = suggestFix(off, issue(off, 'DOOR_OFF_WALL'))!;
    expect(fo.label).toBe('Centre the door on its wall'); expect('offsetMm' in fo.apply(off).enclosure.door).toBe(false); expect(errorCount(fo.apply(off))).toBe(0);
  });
  it('a header part outside the header: moved inside', () => {
    const p = base();
    const c = p.enclosure.header[0]!;
    const broken = { ...p, enclosure: { ...p.enclosure, header: [{ ...c, xMm: p.enclosure.outerWidthMm }] } };
    const i = issue(broken, 'HEADER_COMPONENT_OUTSIDE');
    const f = suggestFix(broken, i)!;
    expect(f.label).toBe(`Move ${c.id} inside the header`);
    expect(analyseApp(f.apply(broken)).issues.some((x) => x.code === 'HEADER_COMPONENT_OUTSIDE')).toBe(false);
  });
  it('errors that need a decision have no fix, and neither do warnings', () => {
    const tall = { ...base(), rackSpec: { ...base().rackSpec, unitHeightMm: 99999 } };
    for (const i of analyseApp(tall).issues.filter((x) => x.severity === 'error')) expect(suggestFix(tall, i), i.code).toBeNull();
    const w = analyseApp({ ...base(), walkwayMm: 2000 }).issues.find((i) => i.severity === 'warning');
    if (w) expect(suggestFix({ ...base(), walkwayMm: 2000 }, w)).toBeNull();
  });
  it('a fix that would not help is never offered', () => {
    // a run that cannot fit anywhere on its wall at any length >= 1 unit: the wall is full of a longer run than the wall
    const p = withRun(base(), 'north-1', { units: 1 });
    const squeezed = { ...p, rackSpec: { ...p.rackSpec, unitWidthMm: 3000 } };
    for (const i of analyseApp(squeezed).issues.filter((x) => x.code === 'RUN_OUTSIDE')) {
      const f = suggestFix(squeezed, i);
      if (f) expect(errorCount(f.apply(squeezed))).toBeLessThan(errorCount(squeezed));
    }
  });
  it('fix all clears everything fixable, in order, and never makes the design worse', () => {
    let p = withRun(base(), 'north-1', { startMm: 600 });
    p = withRun(p, 'south-1', { startMm: 500 });
    p = { ...p, enclosure: { ...p.enclosure, door: { ...p.enclosure.door, heightMm: 5000 } } };
    const before = errorCount(p);
    expect(before).toBeGreaterThanOrEqual(3);
    const r = fixAll(p);
    expect(r.applied.length).toBeGreaterThanOrEqual(2);
    expect(errorCount(r.project)).toBeLessThan(before);
    expect(errorCount(r.project)).toBe(0);
    expect(fixAll(r.project).applied).toEqual([]); // nothing more to do
  });
  it('fix all on a clean design does nothing and returns it unchanged', () => {
    const p = base(); const r = fixAll(p);
    expect(r.applied).toEqual([]); expect(r.project).toBe(p);
  });
  it('fix all always ends with no more errors than it started with, for many broken designs', () => {
    const starts = [0, 100, 350, 600, 1000, 2000, 2700, 5000];
    for (const s of starts) for (const id of ['north-1', 'south-1', 'south-2', 'west-1', 'east-1']) {
      const p = withRun(base(), id, { startMm: s });
      expect(errorCount(fixAll(p).project), `${id}@${s}`).toBeLessThanOrEqual(errorCount(p));
    }
  });
});
