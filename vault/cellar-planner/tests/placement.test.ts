import { describe, expect, it } from 'vitest';
import { goldenCase02, internalSize, type Enclosure } from '../src/enclosure';
import { analyseRacks, doorOpening, fillWall, footprint, hingeAt, hitsDoorSwing, type RackRun } from '../src/placement';
import { blankRackSpec, type RackSpec } from '../src/rack';

// Every rack size here is INVENTED to exercise the geometry; none is a supplier's value. The enclosure is Golden #02 (2750 x 1565 x 2150 inside,
// door on the south wall from 890 to 1860 mm).
const spec = (over: Partial<RackSpec> = {}): RackSpec => ({ unitWidthMm: 800, unitDepthMm: 350, unitHeightMm: 2000, rowPitchMm: 100, bottlesPerRow: 8, orientation: 'NECK_OUT', postsPerUnit: 2, rowsPerUnit: null, ...over });
const run = (id: string, wall: RackRun['wall'], startMm: number, units: number, s: RackSpec = spec()): RackRun => ({ id, wall, startMm, units, spec: s, bottle: 'BORDEAUX' });
const codes = (e: Enclosure, runs: RackRun[], walkwayMm?: number) => analyseRacks(e, runs, { walkwayMm }).issues.map((i) => i.code);

describe('the door in inside coordinates', () => {
  const e = goldenCase02();
  it('the 940 | 970 | 940 split is 890 to 1860 mm along the inside of the south wall (940 less the 50 mm west panel)', () => {
    expect(internalSize(e)).toEqual({ widthMm: 2750, depthMm: 1565, heightMm: 2150 });
    expect(doorOpening(e)).toEqual({ wall: 'SOUTH', aMm: 890, bMm: 1860 });
  });
  it('the hinge is seen from outside: on the south wall left is the west end, right the east end', () => {
    expect(hingeAt({ ...e, door: { ...e.door, hinge: 'LEFT' } })).toBe(890);
    expect(hingeAt({ ...e, door: { ...e.door, hinge: 'RIGHT' } })).toBe(1860);
    expect(hingeAt({ ...e, door: { ...e.door, wall: 'NORTH', hinge: 'LEFT' } })).toBe(1860);
  });
});

describe('footprints', () => {
  const e = goldenCase02();
  it('a run along the north wall is 800 x 350 per unit, against that wall', () => {
    const f = footprint(e, run('n', 'NORTH', 100, 2));
    expect(f).toMatchObject({ status: 'OK', lengthMm: 1600, depthMm: 350, rect: { x0: 100, x1: 1700, y0: 0, y1: 350 } });
  });
  it('south, west and east runs sit against their own walls', () => {
    expect(footprint(e, run('s', 'SOUTH', 0, 1))).toMatchObject({ rect: { x0: 0, x1: 800, y0: 1565 - 350, y1: 1565 } });
    expect(footprint(e, run('w', 'WEST', 0, 1))).toMatchObject({ rect: { x0: 0, x1: 350, y0: 0, y1: 800 } });
    expect(footprint(e, run('e', 'EAST', 0, 1))).toMatchObject({ rect: { x0: 2750 - 350, x1: 2750, y0: 0, y1: 800 } });
  });
  it('a blank unit width or depth has NO footprint ("not set"), never a zero-size rack', () => {
    const f = footprint(e, run('b', 'NORTH', 0, 3, blankRackSpec()));
    expect(f).toEqual({ status: 'NOT_SET', missing: ['unit width', 'unit depth'] });
    expect(footprint(e, run('b', 'NORTH', 0, 3, spec({ unitDepthMm: null })))).toEqual({ status: 'NOT_SET', missing: ['unit depth'] });
  });
});

describe('fitting runs', () => {
  const e = goldenCase02();
  it('three 800 mm units fit along the 2750 mm north wall; four do not', () => {
    expect(codes(e, [run('n', 'NORTH', 0, 3)])).not.toContain('RUN_OUTSIDE');
    const four = analyseRacks(e, [run('n', 'NORTH', 0, 4)]).issues.find((i) => i.code === 'RUN_OUTSIDE');
    expect(four?.fix).toMatch(/at most 3 units/);
  });
  it('a run starting before the wall, or a unit deeper than the enclosure, is an error', () => {
    expect(codes(e, [run('n', 'NORTH', -10, 1)])).toContain('RUN_OUTSIDE');
    expect(codes(e, [run('n', 'NORTH', 0, 1, spec({ unitDepthMm: 1700 }))])).toContain('RUN_TOO_DEEP');
  });
  it('a unit taller than the 2150 mm inside is an error', () => {
    expect(codes(e, [run('n', 'NORTH', 0, 1, spec({ unitHeightMm: 2300 }))])).toContain('RACK_TOO_TALL');
  });
  it('fillWall puts whole units either side of the door on the door wall', () => {
    const f = fillWall(e, 'SOUTH', spec(), 'BORDEAUX');
    expect(f).toMatchObject({ status: 'OK', runs: [{ startMm: 0, units: 1 }, { startMm: 1860, units: 1 }] });
    expect(analyseRacks(e, (f as { runs: RackRun[] }).runs).issues.filter((i) => i.code === 'RUN_ON_DOOR')).toEqual([]);
  });
  it('fillWall fills a wall without the door in one run, and says "not set" for a blank width', () => {
    expect(fillWall(e, 'NORTH', spec(), 'BORDEAUX')).toMatchObject({ status: 'OK', runs: [{ startMm: 0, units: 3 }] });
    expect(fillWall(e, 'NORTH', blankRackSpec(), 'BORDEAUX')).toEqual({ status: 'NOT_SET', missing: ['unit width'] });
  });
});

describe('the door', () => {
  const e = goldenCase02();
  it('a run across the door opening is an error', () => {
    expect(codes(e, [run('s', 'SOUTH', 700, 1)])).toContain('RUN_ON_DOOR');
    expect(codes(e, [run('s', 'SOUTH', 0, 1)])).not.toContain('RUN_ON_DOOR');
  });
  it('the floor in front of the door must stay clear: a 700 mm deep run opposite blocks it, a 600 mm one does not', () => {
    expect(codes(e, [run('n', 'NORTH', 890, 1, spec({ unitDepthMm: 700 }))])).toContain('DOOR_PATH_BLOCKED');
    expect(codes(e, [run('n', 'NORTH', 890, 1, spec({ unitDepthMm: 600 }))])).not.toContain('DOOR_PATH_BLOCKED');
  });
  it('an inward swing sweeps a quarter circle of 970 mm: only a run that reaches it is an error', () => {
    const inward: Enclosure = { ...e, door: { ...e.door, swing: 'IN', hinge: 'LEFT' } };
    expect(hitsDoorSwing(inward, { x0: 890, x1: 1700, y0: 0, y1: 700 })).toBe(true);
    expect(hitsDoorSwing(inward, { x0: 890, x1: 1700, y0: 0, y1: 350 })).toBe(false);
    expect(hitsDoorSwing(e, { x0: 890, x1: 1700, y0: 0, y1: 700 })).toBe(false); // an outward door sweeps outside
    expect(codes(inward, [run('n', 'NORTH', 890, 1, spec({ unitDepthMm: 700 }))])).toContain('RUN_IN_DOOR_SWING');
  });
  it('the corner of the swing is a circle, not a square: a run just outside the arc is fine', () => {
    const inward: Enclosure = { ...e, door: { ...e.door, swing: 'IN', hinge: 'LEFT' } };
    // hinge at s = 890; a rectangle 900 in along the wall and 700 in from it, but starting past the arc's reach on the far side
    const far = { x0: 1850, x1: 2000, y0: 565, y1: 800 }; // d = 1565 - y: 765..1000, s 1850..2000
    expect(hitsDoorSwing(inward, far)).toBe(false);
  });
});

describe('overlap and walkway', () => {
  const e = goldenCase02();
  it('two runs on adjacent walls overlap at the corner unless the second starts after the first\'s depth', () => {
    expect(codes(e, [run('n', 'NORTH', 0, 1), run('w', 'WEST', 0, 1)])).toContain('RUN_OVERLAP');
    expect(codes(e, [run('n', 'NORTH', 0, 1), run('w', 'WEST', 350, 1)])).not.toContain('RUN_OVERLAP');
  });
  it('facing runs need the walkway between them: 350 + 350 leaves 865 mm of 1565, too narrow at 900, fine at 800', () => {
    const pair = [run('n', 'NORTH', 0, 1), run('s', 'SOUTH', 0, 1)];
    const w = analyseRacks(e, pair).issues.filter((i) => i.code === 'WALKWAY_TOO_NARROW');
    expect(w).toHaveLength(1); // one report for the pair, not two
    expect(w[0].message).toMatch(/Only 865 mm is left to walk between these runs/);
    expect(codes(e, pair, 800)).not.toContain('WALKWAY_TOO_NARROW');
  });
  it('a run with nothing opposite still needs room to walk in front of it', () => {
    expect(codes(e, [run('n', 'NORTH', 0, 1, spec({ unitDepthMm: 800 }))])).toContain('WALKWAY_TOO_NARROW');
    expect(codes(e, [run('n', 'NORTH', 0, 1)])).not.toContain('WALKWAY_TOO_NARROW');
  });
  it('facing runs that do not overlap along the wall do not narrow each other', () => {
    expect(codes(e, [run('n', 'NORTH', 0, 1, spec({ unitDepthMm: 400 })), run('s', 'SOUTH', 1860, 1, spec({ unitDepthMm: 400 }))], 800)).not.toContain('WALKWAY_TOO_NARROW');
  });
});

describe('capacity follows the runs, and stays "not set" with a blank spec', () => {
  const e = goldenCase02();
  it('adds up rows x bottles per row x units over every run', () => {
    const a = analyseRacks(e, [run('a', 'NORTH', 0, 2), run('b', 'NORTH', 1600, 1)]);
    expect(a.total).toEqual({ status: 'OK', capacity: 20 * 8 * 3 });
  });
  it('one blank run makes the total "not set", naming how many; the others are not hidden', () => {
    const a = analyseRacks(e, [run('a', 'NORTH', 0, 2), run('b', 'SOUTH', 0, 1, blankRackSpec())]);
    expect(a.total).toEqual({ status: 'NOT_SET', unsetRuns: 1 });
    expect(a.runs[0].capacity).toMatchObject({ status: 'OK', capacity: 320 });
    expect(a.runs[1].footprint.status).toBe('NOT_SET');
    expect(a.issues.map((i) => i.code)).toContain('RACK_SPEC_MISSING');
    expect(a.issues.find((i) => i.code === 'RACK_SPEC_MISSING')?.where).toBe('b');
  });
  it('a blank run is skipped by the geometry: no overlap or outside errors from a footprint that does not exist', () => {
    const geometry = analyseRacks(e, [run('b', 'NORTH', 0, 99, blankRackSpec())]).issues.filter((i) => i.code !== 'RACK_SPEC_MISSING');
    expect(geometry).toEqual([]);
  });
  it('no runs at all is a real zero', () => {
    expect(analyseRacks(e, []).total).toEqual({ status: 'OK', capacity: 0 });
  });
});
