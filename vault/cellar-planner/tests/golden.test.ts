import { describe, expect, it } from 'vitest';
import { analyseProject, goldenCase01 } from '../src/engine';

// Golden Test Case #01 is a WORKED EXAMPLE from the spec's formulas. It proves the code matches the formulas; it does not prove the formulas
// match a real job. Real-job validation is pending (spec-v1.md section 11).
describe('Golden Test Case #01', () => {
  const project = goldenCase01();
  const a = analyseProject(project);
  const bay = a.walls[0].bays[0];

  it('lays three identical whole-millimetre bays along a 2450 mm wall', () => {
    expect(a.walls[0]).toMatchObject({ lengthMm: 2450, startOffsetMm: 50, endOffsetMm: 50, usableMm: 2350 });
    const bays = project.room.walls[0].bays;
    expect(bays.map((b) => b.widthMm)).toEqual([783, 783, 783]);
    expect(bays.map((b) => b.xMm)).toEqual([50, 833, 1616]);
    // the 1 mm left over from 2350 / 3 went to the end scribe, not to a bay
    expect(2450 - (1616 + 783)).toBe(51);
  });

  it('works out the bay dimensions', () => {
    expect(bay.stackZoneMm).toBe(2018);
    expect(bay.internalDepthMm).toBe(338);
    expect(bay.netWidthMm).toBe(751);
  });

  it('the base module takes the rest of the stack: 1618 mm, 14 rows of 8, 100.71 mm clear', () => {
    const m0 = bay.modules[0];
    expect(m0.heightMm).toBe(1618);
    expect(m0.netHeightMm).toBe(1618);
    expect(m0.rows).toBe(14);
    expect(m0.slotsPerRow).toBe(8);
    expect(m0.clearMm).toBeCloseTo(1410 / 14, 6);
    expect(m0.capacity).toBe(112);
  });

  it('the 400 mm display module has 384 mm net, 2 tiers of 8', () => {
    const m1 = bay.modules[1];
    expect(m1.heightMm).toBe(400);
    expect(m1.netHeightMm).toBe(384);
    expect(m1.rows).toBe(2);
    expect(m1.slotsPerRow).toBe(8);
    expect(m1.capacity).toBe(16);
  });

  it('holds 128 bottles a bay and 384 in all', () => {
    expect(bay.capacity).toBe(128);
    expect(a.totalCapacity).toBe(384);
  });

  it('has no errors (width waste is only an information note)', () => {
    expect(a.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(new Set(a.issues.map((i) => i.code))).toEqual(new Set(['WIDTH_WASTE']));
  });

  it('cut list: 22 pieces a bay, merged across identical bays', () => {
    const by = (code: string) => a.parts.filter((p) => p.code === code);
    expect(by('SIDE')).toMatchObject([{ qty: 6, lengthMm: 2050, widthMm: 360, thicknessMm: 16 }]);
    expect(by('TOP')).toMatchObject([{ qty: 3, lengthMm: 751, widthMm: 350 }]);
    expect(by('BOTTOM')).toMatchObject([{ qty: 3, lengthMm: 751, widthMm: 350 }]);
    expect(by('BACK')).toMatchObject([{ qty: 3, lengthMm: 2018, widthMm: 751, thicknessMm: 6 }]);
    expect(by('PLINTH')).toMatchObject([{ qty: 3, lengthMm: 783, widthMm: 100 }]);
    expect(by('SHADOW_RAIL')).toMatchObject([{ qty: 3, lengthMm: 783, widthMm: 50 }]);
    const shelves = by('SHELF');
    expect(shelves.map((s) => s.qty).sort((x, y) => x - y)).toEqual([6, 39]); // 13 scalloped + 2 display shelves a bay
    expect(shelves.every((s) => s.lengthMm === 751 && s.widthMm === 338)).toBe(true);
    expect(shelves.find((s) => s.qty === 39)?.notes).toContain('CNC_ROUT_SCALLOP_85MM');
    expect(a.totals.pieces).toBe(66);
  });
});
