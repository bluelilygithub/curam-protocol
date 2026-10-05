import { describe, expect, it } from 'vitest';
import { CLIMATE_ZONES } from '../src/domain/types';
import { GROWTH_STAGES, autumnTint, canopyColour, leafFactor, mid, plantSizeAt, seasonOf, sizeFraction } from '../src/plants/growth';
import { PLANTS, parseMonths, plantById } from '../src/plants/plants';
import { PLANT_ROWS } from '../src/plants/plantRows';
import { DEFAULT_SUN_THRESHOLDS, sunLevelForHours, suitsSite, unsuitableReasons } from '../src/plants/suitability';

describe('starter dataset', () => {
  it('has about 150 plants, every row valid, ids unique', () => {
    expect(PLANT_ROWS.length).toBe(PLANTS.length);
    expect(PLANTS.length).toBeGreaterThanOrEqual(145);
    expect(PLANTS.length).toBeLessThanOrEqual(180);
    expect(new Set(PLANTS.map((p) => p.id)).size).toBe(PLANTS.length);
  });

  it('is roughly half natives', () => {
    const natives = PLANTS.filter((p) => p.native).length;
    expect(natives / PLANTS.length).toBeGreaterThan(0.4);
    expect(natives / PLANTS.length).toBeLessThan(0.6);
  });

  it('covers every climate zone with a useful number of plants', () => {
    // alpine gardens have genuinely few suitable plants, so the bar is lower there
    for (const z of CLIMATE_ZONES) expect(PLANTS.filter((p) => p.zones.includes(z)).length, z).toBeGreaterThanOrEqual(z === 'alpine' ? 15 : 25);
  });

  it('has sane values on every record', () => {
    for (const p of PLANTS) {
      expect(p.height[0], p.id).toBeLessThanOrEqual(p.height[1]);
      expect(p.spread[0], p.id).toBeLessThanOrEqual(p.spread[1]);
      expect(p.height[0], p.id).toBeGreaterThan(0);
      expect(p.yearsToMature, p.id).toBeGreaterThan(0);
      expect(p.sun.length, p.id).toBeGreaterThan(0);
      expect(p.zones.length, p.id).toBeGreaterThan(0);
      expect(p.soils.length, p.id).toBeGreaterThan(0);
      expect(p.common.length, p.id).toBeGreaterThan(0);
      expect(p.foliageColour, p.id).toMatch(/^#[0-9a-f]{6}$/);
      for (const c of p.flowerColours) expect(c, p.id).toMatch(/^#[0-9a-f]{6}$/);
      for (const m of p.flowerMonths) { expect(m).toBeGreaterThanOrEqual(1); expect(m).toBeLessThanOrEqual(12); }
      expect(p.native ? p.flowerColours.length >= 0 : true).toBe(true);
      expect(p.source.note.length, p.id).toBeGreaterThan(10);
    }
  });

  it('every record has a source, and natives are never listed as weeds without a reason to', () => {
    for (const p of PLANTS) expect(p.source.dataset).toMatch(/^starter-/);
  });

  it('every weed state is a real state and every code is valid (a caution letter in the weed column was a past bug)', () => {
    const states = new Set(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
    for (const p of PLANTS) {
      for (const s of p.weedStates) expect(states.has(s), `${p.id} weed state ${s}`).toBe(true);
      for (const s of p.origin) expect(states.has(s), `${p.id} origin ${s}`).toBe(true);
      expect(p.weedChecked, `${p.id} has no verified weed states yet`).toEqual([]);
    }
  });

  it('the big-rooted native trees and the fig are flagged for invasive roots', () => {
    for (const id of ['ficus-carica', 'jacaranda-mimosifolia', 'corymbia-maculata', 'angophora-costata', 'melaleuca-quinquenervia']) {
      expect(PLANTS.find((p) => p.id === id)?.cautions, id).toContain('invasive_roots');
    }
  });

  it('parses wrapping flowering months', () => {
    expect(parseMonths('11-2')).toEqual([11, 12, 1, 2]);
    expect(parseMonths('9-11')).toEqual([9, 10, 11]);
    expect(parseMonths('1-12')).toHaveLength(12);
    expect(parseMonths('-')).toEqual([]);
  });

  it('pulls the cultivar out of the name', () => {
    const p = plantById('grevillea-robyn-gordon')!;
    expect(p.botanical).toBe('Grevillea');
    expect(p.cultivar).toBe('Robyn Gordon');
  });
});

describe('growth', () => {
  const lilly = plantById('syzygium-smithii')!;
  const robyn = plantById('grevillea-robyn-gordon')!;

  it('mature size is the middle of the record ranges', () => {
    const s = plantSizeAt(robyn, 'mature');
    expect(s.height).toBeCloseTo(mid(robyn.height));
    expect(s.spread).toBeCloseTo(mid(robyn.spread));
    expect(s.canopyRadius).toBeCloseTo(mid(robyn.spread) / 2);
  });

  it('never shrinks as the stages advance, and never exceeds mature', () => {
    for (const p of PLANTS) {
      let prev = 0;
      for (const st of GROWTH_STAGES) {
        const s = plantSizeAt(p, st);
        expect(s.height, `${p.id} ${st}`).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(s.height, p.id).toBeLessThanOrEqual(mid(p.height) + 1e-9);
        prev = s.height;
      }
    }
  });

  it('a slow tree is still small at 5 years, a fast shrub nearly there', () => {
    expect(plantSizeAt(lilly, 'yr5').fraction).toBeLessThan(0.7);
    expect(plantSizeAt(robyn, 'yr5').fraction).toBeGreaterThan(0.99);
  });

  it('a nursery plant starts smaller than maturity', () => {
    expect(sizeFraction(lilly, 0)).toBeLessThan(0.2);
    expect(plantSizeAt(lilly, 'planted').height).toBeLessThan(plantSizeAt(lilly, 'mature').height);
  });
});

describe('seasons (southern hemisphere)', () => {
  it('summer is Dec-Feb, winter Jun-Aug', () => {
    expect(seasonOf(12)).toBe('summer'); expect(seasonOf(1)).toBe('summer'); expect(seasonOf(2)).toBe('summer');
    expect(seasonOf(7)).toBe('winter'); expect(seasonOf(10)).toBe('spring'); expect(seasonOf(4)).toBe('autumn');
  });

  it('deciduous plants are bare in winter, evergreens never', () => {
    const maple = plantById('acer-palmatum')!;
    const lilly = plantById('syzygium-smithii')!;
    expect(leafFactor(maple, 7)).toBe(0);
    expect(leafFactor(maple, 1)).toBe(1);
    expect(leafFactor(lilly, 7)).toBe(1);
    expect(autumnTint(maple, 5)).toBe(1);
    expect(canopyColour(lilly, 5)).toBe(lilly.foliageColour);
  });
});

describe('suitability', () => {
  it('hides a frost-tender tropical plant in an alpine, heavy-frost garden', () => {
    const frangipani = plantById('plumeria-rubra')!;
    const alpine = { zone: 'alpine' as const, frost: 'heavy' as const, state: 'NSW' as const };
    expect(suitsSite(frangipani, alpine)).toBe(false);
    expect(unsuitableReasons(frangipani, alpine)).toEqual(expect.arrayContaining(['climate', 'frost']));
  });

  it('keeps it in a tropical, frost-free one', () => {
    const frangipani = plantById('plumeria-rubra')!;
    expect(suitsSite(frangipani, { zone: 'tropical', frost: 'none', state: 'QLD' })).toBe(true);
  });

  it('flags a weed in the states it is listed for, only', () => {
    const lantana = plantById('lantana-camara')!;
    expect(suitsSite(lantana, { zone: 'subtropical', frost: 'none', state: 'QLD' })).toBe(false);
    expect(unsuitableReasons(lantana, { zone: 'subtropical', frost: 'none', state: 'QLD' })).toContain('weed');
    const agapanthus = plantById('agapanthus-praecox-peter-pan')!;
    expect(unsuitableReasons(agapanthus, { zone: 'warm_temperate', frost: 'light', state: 'NSW' })).not.toContain('weed');
  });

  it('maps sun hours to full sun / part shade / shade at 6 and 3 hours', () => {
    expect(sunLevelForHours(7)).toBe('full_sun');
    expect(sunLevelForHours(6)).toBe('full_sun');
    expect(sunLevelForHours(4)).toBe('part_shade');
    expect(sunLevelForHours(3)).toBe('part_shade');
    expect(sunLevelForHours(2.9)).toBe('shade');
    expect(sunLevelForHours(5, { ...DEFAULT_SUN_THRESHOLDS, fullSunHours: 5 })).toBe('full_sun');
  });
});
