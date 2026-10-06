import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BOTTLE_PROFILES, DEFAULT_RULES as R, carcassHeightMm, displayClearMm, displayDepthNeededMm, displayEnvelopeMm, displayTiers, internalDepthMm,
  minOuterDepthMm, moduleHeightsMm, netWidthMm, scallopedRows, slotsPerRow, stackZoneMm, targetWidthMm, type CabinetBay,
} from '../src/engine';

const P = BOTTLE_PROFILES;

describe('the stack', () => {
  it('2200 mm bay: 100 plinth + 16 + stack + 16 + 50 rail leaves 2018 mm', () => {
    expect(carcassHeightMm(2200, R)).toBe(2050);
    expect(stackZoneMm(2200, R)).toBe(2018);
  });
  it('the base module takes the remainder of the stack', () => {
    const bay: CabinetBay = { id: 'b', xMm: 0, widthMm: 800, outerDepthMm: 350, outerHeightMm: 2200, modules: [
      { id: 'm0', storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX' },
      { id: 'm1', storageStyle: 'LABEL_FORWARD', bottleProfile: 'BORDEAUX', heightMm: 400 },
      { id: 'm2', storageStyle: 'SCALLOPED_CRADLE', bottleProfile: 'BORDEAUX', heightMm: 300 },
    ] };
    expect(moduleHeightsMm(bay, R)).toEqual([1318, 400, 300]);
  });
});

describe('scalloped rows', () => {
  it('worked example: 1768 mm net, Bordeaux -> 15 rows, 102.93 mm clear, 44 mm absorbed in all', () => {
    const r = scallopedRows(1768, P.BORDEAUX, R);
    expect(r.rows).toBe(15);
    expect(r.clearMm).toBeCloseTo(1544 / 15, 6);
    expect(r.absorbedMm * r.rows).toBeCloseTo(44, 6);
  });
  it('a module too short for one row has none', () => {
    expect(scallopedRows(99, P.BORDEAUX, R).rows).toBe(0);
    expect(scallopedRows(100, P.BORDEAUX, R).rows).toBe(1);
    expect(scallopedRows(0, P.BORDEAUX, R).rows).toBe(0);
    expect(scallopedRows(-50, P.BORDEAUX, R).rows).toBe(0);
  });
  it('just under the next row stays at N rows, exactly enough adds one', () => {
    expect(scallopedRows(100 + 16 + 100 - 1, P.BORDEAUX, R).rows).toBe(1);
    expect(scallopedRows(100 + 16 + 100, P.BORDEAUX, R).rows).toBe(2);
  });
  it('property: rows are the most that fit, every row is at least the minimum, and the heights add back up', () => {
    fc.assert(fc.property(fc.integer({ min: 100, max: 3000 }), fc.constantFrom(...Object.values(P)), (net, p) => {
      const r = scallopedRows(net, p, R);
      if (net < p.minClearMm) return r.rows === 0;
      const T = R.boardMm;
      const fits = r.clearMm >= p.minClearMm - 1e-9;
      const maximal = (r.rows + 1) * p.minClearMm + r.rows * T > net;
      const adds = Math.abs(r.rows * r.clearMm + (r.rows - 1) * T - net) < 1e-6;
      return fits && maximal && adds;
    }));
  });
});

describe('slots across a row', () => {
  it('800 mm bay (768 mm inside): Bordeaux 9, Burgundy 7, Champagne 7, Magnum 6', () => {
    expect(netWidthMm(800, R)).toBe(768);
    expect(slotsPerRow(800, P.BORDEAUX.slotPitchMm, R)).toBe(9);
    expect(slotsPerRow(800, P.BURGUNDY.slotPitchMm, R)).toBe(7);
    expect(slotsPerRow(800, P.CHAMPAGNE.slotPitchMm, R)).toBe(7);
    expect(slotsPerRow(800, P.MAGNUM.slotPitchMm, R)).toBe(6);
  });
  it('a bay narrower than its sides holds nothing and never goes negative', () => {
    expect(slotsPerRow(20, 85, R)).toBe(0);
    expect(slotsPerRow(0, 85, R)).toBe(0);
  });
  it('the width that wastes nothing: 2 sides plus whole slots', () => {
    expect(targetWidthMm(9, P.BORDEAUX, R)).toBe(797);
    expect(targetWidthMm(8, P.BORDEAUX, R)).toBe(712);
    for (const k of [3, 6, 9]) expect(slotsPerRow(targetWidthMm(k, P.BORDEAUX, R), P.BORDEAUX.slotPitchMm, R)).toBe(k);
  });
});

describe('label-forward displays', () => {
  it('inclined envelope: Bordeaux about 151 mm, Champagne about 177.5 mm', () => {
    expect(displayEnvelopeMm(P.BORDEAUX, R)).toBeCloseTo(151.06, 1);
    expect(displayEnvelopeMm(P.CHAMPAGNE, R)).toBeCloseTo(177.5, 0);
    expect(displayClearMm(P.BORDEAUX, R)).toBeCloseTo(176.06, 1);
  });
  it('a 384 mm net display holds 2 tiers; 190 mm net holds 1; 175 mm none', () => {
    expect(displayTiers(384, P.BORDEAUX, R).rows).toBe(2);
    expect(displayTiers(190, P.BORDEAUX, R).rows).toBe(1);
    expect(displayTiers(175, P.BORDEAUX, R).rows).toBe(0);
  });
  it('the tier count does not change if the hand clearance is 15 mm instead of 25 (so the golden case does not hinge on that choice)', () => {
    expect(displayTiers(384, P.BORDEAUX, { ...R, displayHandClearanceMm: 15 }).rows).toBe(2);
  });
  it('depth an inclined bottle needs: about 330 mm for Bordeaux with a 20 mm lip', () => {
    expect(displayDepthNeededMm(P.BORDEAUX, R)).toBeCloseTo(329.5, 0);
  });
});

describe('depth', () => {
  it('350 mm outer is 328 mm inside', () => {
    expect(internalDepthMm(350, R)).toBe(328);
    expect(internalDepthMm(360, R)).toBe(338);
  });
  it('minimum outer depth rounds up to the next 10 mm: Champagne 360, Magnum 410', () => {
    expect(minOuterDepthMm(P.CHAMPAGNE.lengthMm + R.depthClearanceMm, R)).toBe(360);
    expect(minOuterDepthMm(P.MAGNUM.lengthMm + R.depthClearanceMm, R)).toBe(410);
    expect(minOuterDepthMm(P.BORDEAUX.lengthMm + R.depthClearanceMm, R)).toBe(340);
  });
});
