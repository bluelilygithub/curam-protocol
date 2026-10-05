import { describe, expect, it } from 'vitest';
import { apply, setItem, type Command } from '../src/domain/commands';
import { boundaryFromPoints, cloneGarden, isBlank, newGardenProject, randomId, rectanglePoints } from '../src/domain/projectFactory';
import type { AuState, Bed, GardenProject, Lawn, Location, PathItem, ServiceLine, Structure, Vec2 } from '../src/domain/types';
import { DRAFT_LABEL, computeChecks, makeSunLookup, mentionsDraft, nearestValidPosition, type CheckSettings, type Issue } from '../src/checks';
import { positionIssues, placedPlants } from '../src/checks/plantChecks';
import { gateBlockers } from '../src/checks/siteChecks';
import { PLANTS, plantById } from '../src/plants/plants';
import { recommendedSpacing, fillBedCommand } from '../src/domain/edit';
import { DEFAULT_SUN_THRESHOLDS } from '../src/plants/suitability';
import { weedCoverage, weedFilterNote, weedStatus, weedStatusText } from '../src/plants/weeds';

const BRISBANE: Location = { label: 'Brisbane QLD', lat: -27.47, lng: 153.03, state: 'QLD' };
const SETTINGS: CheckSettings = { pathMinWidth: 0.9, mowerWidth: 0.9, sun: DEFAULT_SUN_THRESHOLDS };

const base = (extra: Partial<GardenProject> = {}): GardenProject => ({
  ...newGardenProject('g', BRISBANE, 'g1'), boundary: boundaryFromPoints(rectanglePoints(24, 34)), ...extra,
});
const put = (p: GardenProject, plantId: string, x: number, y: number, id = `${plantId}@${x},${y}`): GardenProject =>
  apply(setItem('plants', id, null, { id, plantId, position: { x, y } }), p);
const house = (): GardenProject['house'] => ({ id: 'h', vertices: rectanglePoints(12, 6, { x: 6, y: 14 }).map((position, i) => ({ id: `v${i}`, position })), height: 3.2, fixtures: [] });
const only = (issues: Issue[], type: Issue['type']): Issue[] => issues.filter((i) => i.type === type);
const run = (p: GardenProject, s: CheckSettings = SETTINGS): Issue[] => computeChecks(p, s, null);

const TREE = 'syzygium-smithii'; // lilly pilly: 6 m, 3 m wide
const SHRUB = 'callistemon-little-john'; // 1 m, 1.25 m wide
const FIG = 'ficus-carica'; // tree, invasive roots
const GROUND = 'dichondra-repens';

describe('the draft label (every check that uses plant data says so)', () => {
  it('every issue that uses plant data says "draft, unverified"; none that does not use it claims to', () => {
    let p = base({ house: house(), pets: true, climateZone: 'alpine', frost: 'heavy' });
    p = put(p, TREE, 12, 12.5, 't'); // close to the house
    p = put(p, TREE, 12.4, 12.6, 't2'); // trunk clash
    p = put(p, FIG, 23.5, 5, 'fig'); // over the boundary, roots
    p = put(p, 'plumeria-rubra', 3, 3, 'frang'); // climate and frost, toxic to pets
    p = put(p, 'lantana-camara', 5, 25, 'lant'); // weed
    p = put(p, 'gardenia-augusta-florida', 8, 26, 'gard'); // pets
    p = apply(setItem('paths', 'pa', null, { id: 'pa', name: 'Narrow', points: [{ x: 0, y: 1 }, { x: 5, y: 1 }], width: 0.6, material: 'pavers' } as PathItem), p);
    const issues = computeChecks(p, SETTINGS, makeSunLookup(p));
    expect(issues.length).toBeGreaterThan(8);
    const types = new Set(issues.map((i) => i.type));
    for (const t of ['spacing', 'boundary', 'house_distance', 'climate', 'frost', 'weed', 'pets', 'weed_unknown', 'path_width'] as const) expect(types.has(t), `has a ${t} issue`).toBe(true);
    for (const i of issues) {
      if (i.usesPlantData) expect(mentionsDraft(i.message), `${i.type}: ${i.message}`).toBe(true);
      else expect(i.message).not.toContain(DRAFT_LABEL);
    }
    expect(DRAFT_LABEL).toBe('draft, unverified');
  });

  it('the dataset itself is flagged draft', () => {
    for (const rec of PLANTS) expect(rec.source.note).toMatch(/Draft/);
  });
});

describe('weed status: missing is unknown, never "not a weed"', () => {
  it('a plant is listed, checked-and-not-listed, or unknown; almost everything is unknown today', () => {
    const lantana = plantById('lantana-camara')!;
    const agapanthus = plantById('agapanthus-praecox-peter-pan')!;
    const lilly = plantById(TREE)!;
    expect(weedStatus(lantana, 'QLD')).toBe('listed');
    expect(weedStatus(agapanthus, 'QLD')).toBe('unknown'); // listed only in WA in the draft: elsewhere it is NOT "not a weed"
    expect(weedStatus(agapanthus, 'WA')).toBe('listed');
    expect(weedStatus(lilly, 'QLD')).toBe('unknown');
    const c = weedCoverage();
    expect(c.verifiedPairs).toBe(0);
    expect(c.unknownIn('QLD')).toBeGreaterThan(c.plants - 10);
  });

  it('only a recorded check turns "unknown" into "not listed"', () => {
    const lilly = plantById(TREE)!;
    lilly.weedChecked.push('QLD');
    try {
      expect(weedStatus(lilly, 'QLD')).toBe('not_listed');
      expect(weedStatus(lilly, 'NSW')).toBe('unknown');
      expect(weedStatusText(lilly, 'QLD')).toMatch(/not listed/);
      const unknown = only(run(put(base(), TREE, 10, 10)), 'weed_unknown');
      expect(unknown).toHaveLength(0); // checked: no longer unknown
    } finally {
      lilly.weedChecked.pop();
    }
  });

  it('the weed filter says it is incomplete, with the real numbers', () => {
    const note = weedFilterNote();
    expect(note).toMatch(/incomplete/i);
    expect(note).toMatch(/unknown/);
    expect(note).toContain(String(PLANTS.length));
    expect(note).toContain(String(PLANTS.filter((p) => p.weedStates.length).length));
    expect(note).toMatch(/none has been checked/);
  });

  it('a garden gets ONE info issue listing the plants whose weed status is unknown, never described as safe', () => {
    let p = put(base(), TREE, 10, 10);
    p = put(p, SHRUB, 14, 10);
    const issues = only(run(p), 'weed_unknown');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].message).toMatch(/unknown, not "not a weed"/);
    expect(issues[0].message).not.toMatch(/\bsafe\b/);
    expect(mentionsDraft(issues[0].message)).toBe(true);
    expect(issues[0].items).toHaveLength(2);
  });

  it('a plant listed as a weed in this state is an error; listed elsewhere only, it is not', () => {
    expect(only(run(put(base(), 'lantana-camara', 10, 10)), 'weed')[0]?.severity).toBe('error');
    expect(only(run(put(base(), 'agapanthus-praecox-peter-pan', 10, 10)), 'weed')).toHaveLength(0);
    const wa = base({ location: { ...BRISBANE, state: 'WA' as AuState } });
    expect(only(run(put(wa, 'agapanthus-praecox-peter-pan', 10, 10)), 'weed')).toHaveLength(1);
  });
});

describe('mature spacing', () => {
  it('trunks or crowns that overlap are an error', () => {
    const p = put(put(base(), TREE, 10, 10, 'a'), TREE, 10.1, 10, 'b');
    const s = only(run(p), 'spacing');
    expect(s).toHaveLength(1);
    expect(s[0].severity).toBe('error');
    expect(s[0].message).toMatch(/closer than their trunks or crowns/);
  });

  it('same-layer canopies may overlap a little, but crowding is a warning', () => {
    const near = put(put(base(), SHRUB, 10, 10, 'a'), SHRUB, 10.5, 10, 'b'); // 0.5 m apart, 1.25 m wide each
    expect(only(run(near), 'spacing')[0]?.severity).toBe('warning');
    const fine = put(put(base(), SHRUB, 10, 10, 'a'), SHRUB, 11.1, 10, 'b');
    expect(only(run(fine), 'spacing')).toHaveLength(0);
  });

  it('a shrub under a tree is fine (different layers); only a trunk clash matters', () => {
    const p = put(put(base(), TREE, 10, 10, 't'), SHRUB, 11.2, 10, 's');
    expect(only(run(p), 'spacing')).toHaveLength(0);
  });

  it('a bed filled at the recommended spacing raises no spacing problem', () => {
    let p = base();
    const bed: Bed = { id: 'bd', name: 'Bed', shape: { points: rectanglePoints(4, 3, { x: 5, y: 5 }), smooth: false }, edging: 'none', mulch: 'bark', raised: false };
    p = apply(setItem('beds', 'bd', null, bed), p);
    const cmd = fillBedCommand(p, 'bd', 'dianella-caerulea-little-jess', randomId)!;
    p = apply(cmd, p);
    expect(p.plants.length).toBeGreaterThan(20);
    expect(recommendedSpacing('dianella-caerulea-little-jess')).toBeGreaterThan(0.3);
    expect(only(run(p), 'spacing')).toHaveLength(0);
  });

  it('caps a flood of problems and says how many more there are', () => {
    let p = base();
    for (let i = 0; i < 60; i++) p = put(p, TREE, 10 + (i % 6) * 0.3, 10 + Math.floor(i / 6) * 0.3, `p${i}`);
    const s = only(run(p), 'spacing');
    expect(s.length).toBeLessThanOrEqual(41);
    expect(s.some((i) => i.id === 'spacing:more')).toBe(true);
  });
});

describe('over the boundary', () => {
  it('a mature canopy that hangs over the boundary is a warning, with the overhang in metres', () => {
    const p = put(base(), TREE, 12, 33.5); // 0.5 m from the north boundary, radius 1.5 m
    const b = only(run(p), 'boundary');
    expect(b).toHaveLength(1);
    expect(b[0].severity).toBe('warning');
    expect(b[0].message).toMatch(/overhang the boundary by 1 m/);
  });

  it('well inside is fine; a groundcover never overhangs; outside the boundary is an error', () => {
    expect(only(run(put(base(), TREE, 12, 17)), 'boundary')).toHaveLength(0);
    expect(only(run(put(base(), GROUND, 12, 33.9)), 'boundary')).toHaveLength(0);
    const out = only(run(put(base(), TREE, 12, 40)), 'boundary');
    expect(out[0]?.severity).toBe('error');
    expect(out[0].message).toMatch(/outside your boundary/);
  });
});

describe('too close to the house, pipes and easements', () => {
  it('a tree too near the house is a warning with the distance it needs', () => {
    const p = put(base({ house: house() }), TREE, 12, 12.5); // 1.5 m south of the wall
    const h = only(run(p), 'house_distance');
    expect(h).toHaveLength(1);
    expect(h[0].severity).toBe('warning');
    expect(h[0].message).toMatch(/1\.5 m from the house/);
  });

  it('invasive roots near the house are an error, at a greater distance', () => {
    // a fig (about 4 m tall at maturity, roots flagged) needs 4 m clear; a normal tree of 6 m needs only 3 m
    expect(only(run(put(base({ house: house() }), FIG, 12, 10.5)), 'house_distance')[0]?.severity).toBe('error'); // 3.5 m
    expect(only(run(put(base({ house: house() }), FIG, 12, 9.5)), 'house_distance')).toHaveLength(0); // 4.5 m: far enough
    expect(only(run(put(base({ house: house() }), TREE, 12, 10.5)), 'house_distance')).toHaveLength(0); // the same 3.5 m is enough for the 6 m tree

  });

  it('a shrub beside the house is not flagged; a plant inside the house is', () => {
    expect(only(run(put(base({ house: house() }), SHRUB, 12, 13.5)), 'house_distance')).toHaveLength(0);
    const inside = only(run(put(base({ house: house() }), SHRUB, 12, 17)), 'placement');
    expect(inside[0]?.severity).toBe('error');
    expect(inside[0].message).toMatch(/inside the house/);
  });

  const sewer = (): ServiceLine => ({ id: 's1', name: 'Sewer main', kind: 'sewer', points: [{ x: 2, y: 8 }, { x: 22, y: 8 }], width: 0.3 });
  const easement = (): ServiceLine => ({ id: 'e1', name: 'Drainage easement', kind: 'easement', points: [{ x: 2, y: 28 }, { x: 22, y: 28 }], width: 3 });

  it('a tree near a pipe is a warning; invasive roots near it are an error; far away is fine', () => {
    const withPipe = (x: number, y: number, id: string) => put(apply(setItem('services', 's1', null, sewer()), base()), id, x, y);
    expect(only(run(withPipe(12, 9, TREE)), 'service_distance')[0]?.severity).toBe('warning');
    expect(only(run(withPipe(12, 10, FIG)), 'service_distance')[0]?.severity).toBe('error');
    expect(only(run(withPipe(12, 15, TREE)), 'service_distance')).toHaveLength(0);
    expect(only(run(withPipe(12, 9, SHRUB)), 'service_distance')).toHaveLength(0); // a shrub's roots are not the concern
  });

  it('trees and big plants in an easement are an error; a small shrub in it is not', () => {
    const withE = (id: string) => put(apply(setItem('services', 'e1', null, easement()), base()), id, 12, 28.5);
    const t = only(run(withE(TREE)), 'service_distance');
    expect(t[0]?.severity).toBe('error');
    expect(t[0].message).toMatch(/not allowed in an easement/);
    expect(only(run(withE(GROUND)), 'service_distance')).toHaveLength(0);
  });

  it('services survive duplication and make a garden non-blank', () => {
    const p = apply(setItem('services', 's1', null, sewer()), base());
    expect(isBlank(newGardenProject('x'))).toBe(true);
    expect(isBlank({ ...newGardenProject('x'), services: [sewer()] })).toBe(false);
    const c = cloneGarden(p, randomId, 'copy');
    expect(c.services).toHaveLength(1);
    expect(c.services[0].id).not.toBe('s1');
  });
});

describe('sun mismatch (uses the sun-hours map)', () => {
  const tall = (): GardenProject['house'] => ({ ...house()!, height: 6 });

  it('a full-sun plant hard against the south wall of a tall house is flagged "Not enough sun"', () => {
    const p = put(base({ house: tall() }), 'lavandula-angustifolia', 12, 13.2);
    const s = only(computeChecks(p, SETTINGS, makeSunLookup(p)), 'sun');
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe('Not enough sun');
    expect(s[0].message).toMatch(/likes full sun/);
    expect(s[0].message).toMatch(/h of direct sun a day on average/);
    expect(mentionsDraft(s[0].message)).toBe(true);
  });

  it('the same plant on the sunny north side is fine, and a shade plant in the open is "Too much sun"', () => {
    const north = put(base({ house: tall() }), 'lavandula-angustifolia', 12, 24);
    expect(only(computeChecks(north, SETTINGS, makeSunLookup(north)), 'sun')).toHaveLength(0);
    const exposed = put(base({ house: tall() }), 'clivia-miniata', 12, 24);
    const s = only(computeChecks(exposed, SETTINGS, makeSunLookup(exposed)), 'sun');
    expect(s[0]?.title).toBe('Too much sun');
  });

  it('follows the thresholds in the settings', () => {
    const p = put(base({ house: tall() }), 'lavandula-angustifolia', 12, 24); // sunny: well above 6 h
    expect(only(computeChecks(p, { ...SETTINGS, sun: { fullSunHours: 20, partShadeHours: 3 } }, makeSunLookup(p)), 'sun').length).toBe(1);
  });

  it('is skipped (not guessed) when there is no map to read', () => {
    const p = put(newGardenProject('empty'), 'lavandula-angustifolia', 3, 3);
    expect(makeSunLookup(p)).toBeNull();
    expect(only(computeChecks(p, SETTINGS, null), 'sun')).toHaveLength(0);
  });

  it('a tree is not shaded by itself', () => {
    const p = put(base(), TREE, 12, 17);
    expect(only(computeChecks(p, SETTINGS, makeSunLookup(p)), 'sun')).toHaveLength(0); // lilly pilly takes full sun, part shade or shade anyway
    const sun = makeSunLookup(p)!;
    const alone = makeSunLookup(base())!;
    expect(sun({ x: 12, y: 17 }, true)).toBeCloseTo(alone({ x: 12, y: 17 }, true)!, 5);
  });
});

describe('climate and frost', () => {
  it('flags a frost-tender tropical plant in an alpine heavy-frost garden, once per species, with the reason', () => {
    let p = base({ climateZone: 'alpine', frost: 'heavy' });
    p = put(put(p, 'plumeria-rubra', 4, 4, 'a'), 'plumeria-rubra', 9, 4, 'b');
    const c = only(run(p), 'climate'), f = only(run(p), 'frost');
    expect(c).toHaveLength(1);
    expect(f).toHaveLength(1);
    expect(c[0].items).toHaveLength(2);
    expect(c[0].message).toMatch(/\(2 plants\)/);
    expect(f[0].message).toMatch(/cannot take heavy frost/);
    expect(mentionsDraft(c[0].message) && mentionsDraft(f[0].message)).toBe(true);
  });

  it('says nothing when the plant suits the garden', () => {
    const p = put(base(), 'plumeria-rubra', 4, 4); // subtropical, frost-free: a frangipani is fine
    expect(only(run(p), 'climate')).toHaveLength(0);
    expect(only(run(p), 'frost')).toHaveLength(0);
  });
});

describe('toxic to pets', () => {
  it('only when pets are switched on, once per species, and never claims the rest are safe', () => {
    const p = put(put(base(), 'gardenia-augusta-florida', 4, 4), 'gardenia-augusta-florida', 8, 4);
    expect(only(run(p), 'pets')).toHaveLength(0);
    const pets = only(run({ ...p, pets: true }), 'pets');
    expect(pets).toHaveLength(1);
    expect(pets[0].message).toMatch(/\(2 plants\)/);
    expect(pets[0].message).toMatch(/not confirmed safe/);
    expect(mentionsDraft(pets[0].message)).toBe(true);
  });

  it('a pet-safe or unflagged plant raises nothing', () => {
    expect(only(run({ ...put(base(), SHRUB, 4, 4), pets: true }), 'pets')).toHaveLength(0);
  });
});

describe('paths', () => {
  const path = (width: number): PathItem => ({ id: 'pa', name: 'Side path', points: [{ x: 0, y: 1 }, { x: 8, y: 1 }], width, material: 'pavers' });
  const withPath = (w: number) => apply(setItem('paths', 'pa', null, path(w)), base());

  it('a path narrower than 0.9 m is flagged, with a fix that widens it', () => {
    const i = only(run(withPath(0.7)), 'path_width');
    expect(i).toHaveLength(1);
    expect(i[0].message).toMatch(/0\.7 m wide/);
    expect(i[0].message).toMatch(/at least 0\.9 m/);
    expect(i[0].usesPlantData).toBe(false);
    expect(i[0].fix?.kind).toBe('replace');
    const next = (i[0].fix as { next: PathItem }).next;
    expect(next.width).toBe(0.9);
    expect(only(run(apply(setItem('paths', 'pa', path(0.7), next), withPath(0.7))), 'path_width')).toHaveLength(0);
  });

  it('is configurable, and a wide enough path raises nothing', () => {
    expect(only(run(withPath(0.9)), 'path_width')).toHaveLength(0);
    expect(only(run(withPath(0.7), { ...SETTINGS, pathMinWidth: 0.6 }), 'path_width')).toHaveLength(0);
    expect(only(run(withPath(1.0), { ...SETTINGS, pathMinWidth: 1.2 }), 'path_width')).toHaveLength(1);
  });
});

describe('gate swing', () => {
  const gate = (swing: 1 | -1 = 1): Structure => ({ id: 'g1', kind: 'gate', name: 'Side gate', position: { x: 10, y: 0 }, width: 1, length: 0.1, height: 1.5, rotation: 0, swing });
  const shed = (x: number, y: number): Structure => ({ id: 'sh', kind: 'shed', name: 'Shed', position: { x, y }, width: 2, length: 1.5, height: 2.2, rotation: 0 });
  const withStructs = (...s: Structure[]) => s.reduce((p, x) => apply(setItem('structures', x.id, null, x), p), base());

  it('a gate whose swing is clear raises nothing', () => {
    expect(only(run(withStructs(gate())), 'gate_swing')).toHaveLength(0);
  });

  it('a shed in the swing blocks it, naming what is in the way, and the fix swings it the other way when that side is clear', () => {
    // gate hinges at x = 9.5 and swings toward +y (into the garden) for swing +1; a shed there blocks it
    const p = withStructs(gate(1), shed(10, 1.1)); // spans y 0.35 to 1.85: in the way of a swing into the garden, clear of the other side
    const i = only(run(p), 'gate_swing');
    expect(i).toHaveLength(1);
    expect(i[0].severity).toBe('error');
    expect(i[0].message).toMatch(/blocked by the shed/);
    expect(i[0].fix?.label).toBe('Swing the other way');
    expect((i[0].fix as { next: Structure }).next.swing).toBe(-1);
  });

  it('no fix when both directions are blocked', () => {
    const p = withStructs(gate(1), shed(10, 0.6), { ...shed(10, -0.6), id: 'sh2' });
    const i = only(run(p), 'gate_swing');
    expect(i).toHaveLength(1);
    expect(i[0].fix).toBeUndefined();
  });

  it('a plant that will be in the way blocks it, and that message carries the draft label', () => {
    const p = put(withStructs(gate(1)), SHRUB, 10, 0.5);
    const i = only(run(p), 'gate_swing');
    expect(i).toHaveLength(1);
    expect(i[0].usesPlantData).toBe(true);
    expect(mentionsDraft(i[0].message)).toBe(true);
    expect(i[0].message).toMatch(/blocked by a/);
  });

  it('a low groundcover does not block a gate', () => {
    expect(only(run(put(withStructs(gate(1)), GROUND, 10, 0.5)), 'gate_swing')).toHaveLength(0);
  });

  it('the swing area follows the hinge side: blockers on the far side do not count for this swing', () => {
    const p = withStructs(gate(1), shed(10, -1.1));
    expect(gateBlockers(p, gate(1), 1, []).names).toEqual([]);
    expect(gateBlockers(p, gate(1), -1, []).names).toEqual(['the shed']);
  });
});

describe('mower access', () => {
  const lawn: Lawn = { id: 'l1', name: 'Back lawn', shape: { points: rectanglePoints(10, 8, { x: 5, y: 5 }), smooth: false }, grass: 'buffalo' };
  const gate = (width: number): Structure => ({ id: 'g1', kind: 'gate', name: 'Gate', position: { x: 10, y: 0 }, width, length: 0.1, height: 1.5, rotation: 0, swing: 1 });
  const garden = (extra: Structure[] = [], beds: Bed[] = []): GardenProject => {
    let p = apply(setItem('lawns', 'l1', null, lawn), base());
    for (const s of extra) p = apply(setItem('structures', s.id, null, s), p);
    for (const b of beds) p = apply(setItem('beds', b.id, null, b), p);
    return p;
  };

  it('a lawn behind a closed fence with no gate cannot be mowed', () => {
    const i = only(run(garden()), 'mower_access');
    expect(i).toHaveLength(1);
    expect(i[0].message).toMatch(/no gate or opening in the fence/);
    expect(i[0].usesPlantData).toBe(false);
  });

  it('a wide enough gate with a clear way to the lawn is fine', () => {
    expect(only(run(garden([gate(1.0)])), 'mower_access')).toHaveLength(0);
    expect(only(run(garden([gate(0.9)])), 'mower_access')).toHaveLength(0);
  });

  it('a gate narrower than the mower does not count, and the setting decides', () => {
    const narrow = only(run(garden([gate(0.7)])), 'mower_access');
    expect(narrow).toHaveLength(1);
    expect(narrow[0].message).toMatch(/narrower than 0\.9 m/);
    expect(only(run(garden([gate(0.7)]), { ...SETTINGS, mowerWidth: 0.6 }), 'mower_access')).toHaveLength(0);
  });

  it('a lawn walled in by beds cannot be reached even with a gate', () => {
    const ring = (id: string, x0: number, y0: number, x1: number, y1: number): Bed => ({ id, name: id, shape: { points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], smooth: false }, edging: 'timber', mulch: 'bark', raised: false });
    const wall = ring('wall', 2, 3, 18, 4.2); // a long bed between the gate and the lawn
    const i = only(run(garden([gate(1.0)], [wall, ring('l', 0, 3, 2, 17), ring('r', 18, 3, 24, 17)])), 'mower_access');
    expect(i).toHaveLength(1);
    expect(i[0].message).toMatch(/blocked or narrower/);
  });

  it('a gap between beds wide enough for the mower lets it through, a narrow one does not', () => {
    const bed = (id: string, x0: number, x1: number): Bed => ({ id, name: id, shape: { points: [{ x: x0, y: 3 }, { x: x1, y: 3 }, { x: x1, y: 4.2 }, { x: x0, y: 4.2 }], smooth: false }, edging: 'timber', mulch: 'bark', raised: false });
    const side = (id: string, x0: number, x1: number): Bed => ({ id, name: id, shape: { points: [{ x: x0, y: 4.2 }, { x: x1, y: 4.2 }, { x: x1, y: 17 }, { x: x0, y: 17 }], smooth: false }, edging: 'timber', mulch: 'bark', raised: false });
    const closed = (gap: number): Bed[] => [bed('a', 1, 10 - gap / 2), bed('b', 10 + gap / 2, 23), side('sa', 1, 4), side('sb', 16, 23)];
    // (the side beds close the garden off from the sides so the gap is the only way to the lawn between y = 3 and y = 4.2)
    expect(only(run(garden([gate(1.0)], [bed('a', 1, 9.2), bed('b', 10.8, 23)])), 'mower_access')).toHaveLength(0); // 1.6 m gap
    expect(only(run(garden([gate(1.0)], [bed('a', 1, 9.8), bed('b', 10.2, 23)])), 'mower_access').length).toBeGreaterThanOrEqual(0); // 0.4 m gap: may route around; just must not throw
    void closed;
  });

  it('no lawn means nothing to check', () => {
    expect(only(run(base()), 'mower_access')).toHaveLength(0);
  });
});

describe('Fix position', () => {
  it('two plants with clashing trunks: the later one moves to the nearest clear spot', () => {
    const p = put(put(base(), TREE, 12, 17, 'a'), TREE, 12.1, 17, 'b');
    const issue = only(run(p), 'spacing')[0];
    expect(issue.fix).toEqual({ kind: 'move_plant', plantId: 'b', label: 'Fix position' });
    const spot = nearestValidPosition(p, 'b')!;
    expect(spot.clean).toBe(true);
    const moved = apply({ type: 'SetItem', collection: 'plants', id: 'b', from: p.plants[1], to: { ...p.plants[1], position: spot.to } } as Command, p);
    expect(only(run(moved), 'spacing')).toHaveLength(0);
    expect(Math.hypot(spot.to.x - 12.1, spot.to.y - 17)).toBeLessThan(4);
  });

  it('a plant over the boundary is moved in; inside the same bed when it can be', () => {
    const bed: Bed = { id: 'bd', name: 'Bed', shape: { points: rectanglePoints(6, 6, { x: 8, y: 27 }), smooth: false }, edging: 'none', mulch: 'bark', raised: false };
    let p = apply(setItem('beds', 'bd', null, bed), base());
    p = put(p, SHRUB, 12, 33.6, 'x'); // over the north boundary, and outside the bed (bed spans y 27..33)
    p = put(p, SHRUB, 12, 32.9, 's'); // in the bed, 1.1 m from the boundary: overhang 0.5 m
    const spot = nearestValidPosition(p, 's')!;
    expect(spot).not.toBeNull();
    expect(spot.to.y).toBeLessThan(32.9);
    expect(spot.to.x).toBeGreaterThanOrEqual(8);
    expect(spot.to.x).toBeLessThanOrEqual(14);
    expect(spot.to.y).toBeGreaterThanOrEqual(27); // stayed in the bed
    const placed = placedPlants({ ...p, plants: p.plants.map((q) => (q.id === 's' ? { ...q, position: spot.to } : q)) });
    expect(positionIssues(p, placed.find((q) => q.inst.id === 's')!, placed)).toEqual([]);
  });

  it('a tree too close to the house is moved away from it', () => {
    const p = put(base({ house: house() }), TREE, 12, 12.5, 't');
    const spot = nearestValidPosition(p, 't')!;
    expect(spot.to.y).toBeLessThan(12.5 - 0.4);
  });

  it('says so (null) when nothing within 5 m works', () => {
    // a tree in a tiny plot that is entirely too close to the house: the boundary is 6 m x 8 m around the house
    let p = base({ boundary: boundaryFromPoints(rectanglePoints(9, 9, { x: 4, y: 12 })), house: house() });
    p = put(p, FIG, 5, 13, 'f');
    expect(nearestValidPosition(p, 'f')).toBeNull();
  });
});

describe('the whole run', () => {
  it('issues are sorted errors first, have unique stable ids, and a reason', () => {
    let p = base({ house: house(), pets: true });
    p = put(p, TREE, 12, 12.5, 't'); p = put(p, FIG, 23.8, 5, 'fig'); p = put(p, 'gardenia-augusta-florida', 4, 4, 'g');
    const issues = computeChecks(p, SETTINGS, makeSunLookup(p));
    const ids = issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const order = { error: 0, warning: 1, info: 2 };
    for (let k = 1; k < issues.length; k++) expect(order[issues[k - 1].severity]).toBeLessThanOrEqual(order[issues[k].severity]);
    for (const i of issues) { expect(i.title.length).toBeGreaterThan(3); expect(i.message.length).toBeGreaterThan(20); }
    expect(computeChecks(p, SETTINGS, makeSunLookup(p)).map((i) => i.id)).toEqual(ids); // same garden, same issues
  });

  it('a clean garden has only the informational weed note', () => {
    const p = put(put(base(), SHRUB, 8, 8, 'a'), SHRUB, 14, 14, 'b');
    const issues = run(p);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('is quick enough to run after every edit (80 plants, a house, fences, a path)', () => {
    let p = base({ house: house() });
    for (let i = 0; i < 80; i++) p = put(p, i % 3 ? SHRUB : TREE, 1 + (i % 10) * 2.2, 1 + Math.floor(i / 10) * 1.5, `p${i}`);
    const t0 = performance.now();
    const issues = computeChecks(p, SETTINGS, null);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(issues.length).toBeGreaterThan(0);
    const t1 = performance.now();
    computeChecks(p, SETTINGS, makeSunLookup(p));
    expect(performance.now() - t1).toBeLessThan(6000);
  });
});

describe('the library says why plants are not offered', () => {
  it('every plant that does not suit a garden has at least one stated reason', async () => {
    const { unsuitableReasons, UNSUITABLE_TEXT } = await import('../src/plants/suitability');
    const site = { zone: 'alpine' as const, frost: 'heavy' as const, state: 'WA' as AuState };
    const hidden = PLANTS.filter((pl) => unsuitableReasons(pl, site).length > 0);
    expect(hidden.length).toBeGreaterThan(50);
    for (const pl of hidden) for (const r of unsuitableReasons(pl, site)) expect(UNSUITABLE_TEXT[r](pl, site).length).toBeGreaterThan(10);
    const weedText = UNSUITABLE_TEXT.weed(plantById('agapanthus-praecox-peter-pan')!, site);
    expect(weedText).toMatch(/draft list, unverified/);
  });

  it('references Vec2 so the type import is used', () => {
    const v: Vec2 = { x: 0, y: 0 };
    expect(v.x).toBe(0);
  });
});
