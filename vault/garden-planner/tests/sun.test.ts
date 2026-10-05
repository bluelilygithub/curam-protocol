import { describe, expect, it } from 'vitest';
import { apply, setItem } from '../src/domain/commands';
import { boundaryFromPoints, newGardenProject, rectanglePoints } from '../src/domain/projectFactory';
import type { Bed, GardenProject, Location, Structure, Vec2 } from '../src/domain/types';
import { canopyOpacity, canopyShape } from '../src/sun/canopy';
import { MIN_SUN_ALTITUDE, obstaclesOf, shadowsFor, sunFractionAt, type Obstacle } from '../src/sun/shadows';
import { averageHoursIn, computeSunHours, hoursAt, placeOf, bedSun } from '../src/sun/sunHours';
import { compassPoint, daylight, formatHour, solarPosition, sunDirectionOnPlan } from '../src/sun/solar';
import type { GrowthStage } from '../src/plants/growth';
import { plantById } from '../src/plants/plants';
import { placeFor } from '../src/sun/timezone';
import { DEFAULT_SUN_THRESHOLDS, sunLevelForHours } from '../src/plants/suitability';

const BRISBANE: Location = { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' };
const DARWIN: Location = { label: 'Darwin NT', lat: -12.46, lng: 130.84, state: 'NT' };
const HOBART: Location = { label: 'Hobart TAS', lat: -42.88, lng: 147.33, state: 'TAS' };
const place = (l: Location, month = 6) => placeFor(l, month);
const JUNE = 6, DEC = 12;

describe('solar position (southern hemisphere)', () => {
  it('Brisbane at midwinter: noon sun is in the NORTH at about 39 degrees', () => {
    const d = daylight(place(BRISBANE), JUNE)!;
    expect(d.noonAltitude).toBeGreaterThan(38);
    expect(d.noonAltitude).toBeLessThan(40.5);
    const sun = solarPosition(place(BRISBANE), JUNE, 15, d.solarNoon);
    const fromNorth = Math.min(sun.azimuth, 360 - sun.azimuth);
    expect(fromNorth).toBeLessThan(3); // due north
    expect(compassPoint(sun.azimuth)).toBe('N');
  });

  it('Brisbane at midsummer: noon sun is almost overhead, still just north of it', () => {
    const d = daylight(place(BRISBANE), DEC)!;
    expect(d.noonAltitude).toBeGreaterThan(84.5);
    expect(d.noonAltitude).toBeLessThan(88);
  });

  it('solar noon is near 12 on the clock (Brisbane is east of its time-zone meridian, so a little before)', () => {
    const d = daylight(place(BRISBANE), JUNE)!;
    expect(d.solarNoon).toBeGreaterThan(11.5);
    expect(d.solarNoon).toBeLessThan(12.1);
  });

  it('day length: about 10.5 h in June, 13.4 h in December', () => {
    const j = daylight(place(BRISBANE), JUNE)!;
    const d = daylight(place(BRISBANE), DEC)!;
    expect(j.sunset - j.sunrise).toBeGreaterThan(10.1);
    expect(j.sunset - j.sunrise).toBeLessThan(10.9);
    expect(d.sunset - d.sunrise).toBeGreaterThan(13.1);
    expect(d.sunset - d.sunrise).toBeLessThan(13.8);
  });

  it('rises in the east side and sets in the west side (winter: north-east to north-west)', () => {
    const am = solarPosition(place(BRISBANE), JUNE, 15, 8);
    const pm = solarPosition(place(BRISBANE), JUNE, 15, 15.5);
    expect(am.azimuth).toBeGreaterThan(30);
    expect(am.azimuth).toBeLessThan(110);
    expect(pm.azimuth).toBeGreaterThan(250);
    expect(pm.azimuth).toBeLessThan(330);
  });

  it('nothing assumes a side: in Darwin the December noon sun is in the south, in June in the north', () => {
    const dec = daylight(place(DARWIN), DEC)!;
    const jun = daylight(place(DARWIN), JUNE)!;
    expect(Math.abs(solarPosition(place(DARWIN), DEC, 15, dec.solarNoon).azimuth - 180)).toBeLessThan(5);
    expect(Math.min(solarPosition(place(DARWIN), JUNE, 15, jun.solarNoon).azimuth, 360 - solarPosition(place(DARWIN), JUNE, 15, jun.solarNoon).azimuth)).toBeLessThan(5);
  });

  it('Hobart has a much lower winter sun than Brisbane', () => {
    expect(daylight(place(HOBART), JUNE)!.noonAltitude).toBeLessThan(25);
    expect(daylight(place(BRISBANE), JUNE)!.noonAltitude).toBeGreaterThan(38);
  });

  it('the plan direction follows the north arrow', () => {
    // north straight up the plan: a due-north sun is "up" (+y); north to the right (90): it is to the right (+x); north down (180): down
    const up = sunDirectionOnPlan(0, 0), right = sunDirectionOnPlan(0, 90), down = sunDirectionOnPlan(0, 180);
    expect(up.y).toBeCloseTo(1); expect(up.x).toBeCloseTo(0);
    expect(right.x).toBeCloseTo(1); expect(right.y).toBeCloseTo(0);
    expect(down.y).toBeCloseTo(-1);
    // a sun in the east, north up: to the right
    expect(sunDirectionOnPlan(90, 0).x).toBeCloseTo(1);
  });

  it('formats times', () => {
    expect(formatHour(12)).toBe('12:00 pm');
    expect(formatHour(0)).toBe('12:00 am');
    expect(formatHour(7.25)).toBe('7:15 am');
    expect(formatHour(17.5)).toBe('5:30 pm');
  });
});

// ---------------------------------------------------------------- shadows
/** A slim 2 m pole standing at the origin, as the canopy obstacle. */
const pole = (h = 2): Obstacle[] => [{ kind: 'canopy', centre: { x: 0, y: 0 }, radius: 0.05, zb: 0, zt: h, opacity: 1, label: 'pole' }];
const tip = (loc: Location, month: number, northDeg: number, hour?: number): Vec2 => {
  const d = daylight(place(loc), month)!;
  const sun = solarPosition(place(loc), month, 15, hour ?? d.solarNoon);
  const s = shadowsFor(pole(), sunDirectionOnPlan(sun.azimuth, northDeg), sun.altitude)[0];
  if (s.kind !== 'stadium') throw new Error('expected a stadium');
  return { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
};

describe('noon shadows point the right way', () => {
  it('June, Brisbane: the shadow of a 2 m pole points SOUTH (down the plan when north is up) and is about 2.5 m long', () => {
    const t = tip(BRISBANE, JUNE, 0);
    expect(t.y).toBeLessThan(0);
    expect(Math.abs(t.x)).toBeLessThan(0.2);
    expect(Math.hypot(t.x, t.y)).toBeGreaterThan(2.2);
    expect(Math.hypot(t.x, t.y)).toBeLessThan(2.8);
  });

  it('December, Brisbane: the shadow is tiny (the sun is nearly overhead), still on the south side', () => {
    const t = tip(BRISBANE, DEC, 0);
    expect(Math.hypot(t.x, t.y)).toBeLessThan(0.4);
    expect(t.y).toBeLessThanOrEqual(0);
  });

  it('June is much longer than December', () => {
    expect(Math.hypot(...Object.values(tip(BRISBANE, JUNE, 0)) as [number, number])).toBeGreaterThan(5 * Math.hypot(...Object.values(tip(BRISBANE, DEC, 0)) as [number, number]));
  });

  it('turning the north arrow turns the shadow with it: north right, the shadow points left; north down, up', () => {
    const right = tip(BRISBANE, JUNE, 90);
    expect(right.x).toBeLessThan(-2);
    expect(Math.abs(right.y)).toBeLessThan(0.3);
    const down = tip(BRISBANE, JUNE, 180);
    expect(down.y).toBeGreaterThan(2);
  });

  it('morning shadows fall to the west side, afternoon shadows to the east side (north up)', () => {
    expect(tip(BRISBANE, JUNE, 0, 8.5).x).toBeLessThan(0);
    expect(tip(BRISBANE, JUNE, 0, 15.5).x).toBeGreaterThan(0);
  });

  it('there is no shadow while the sun is under the minimum altitude', () => {
    expect(shadowsFor(pole(), { x: 0, y: 1 }, MIN_SUN_ALTITUDE - 0.1)).toEqual([]);
  });
});

const baseProject = (extra: Partial<GardenProject> = {}): GardenProject => ({
  ...newGardenProject('g', BRISBANE, 'g1'), boundary: boundaryFromPoints(rectanglePoints(24, 34)), ...extra,
});
const bedAt = (id: string, x0: number, y0: number, x1: number, y1: number): Bed => ({
  id, name: id, shape: { points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], smooth: false }, edging: 'none', mulch: 'bark', raised: false,
});
const house = (): GardenProject['house'] => ({ id: 'h', vertices: rectanglePoints(12, 6, { x: 6, y: 14 }).map((position, i) => ({ id: `v${i}`, position })), height: 3.2, fixtures: [] });
const withBeds = (p: GardenProject, ...beds: Bed[]): GardenProject => beds.reduce((acc, b) => apply(setItem('beds', b.id, null, b), acc), p);

describe('fences, structures and the house cast shadows', () => {
  const noon = (month: number) => {
    const d = daylight(place(BRISBANE), month)!;
    const sun = solarPosition(place(BRISBANE), month, 15, d.solarNoon);
    return { toSun: sunDirectionOnPlan(sun.azimuth, 0), alt: sun.altitude };
  };

  it('a 1.8 m fence along the north side of a bed shades it at June noon, not at December noon', () => {
    const fence = baseProject({ boundary: { vertices: [{ id: 'a', position: { x: 0, y: 10 } }, { id: 'b', position: { x: 20, y: 10 } }, { id: 'c', position: { x: 20, y: 30 } }, { id: 'd', position: { x: 0, y: 30 } }], segments: [{ fence: 'colorbond', height: 1.8 }, { fence: 'open', height: 0 }, { fence: 'open', height: 0 }, { fence: 'open', height: 0 }] } });
    const obs = obstaclesOf(fence, 'mature', JUNE);
    const j = noon(JUNE), d = noon(DEC);
    // the fence is the south edge here, so the sun is on its far side: put the test point on the SOUTH of an inner fence instead
    const inner = baseProject({ boundary: { vertices: [{ id: 'a', position: { x: 0, y: 20 } }, { id: 'b', position: { x: 20, y: 20 } }, { id: 'c', position: { x: 20, y: 30 } }, { id: 'd', position: { x: 0, y: 30 } }], segments: [{ fence: 'open', height: 0 }, { fence: 'open', height: 0 }, { fence: 'colorbond', height: 1.8 }, { fence: 'open', height: 0 }] } });
    void obs;
    const o2 = obstaclesOf(inner, 'mature', JUNE);
    // the colorbond fence is the NORTH edge (y = 30): its June noon shadow reaches 1.8 / tan(39) = 2.2 m south of it
    const shadowJune = shadowsFor(o2, j.toSun, j.alt);
    expect(sunFractionAt({ x: 10, y: 29 }, shadowJune)).toBe(0); // 1 m south of the fence: shaded
    expect(sunFractionAt({ x: 10, y: 26 }, shadowJune)).toBe(1); // 4 m south: in the sun
    const shadowDec = shadowsFor(obstaclesOf(inner, 'mature', DEC), d.toSun, d.alt);
    expect(sunFractionAt({ x: 10, y: 29 }, shadowDec)).toBe(1); // summer: the sun is nearly overhead
  });

  it('a hedge lets a little sun through; an open fence casts none', () => {
    const mk = (fence: 'hedge' | 'open', h: number): Obstacle[] => obstaclesOf(baseProject({ boundary: { vertices: [{ id: 'a', position: { x: 0, y: 20 } }, { id: 'b', position: { x: 20, y: 20 } }, { id: 'c', position: { x: 20, y: 30 } }, { id: 'd', position: { x: 0, y: 30 } }], segments: [{ fence: 'open', height: 0 }, { fence: 'open', height: 0 }, { fence, height: h }, { fence: 'open', height: 0 }] } }), 'mature', JUNE);
    const j = noon(JUNE);
    expect(sunFractionAt({ x: 10, y: 29.3 }, shadowsFor(mk('hedge', 1.5), j.toSun, j.alt))).toBeCloseTo(0.15, 2);
    expect(sunFractionAt({ x: 10, y: 29.3 }, shadowsFor(mk('open', 0), j.toSun, j.alt))).toBe(1);
  });

  it('a shed blocks all the sun behind it; a pergola lets about half through', () => {
    const shed: Structure = { id: 's', kind: 'shed', name: 's', position: { x: 10, y: 10 }, width: 2.4, length: 1.8, height: 2.2, rotation: 0 };
    const perg: Structure = { ...shed, id: 'p', kind: 'pergola', height: 2.7, width: 3.6, length: 3.6 };
    const j = noon(JUNE);
    const one = (s: Structure) => shadowsFor(obstaclesOf(baseProject({ structures: [s] }), 'mature', JUNE), j.toSun, j.alt);
    // a point 1.5 m south of the shed's south edge is in its noon shadow (2.2 / tan 39 = 2.7 m long)
    expect(sunFractionAt({ x: 10, y: 10 - 0.9 - 1.5 }, one(shed))).toBe(0);
    // under the pergola's roof (its shadow lies a little south of its footprint)
    const f = sunFractionAt({ x: 10, y: 10 - 3.3 }, one(perg));
    expect(f).toBeCloseTo(0.55, 2);
  });

  it('the house shadow sits south of the house at June noon and is gone at December noon', () => {
    const j = noon(JUNE), d = noon(DEC);
    const p = baseProject({ house: house() });
    expect(sunFractionAt({ x: 12, y: 11 }, shadowsFor(obstaclesOf(p, 'mature', JUNE), j.toSun, j.alt))).toBe(0); // 3 m south of the south wall (3.2 / tan 39 = 3.9)
    expect(sunFractionAt({ x: 12, y: 11 }, shadowsFor(obstaclesOf(p, 'mature', DEC), d.toSun, d.alt))).toBe(1);
    expect(sunFractionAt({ x: 12, y: 24 }, shadowsFor(obstaclesOf(p, 'mature', JUNE), j.toSun, j.alt))).toBe(1); // north of the house: sunny
  });
});

describe('trees at the current growth stage and month', () => {
  const lilly = plantById('syzygium-smithii')!;
  const maple = plantById('acer-palmatum')!;
  const treeProject = (plantId: string): GardenProject => apply(setItem('plants', 't', null, { id: 't', plantId, position: { x: 12, y: 17 } }), baseProject());
  /** A point south of the tree, where its winter shadow lands (the sun slants under the canopy, so directly under the trunk is not the shaded spot). */
  const SHADED_SPOT = { x: 12, y: 13 };
  const shadowLength = (stage: GrowthStage) => {
    const d = daylight(place(BRISBANE), JUNE)!;
    const sun = solarPosition(place(BRISBANE), JUNE, 15, d.solarNoon);
    const s = shadowsFor(obstaclesOf(treeProject('syzygium-smithii'), stage, JUNE), sunDirectionOnPlan(sun.azimuth, 0), sun.altitude).find((x) => x.kind === 'stadium');
    if (!s || s.kind !== 'stadium') return 0; // no canopy worth mapping at this stage
    return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  };

  it('a mature tree throws a far bigger shadow than a newly planted one', () => {
    expect(canopyShape(lilly, 'planted')).toBeNull(); // a seedling shades nothing worth mapping
    expect(shadowLength('planted')).toBe(0);
    expect(shadowLength('mature')).toBeGreaterThan(2);
    expect(shadowLength('mature')).toBeGreaterThan(shadowLength('yr5'));
  });

  it('the canopy follows the plant record: a mature lilly pilly spans its record width, on a trunk', () => {
    const c = canopyShape(lilly, 'mature')!;
    expect(c.radius).toBeCloseTo(((lilly.spread[0] + lilly.spread[1]) / 2) / 2, 2);
    expect(c.zt).toBeCloseTo((lilly.height[0] + lilly.height[1]) / 2, 2);
    expect(c.zb).toBeGreaterThan(0.5);
  });

  it('a deciduous tree lets in more winter sun than summer sun; an evergreen does not change', () => {
    expect(canopyOpacity(maple, 7)).toBeLessThan(canopyOpacity(maple, 1) - 0.3);
    expect(canopyOpacity(lilly, 7)).toBe(canopyOpacity(lilly, 1));
  });

  it('under a mature evergreen the share of the day in sun is lower than in the open, and a mature tree shades more than a young one', () => {
    const open = baseProject();
    const mature = treeProject('syzygium-smithii');
    const at = SHADED_SPOT;
    const hOpen = hoursAt(computeSunHours(open, { stage: 'mature', month: JUNE })!, at)!;
    const hMature = hoursAt(computeSunHours(mature, { stage: 'mature', month: JUNE })!, at)!;
    const hYoung = hoursAt(computeSunHours(mature, { stage: 'yr1', month: JUNE })!, at)!;
    expect(hMature).toBeLessThan(hOpen - 1.5);
    expect(hYoung).toBeGreaterThan(hMature + 1); // a one-year-old tree casts no mapped shadow yet
    expect(hYoung).toBeCloseTo(hOpen, 1);
  });

  it('a bare deciduous tree shades the winter garden less than a leafy evergreen does', () => {
    const at = SHADED_SPOT;
    const dec = hoursAt(computeSunHours(treeProject('acer-palmatum'), { stage: 'mature', month: JUNE })!, at)!;
    const evg = hoursAt(computeSunHours(treeProject('syzygium-smithii'), { stage: 'mature', month: JUNE })!, at)!;
    expect(dec).toBeGreaterThan(evg + 0.8);
  });
});

describe('sun-hours map: north-facing beds get more winter sun than south-facing ones (Brisbane)', () => {
  // The house runs east-west with its long wall facing north and south. The sun is in the north, so a bed on the north side of the house is
  // in the sun all day; a bed on the south side sits in the house's shadow.
  const proj = withBeds(baseProject({ house: house() }), bedAt('north', 8, 22, 12, 26), bedAt('south', 8, 10, 12, 13));
  const avg = (month: number, id: 'north' | 'south'): number => {
    const g = computeSunHours(proj, { stage: 'mature', month })!;
    return averageHoursIn(g, proj.beds.find((b) => b.id === id)!.shape.points)!;
  };

  it('in June the north bed gets a full winter day of sun and the south bed gets far less', () => {
    const n = avg(JUNE, 'north'), s = avg(JUNE, 'south');
    expect(n).toBeGreaterThan(8.3); // most of a Brisbane winter day (the 1.8 m boundary fences block the lowest early and late sun)
    expect(s).toBeLessThan(5);
    expect(n - s).toBeGreaterThan(3.5);
  });

  it('the difference shrinks in summer, when the sun is nearly overhead', () => {
    const winterGap = avg(JUNE, 'north') - avg(JUNE, 'south');
    const summerGap = avg(DEC, 'north') - avg(DEC, 'south');
    expect(summerGap).toBeLessThan(winterGap / 2);
    expect(avg(DEC, 'south')).toBeGreaterThan(avg(JUNE, 'south') + 3);
  });

  it('open ground gets the whole day (a little under daylight, since the sun must be 3 degrees up)', () => {
    const noFences = baseProject({ boundary: { vertices: boundaryFromPoints(rectanglePoints(24, 34)).vertices, segments: Array.from({ length: 4 }, () => ({ fence: 'open' as const, height: 0 })) } });
    const g = computeSunHours(noFences, { stage: 'mature', month: JUNE })!;
    const d = daylight(place(BRISBANE), JUNE)!;
    expect(g.openGroundHours).toBeGreaterThan(d.sunset - d.sunrise - 0.9);
    expect(g.openGroundHours).toBeLessThan(d.sunset - d.sunrise);
    expect(hoursAt(g, { x: 12, y: 17 })!).toBeCloseTo(g.openGroundHours, 1);
    // and with the fences on, the same spot gets a bit less: low sun is blocked by a 1.8 m fence
    expect(hoursAt(computeSunHours(baseProject(), { stage: 'mature', month: JUNE })!, { x: 12, y: 17 })!).toBeLessThan(g.openGroundHours - 0.3);
  });

  it('classifies full sun / part shade / shade at the default 6 h and 3 h, and at changed thresholds', () => {
    const n = bedSun(proj, 'north', { stage: 'mature', month: JUNE }, DEFAULT_SUN_THRESHOLDS)!;
    const s = bedSun(proj, 'south', { stage: 'mature', month: JUNE }, DEFAULT_SUN_THRESHOLDS)!;
    expect(n.level).toBe('full_sun');
    expect(s.level).not.toBe('full_sun');
    // stricter "full sun" (11 h) moves the north bed down a level
    expect(bedSun(proj, 'north', { stage: 'mature', month: JUNE }, { fullSunHours: 11, partShadeHours: 3 })!.level).toBe('part_shade');
    // a looser one (2 h part shade) promotes a shady bed
    expect(sunLevelForHours(s.hours, { fullSunHours: 6, partShadeHours: s.hours - 0.1 })).toBe('part_shade');
    expect(sunLevelForHours(s.hours, { fullSunHours: 6, partShadeHours: s.hours + 0.1 })).toBe('shade');
  });

  it('the north arrow decides which side is sunny: with north pointing DOWN the plan, the bed below the house is the sunny one', () => {
    const flipped = { ...proj, northDeg: 180 };
    const g = computeSunHours(flipped, { stage: 'mature', month: JUNE })!;
    const n = averageHoursIn(g, proj.beds[0].shape.points)!; // the bed that was north when north was up (now south of the house on screen)
    const s = averageHoursIn(g, proj.beds[1].shape.points)!;
    expect(s).toBeGreaterThan(n + 4);
  });

  it('the house floor is not mapped (it is not garden)', () => {
    const g = computeSunHours(proj, { stage: 'mature', month: JUNE })!;
    expect(hoursAt(g, { x: 12, y: 17 })).toBeNull(); // inside the house footprint
    expect(hoursAt(g, { x: 12, y: 24 })).not.toBeNull();
  });

  it('cells outside the plot boundary are not mapped; a project with nothing drawn has no map', () => {
    const g = computeSunHours(proj, { stage: 'mature', month: JUNE })!;
    expect(hoursAt(g, { x: -5, y: -5 })).toBeNull();
    expect(computeSunHours(newGardenProject('empty'), { stage: 'mature', month: JUNE })).toBeNull();
  });

  it('is quick enough to recompute as sliders move (a full garden with 80 plants)', () => {
    let p = proj;
    for (let i = 0; i < 80; i++) p = apply(setItem('plants', `p${i}`, null, { id: `p${i}`, plantId: i % 2 ? 'syzygium-smithii' : 'callistemon-little-john', position: { x: 2 + (i % 10) * 2, y: 2 + Math.floor(i / 10) * 3 } }), p);
    const t0 = performance.now();
    computeSunHours(p, { stage: 'mature', month: JUNE });
    expect(performance.now() - t0).toBeLessThan(2500);
  });

  it('uses the project location: the same garden in Hobart gets a shorter, lower winter sun than in Brisbane', () => {
    const hob = { ...proj, location: HOBART };
    const gb = computeSunHours(proj, { stage: 'mature', month: JUNE })!;
    const gh = computeSunHours(hob, { stage: 'mature', month: JUNE })!;
    expect(gh.openGroundHours).toBeLessThan(gb.openGroundHours - 1);
    expect(placeOf(hob, JUNE).tz).toBe(10);
  });
});
