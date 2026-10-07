import { describe, expect, it } from 'vitest';
import { goldenCase02, type Enclosure } from '../src/enclosure';
import { analyseRacks, hingeAt, type RackRun } from '../src/placement';
import { blankRackSpec, type RackSpec } from '../src/rack';
import { badRunIds, boundsOf, elevationView, fitView, planView, type Prim } from '../src/views';

// Rack sizes are INVENTED. The enclosure is Golden #02 (the Carter Noir sample as read, unverified).
const spec = (over: Partial<RackSpec> = {}): RackSpec => ({ unitWidthMm: 800, unitDepthMm: 350, unitHeightMm: 2000, rowPitchMm: 100, bottlesPerRow: 8, orientation: 'NECK_OUT', postsPerUnit: 2, rowsPerUnit: null, ...over });
const run = (id: string, wall: RackRun['wall'], startMm: number, units: number, s: RackSpec = spec()): RackRun => ({ id, wall, startMm, units, spec: s, bottle: 'BORDEAUX' });
const rects = (p: Prim[]) => p.filter((x): x is Extract<Prim, { kind: 'rect' }> => x.kind === 'rect');
const dims = (p: Prim[]) => p.filter((x): x is Extract<Prim, { kind: 'dim' }> => x.kind === 'dim').map((d) => d.text);
const texts = (p: Prim[]) => p.filter((x): x is Extract<Prim, { kind: 'text' }> => x.kind === 'text').map((d) => d.text);

describe('the plan', () => {
  const e = goldenCase02();
  const runs = [run('n', 'NORTH', 0, 2)];
  const a = analyseRacks(e, runs);
  const p = planView(e, runs, a);

  it('draws the inside at its outer-face position: 2750 x 1565 starting 50 mm in from each corner', () => {
    expect(rects(p).find((r) => r.tone === 'inside')).toMatchObject({ x: 50, y: 50, w: 2750, h: 1565 });
  });
  it('draws four wall bands on the outer rectangle', () => {
    const walls = rects(p).filter((r) => ['NORTH', 'SOUTH', 'EAST', 'WEST'].includes(r.label ?? ''));
    expect(walls.map((r) => r.label).sort()).toEqual(['EAST', 'NORTH', 'SOUTH', 'WEST']);
    expect(walls.find((r) => r.label === 'NORTH')).toMatchObject({ x: 0, y: 0, w: 2850, h: 50 });
    expect(walls.find((r) => r.label === 'SOUTH')).toMatchObject({ x: 0, y: 1615, w: 2850, h: 50 });
  });
  it('the door opening is 970 wide on the south wall, 940 from the west outer face', () => {
    expect(rects(p).find((r) => r.tone === 'door')).toMatchObject({ x: 940, w: 970, y: 1615, h: 50 });
  });
  it('carries the dimensions of the sample: 2850, 1665, and the 940 | 970 | 940 split', () => {
    const d = dims(p);
    expect(d).toEqual(expect.arrayContaining(['2850', '1665', '940', '970']));
    expect(d.filter((t) => t === '940')).toHaveLength(2);
    expect(texts(p)).toContain('2750 x 1565 inside');
  });
  it('the open leaf is a quarter circle of 970 mm about the hinge, outside an outward-swinging door', () => {
    const arc = p.find((x): x is Extract<Prim, { kind: 'poly' }> => x.kind === 'poly' && x.dash === true && x.tone === 'door')!;
    // hinge LEFT seen from outside on the south wall = the west end of the opening: inside s 890 -> outer x 940, on the outer face y 1665 (as A101)
    const cx = 940, cy = 1665;
    for (let i = 0; i < arc.pts.length; i += 2) expect(Math.hypot(arc.pts[i] - cx, arc.pts[i + 1] - cy)).toBeCloseTo(970, 3);
    expect(Math.min(...arc.pts.filter((_, i) => i % 2 === 1))).toBeGreaterThanOrEqual(1665 - 1e-6); // all of it below (outside) the south wall
    expect(hingeAt(e)).toBe(890);
  });
  it('an inward door sweeps inside, from the inner face', () => {
    const inward: Enclosure = { ...e, door: { ...e.door, swing: 'IN', hinge: 'LEFT' } };
    const arc = planView(inward, [], undefined).find((x): x is Extract<Prim, { kind: 'poly' }> => x.kind === 'poly' && x.dash === true)!;
    const ys = arc.pts.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1615 + 1e-6); // inside the south wall's inner face
    for (let i = 0; i < arc.pts.length; i += 2) expect(Math.hypot(arc.pts[i] - 940, arc.pts[i + 1] - 1615)).toBeCloseTo(970, 3); // hinge LEFT = west end
  });
  it('a rack run is drawn at its footprint with its unit count and bottle count', () => {
    const r = rects(p).find((x) => x.tone === 'rack')!;
    expect(r).toMatchObject({ x: 50, y: 50, w: 1600, h: 350 });
    expect(r.label).toBe('n: 2 units, 320 bottles');
  });
  it('a run with a blank size has NO rectangle, only a "not set" note', () => {
    const blank = [run('b', 'NORTH', 0, 3, blankRackSpec())];
    const q = planView(e, blank, analyseRacks(e, blank));
    expect(rects(q).some((x) => x.tone === 'rack' || x.tone === 'rackIssue')).toBe(false);
    expect(texts(q)).toContain('b: size not set');
  });
  it('a run with an error says it is not counted, instead of a bottle count', () => {
    const tooMany = [run('n', 'NORTH', 0, 4)];
    const an = analyseRacks(e, tooMany);
    const r = rects(planView(e, tooMany, an, { badRuns: badRunIds(an.issues) })).find((x) => x.tone === 'rackIssue')!;
    expect(r.label).toBe('n: 4 units, not counted (has an error)');
  });
  it('a run with an error is drawn in the issue tone', () => {
    const tooMany = [run('n', 'NORTH', 0, 4)];
    const an = analyseRacks(e, tooMany);
    expect(badRunIds(an.issues).has('n')).toBe(true);
    expect(rects(planView(e, tooMany, an, { badRuns: badRunIds(an.issues) })).find((x) => x.tone === 'rackIssue')).toBeTruthy();
  });
  it('the keep-clear zone appears only for an inward door with a minimum set', () => {
    const inward: Enclosure = { ...e, door: { ...e.door, swing: 'IN', hinge: 'LEFT' } };
    expect(rects(planView(inward, [], undefined, { walkwayMm: 900 })).find((x) => x.tone === 'zone')).toMatchObject({ x: 940, w: 970, h: 900 });
    expect(rects(planView(inward, [], undefined, {})).some((x) => x.tone === 'zone')).toBe(false);
    expect(rects(planView(e, [], undefined, { walkwayMm: 900 })).some((x) => x.tone === 'zone')).toBe(false);
  });
  it('wall build-ups change the inside drawn: a 100 mm west stud wall moves it', () => {
    const e2 = goldenCase02();
    e2.walls.WEST = { kind: 'STUD', buildUpMm: 100 };
    const q = planView(e2, [], undefined);
    expect(rects(q).find((r) => r.tone === 'inside')).toMatchObject({ x: 100, w: 2700 });
    expect(rects(q).find((r) => r.label === 'WEST')?.tone).toBe('stud');
  });
});

describe('the wall elevation', () => {
  const e = goldenCase02();
  const south = elevationView(e, 'SOUTH');

  it('shows the door wall as drawn on A102: 2850 wide, 2200 high, door 970 x 2120, header 500', () => {
    expect(dims(south)).toEqual(expect.arrayContaining(['2850', '2200', '500', '970', '2120', '940']));
    const door = rects(south).find((r) => r.label === 'DOOR')!;
    expect(door).toMatchObject({ x: 940, w: 970, h: 2120 });
    expect(door.y + door.h).toBe(500 + 2200); // stands on the ground line
  });
  it('puts the header parts on the door face, above the enclosure', () => {
    const vents = rects(south).filter((r) => r.label === 'VENT');
    expect(vents).toHaveLength(2);
    expect(vents[0]).toMatchObject({ x: 271, w: 400, h: 100, y: 500 - 100 - 100 });
    expect(rects(south).find((r) => r.label === 'CELLAR MOTOR / CONDITIONER')).toMatchObject({ x: 974, w: 902, h: 317, y: 500 - 317 });
    expect(dims(south)).toEqual(expect.arrayContaining(['400', '902']));
  });
  it('the other walls have no door and no header parts', () => {
    const north = elevationView(e, 'NORTH');
    expect(rects(north).some((r) => r.label === 'DOOR' || r.label === 'VENT')).toBe(false);
    expect(dims(north)).toEqual(expect.arrayContaining(['2850', '2200']));
    expect(dims(elevationView(e, 'EAST'))).toEqual(expect.arrayContaining(['1665']));
  });
  it('a wall seen from outside is mirrored on the north wall: a door at 200 mm from the start is at the viewer\'s right', () => {
    const e2 = goldenCase02();
    e2.door = { ...e2.door, wall: 'NORTH', offsetMm: 200 };
    const door = rects(elevationView(e2, 'NORTH')).find((r) => r.label === 'DOOR')!;
    expect(door.x).toBe(2850 - 200 - 970);
    const e3 = goldenCase02();
    e3.door = { ...e3.door, offsetMm: 200 };
    expect(rects(elevationView(e3, 'SOUTH')).find((r) => r.label === 'DOOR')!.x).toBe(200);
  });
  it('a door on the east wall puts the header parts on the south face instead', () => {
    const e2 = goldenCase02();
    e2.door = { ...e2.door, wall: 'EAST', widthMm: 900 };
    expect(rects(elevationView(e2, 'EAST')).some((r) => r.label === 'VENT')).toBe(false);
    expect(rects(elevationView(e2, 'SOUTH')).filter((r) => r.label === 'VENT')).toHaveLength(2);
  });
  it('the door diagonal points to the HANDLE side, opposite the hinge, as on the sample drawings (hinge left: point on the right)', () => {
    const apex = (side: 'SOUTH' | 'NORTH', hinge: 'LEFT' | 'RIGHT'): number => {
      const e2 = goldenCase02();
      e2.door = { ...e2.door, wall: side, hinge };
      const poly = elevationView(e2, side).find((x): x is Extract<Prim, { kind: 'poly' }> => x.kind === 'poly')!;
      return poly.pts[2]; // the middle point of the three
    };
    const door = rects(elevationView(goldenCase02(), 'SOUTH')).find((r) => r.label === 'DOOR')!;
    expect(apex('SOUTH', 'LEFT')).toBe(door.x + door.w);
    expect(apex('SOUTH', 'RIGHT')).toBe(door.x);
    // seen from outside, left is left on every wall, so the north wall (drawn mirrored) behaves the same
    const north = rects(elevationView({ ...goldenCase02(), door: { ...goldenCase02().door, wall: 'NORTH' } }, 'NORTH')).find((r) => r.label === 'DOOR')!;
    expect(apex('NORTH', 'LEFT')).toBe(north.x + north.w);
  });
  it('a glazed door is glass-toned, a solid one is door-toned', () => {
    expect(rects(south).find((r) => r.label === 'DOOR')?.tone).toBe('glass');
    const e2 = goldenCase02();
    e2.door.glazed = false;
    expect(rects(elevationView(e2, 'SOUTH')).find((r) => r.label === 'DOOR')?.tone).toBe('door');
  });
});

describe('bounds and fitting', () => {
  it('bounds include the dimension lines, so nothing is clipped', () => {
    const b = boundsOf(planView(goldenCase02(), [], undefined));
    expect(b.x0).toBeLessThanOrEqual(-350 + 1e-6);
    expect(b.y0).toBeLessThanOrEqual(-350 + 1e-6);
    expect(b.x1).toBeGreaterThanOrEqual(2850);
    expect(b.y1).toBeGreaterThan(1665 + 970); // the outward swing and its dimension row
  });
  it('fitting keeps the drawing inside the view with its margin', () => {
    const b = { x0: -350, y0: -350, x1: 3000, y1: 2900 };
    const f = fitView(b, 800, 600, 40);
    expect(f.ox + b.x0 * f.scale).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(f.oy + b.y0 * f.scale).toBeGreaterThanOrEqual(40 - 1e-6);
    expect(f.ox + b.x1 * f.scale).toBeLessThanOrEqual(800 - 40 + 1e-6);
    expect(f.oy + b.y1 * f.scale).toBeLessThanOrEqual(600 - 40 + 1e-6);
  });
  it('empty drawings give a unit box rather than infinities', () => {
    expect(boundsOf([])).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});
