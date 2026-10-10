import { describe, expect, it } from 'vitest';
import { testCaseProject } from '../src/app/model';
import { conditionerCapacity, coolingFit, coolingLoad, DEFAULT_COOLING, type CoolingAssumptions, type CoolingResult } from '../src/enclosure/cooling';
import type { Enclosure, HeaderComponent } from '../src/enclosure';
import { DEFAULT_CONFIG } from '../src/lite/config';

const ok = (r: CoolingResult): Extract<CoolingResult, { status: 'OK' }> => { if (r.status !== 'OK') throw new Error(r.reason); return r; };
const enc = (): Enclosure => testCaseProject().enclosure; // 2850 x 1665 x 2200 outer, 50 mm walls and ceiling, floor 0, door 970 x 2120 on the south wall
const line = (r: Extract<CoolingResult, { status: 'OK' }>, id: string) => r.lines.find((l) => l.id === id)!;

describe('the defaults are the server defaults', () => {
  it('match', () => { expect(DEFAULT_COOLING).toEqual(DEFAULT_CONFIG.cooling); });
});

describe('the load, worked by hand for the test-case enclosure', () => {
  // dT = 35 - 14 = 21 K. k = 0.025, 50 mm panels: U = 0.5. Wall areas to the outer faces (height 2.2 m):
  //   north, south: 2.85 x 2.2 = 6.27 m2; east, west: 1.665 x 2.2 = 3.663 m2; the door takes 0.97 x 2.12 = 2.0564 m2 from the south wall.
  const r = ok(coolingLoad(enc(), DEFAULT_COOLING));
  it('uses the temperature difference', () => { expect(r.deltaC).toBe(21); });
  it('each wall is U x area x dT', () => {
    expect(line(r, 'wall-north').watts).toBeCloseTo(0.5 * 6.27 * 21, 9);
    expect(line(r, 'wall-east').watts).toBeCloseTo(0.5 * 3.663 * 21, 9);
    expect(line(r, 'wall-west').watts).toBeCloseTo(0.5 * 3.663 * 21, 9);
    expect(line(r, 'wall-south').watts).toBeCloseTo(0.5 * (6.27 - 2.0564) * 21, 9);
  });
  it('the sample door is glazed, so it uses the glass U-value and takes its own area out of its wall', () => {
    expect(enc().door.glazed).toBe(true);
    expect(line(r, 'door').watts).toBeCloseTo(1.4 * 2.0564 * 21, 9);
    expect(line(r, 'wall-south').label).toBe('South wall (less the door)');
  });
  it('an opaque door is insulated like its wall', () => {
    const e = enc(); e.door = { ...e.door, glazed: false };
    expect(line(ok(coolingLoad(e, DEFAULT_COOLING)), 'door').watts).toBeCloseTo(0.5 * 2.0564 * 21, 9);
  });
  it('ceiling and floor are the outer footprint; no floor build-up means the uninsulated floor U-value, and says so', () => {
    const roof = 2.85 * 1.665;
    expect(line(r, 'ceiling').watts).toBeCloseTo(0.5 * roof * 21, 9);
    expect(line(r, 'floor').watts).toBeCloseTo(1 * roof * 21, 9);
    expect(line(r, 'floor').working).toContain('uninsulated floor U-value');
    expect(r.notes.join(' ')).toContain('No floor build-up is entered');
  });
  it('envelope + internal gains = subtotal; margin is a percentage of it; total adds up', () => {
    const env = r.lines.reduce((n, l) => n + l.watts, 0);
    expect(r.envelopeW).toBeCloseTo(env, 9); expect(r.gainsW).toBe(100);
    expect(r.subtotalW).toBeCloseTo(env + 100, 9); expect(r.marginW).toBeCloseTo((env + 100) * 0.2, 9); expect(r.totalW).toBeCloseTo((env + 100) * 1.2, 9);
  });
  it('is a believable size for a small cellar (a few hundred watts, not thousands)', () => {
    expect(r.totalW).toBeGreaterThan(300); expect(r.totalW).toBeLessThan(1500);
  });
  it('every line has a label, formula and working, and a finite number of watts', () => {
    for (const l of r.lines) { expect(l.label.length).toBeGreaterThan(2); expect(l.formula).toBe('U × area × temperature difference'); expect(l.working).toMatch(/K/); expect(Number.isFinite(l.watts)).toBe(true); expect(l.watts).toBeGreaterThanOrEqual(0); }
  });
});

describe('the materials', () => {
  it('a glass wall uses the glass U-value', () => {
    const e = enc(); e.walls.NORTH = { ...e.walls.NORTH, kind: 'GLASS' };
    expect(line(ok(coolingLoad(e, DEFAULT_COOLING)), 'wall-north').watts).toBeCloseTo(1.4 * 6.27 * 21, 9);
  });
  it('a glazed door uses the glass U-value, an opaque one its wall\'s', () => {
    const e = enc(); e.door = { ...e.door, glazed: true };
    expect(line(ok(coolingLoad(e, DEFAULT_COOLING)), 'door').watts).toBeCloseTo(1.4 * 2.0564 * 21, 9);
  });
  it('thicker insulation lets in less heat; a different conductivity scales every insulated surface', () => {
    const thin = ok(coolingLoad(enc(), DEFAULT_COOLING)).totalW;
    const e = enc(); e.walls.NORTH = { ...e.walls.NORTH, buildUpMm: 100 };
    expect(ok(coolingLoad(e, DEFAULT_COOLING)).totalW).toBeLessThan(thin);
    expect(line(ok(coolingLoad(enc(), { ...DEFAULT_COOLING, panelConductivity: 0.05 })), 'wall-north').watts).toBeCloseTo(2 * line(ok(coolingLoad(enc(), DEFAULT_COOLING)), 'wall-north').watts, 9);
  });
  it('an insulated floor uses its own build-up', () => {
    const e = enc(); e.floorBuildUpMm = 100;
    const r = ok(coolingLoad(e, DEFAULT_COOLING));
    expect(line(r, 'floor').watts).toBeCloseTo(0.25 * 2.85 * 1.665 * 21, 9); expect(r.notes.join(' ')).not.toContain('No floor build-up');
  });
});

describe('the temperatures, gains and margin', () => {
  it('a hotter day or a colder cellar needs more; the load scales with the temperature difference', () => {
    const base = ok(coolingLoad(enc(), DEFAULT_COOLING));
    const hot = ok(coolingLoad(enc(), { ...DEFAULT_COOLING, ambientC: 42 }));
    expect(hot.envelopeW).toBeCloseTo(base.envelopeW * (28 / 21), 6);
    expect(ok(coolingLoad(enc(), { ...DEFAULT_COOLING, targetC: 10 })).totalW).toBeGreaterThan(base.totalW);
  });
  it('gains and margin change only their own part', () => {
    const base = ok(coolingLoad(enc(), DEFAULT_COOLING));
    const more = ok(coolingLoad(enc(), { ...DEFAULT_COOLING, internalGainsW: 300, marginPct: 0 }));
    expect(more.envelopeW).toBeCloseTo(base.envelopeW, 9); expect(more.marginW).toBe(0); expect(more.totalW).toBeCloseTo(base.envelopeW + 300, 9);
  });
  it('a target at or above the outside temperature needs no cooling and says so', () => {
    for (const a of [{ ambientC: 14 }, { ambientC: 10 }]) { const r = coolingLoad(enc(), { ...DEFAULT_COOLING, ...a }); expect(r.status).toBe('NOT_SET'); expect((r as { reason: string }).reason).toMatch(/must be below the outside design temperature/); }
  });
});

describe('a bigger cellar needs more cooling (the estimate follows the size)', () => {
  it('growing the width, depth or height increases the load', () => {
    const base = ok(coolingLoad(enc(), DEFAULT_COOLING)).totalW;
    for (const patch of [{ outerWidthMm: 4000 }, { outerDepthMm: 3000 }, { heightMm: 2800 }]) {
      const e = { ...enc(), ...patch };
      expect(ok(coolingLoad(e, DEFAULT_COOLING)).totalW, JSON.stringify(patch)).toBeGreaterThan(base);
    }
  });
  it('is monotonic in width over a sweep', () => {
    let prev = 0;
    for (let w = 1500; w <= 6000; w += 250) { const t = ok(coolingLoad({ ...enc(), outerWidthMm: w }, DEFAULT_COOLING)).totalW; expect(t).toBeGreaterThan(prev); prev = t; }
  });
});

describe('what is not known is never guessed', () => {
  it('a wall, the ceiling or the door wall with no build-up gives "not set" naming it', () => {
    const w = enc(); w.walls.EAST = { ...w.walls.EAST, buildUpMm: 0 };
    expect((coolingLoad(w, DEFAULT_COOLING) as { reason: string }).reason).toBe('The east wall has no build-up (thickness) entered, so its insulation is not known.');
    const c = enc(); c.ceilingBuildUpMm = 0;
    expect((coolingLoad(c, DEFAULT_COOLING) as { reason: string }).reason).toMatch(/ceiling has no build-up/);
    const d = enc(); d.walls.SOUTH = { ...d.walls.SOUTH, buildUpMm: 0 };
    expect(coolingLoad(d, DEFAULT_COOLING).status).toBe('NOT_SET');
  });
  it('a glass wall needs no build-up', () => {
    const g = enc(); g.walls.EAST = { ...g.walls.EAST, kind: 'GLASS', buildUpMm: 0 };
    expect(coolingLoad(g, DEFAULT_COOLING).status).toBe('OK');
  });
});

describe('does the header cover the load?', () => {
  const load = ok(coolingLoad(enc(), DEFAULT_COOLING));
  const cond = (id: string, capacityW?: number | null): HeaderComponent => ({ id, kind: 'CONDITIONER', xMm: 0, yMm: 0, widthMm: 900, heightMm: 300, ...(capacityW === undefined ? {} : { capacityW }) });
  const vent: HeaderComponent = { id: 'v', kind: 'VENT', xMm: 0, yMm: 0, widthMm: 400, heightMm: 100 };
  it('no conditioner', () => { expect(coolingFit([vent], load)).toEqual({ status: 'NO_CONDITIONER' }); });
  it('a conditioner with no rating is unrated, never zero', () => {
    expect(coolingFit([cond('c1')], load)).toEqual({ status: 'UNRATED', unrated: 1 });
    expect(coolingFit([cond('c1', null), cond('c2', 800)], load)).toEqual({ status: 'UNRATED', unrated: 1 });
    expect(coolingFit([cond('c1', 0)], load)).toEqual({ status: 'UNRATED', unrated: 1 });
  });
  it('enough capacity is covered, with the spare', () => {
    const f = coolingFit([cond('c1', Math.ceil(load.totalW) + 500)], load);
    expect(f.status).toBe('COVERED');
    if (f.status === 'COVERED') { expect(f.spareW).toBeCloseTo(f.capacityW - load.totalW, 9); expect(f.sparePct).toBeGreaterThan(0); }
  });
  it('too little is short, by how much', () => {
    const f = coolingFit([cond('c1', 100)], load);
    expect(f.status).toBe('SHORT'); if (f.status === 'SHORT') expect(f.shortW).toBeCloseTo(load.totalW - 100, 9);
  });
  it('capacities add up across conditioners, and vents are ignored', () => {
    expect(conditionerCapacity([cond('a', 400), cond('b', 300), vent])).toEqual({ totalW: 700, count: 2, unrated: 0 });
    expect(coolingFit([cond('a', Math.ceil(load.totalW / 2)), cond('b', Math.ceil(load.totalW / 2))], load).status).toBe('COVERED');
  });
});

describe('it does not change what it is given', () => {
  it('leaves the enclosure alone', () => {
    const e = enc(); const before = JSON.stringify(e); const a: CoolingAssumptions = { ...DEFAULT_COOLING }; const ab = JSON.stringify(a);
    coolingLoad(e, a); expect(JSON.stringify(e)).toBe(before); expect(JSON.stringify(a)).toBe(ab);
  });
});
