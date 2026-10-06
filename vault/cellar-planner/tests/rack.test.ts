import { describe, expect, it } from 'vitest';
import { blankRackSpec, checkRackSpec, effectiveBottlesPerRow, missingFields, rackCapacity, rackDepthNeededMm, type RackSpec } from '../src/rack';

// The numbers below are INVENTED to exercise the maths. They are not a supplier's values: no supplier sheet exists yet.
const filled = (over: Partial<RackSpec> = {}): RackSpec => ({ unitWidthMm: 900, unitDepthMm: 350, unitHeightMm: 2000, rowPitchMm: 100, bottlesPerRow: 8, orientation: 'NECK_OUT', postsPerUnit: 2, rowsPerUnit: null, ...over });

describe('a blank rack spec', () => {
  it('is "not set", never zero, and names what is missing', () => {
    const c = rackCapacity(blankRackSpec(), 4);
    expect(c.status).toBe('NOT_SET');
    expect(c).toMatchObject({ missing: expect.arrayContaining(['unit width', 'unit depth', 'unit height', 'row pitch', 'bottles per row', 'bottle orientation', 'posts per unit']) });
    expect('capacity' in c).toBe(false);
  });
  it('raises one RACK_SPEC_MISSING error that says why and what to do', () => {
    const issues = checkRackSpec(blankRackSpec(), 'BORDEAUX');
    const m = issues.find((i) => i.code === 'RACK_SPEC_MISSING');
    expect(m?.severity).toBe('error');
    expect(m?.message).toMatch(/capacity is not set/);
    expect(m?.fix).toMatch(/cannot be counted or quoted/);
    expect(issues.filter((i) => i.code === 'RACK_SPEC_MISSING')).toHaveLength(1);
  });
  it('one missing field is enough to stay "not set"', () => {
    for (const k of ['unitWidthMm', 'unitDepthMm', 'bottlesPerRow', 'orientation', 'postsPerUnit'] as const) {
      expect(rackCapacity({ ...filled(), [k]: null }, 3).status).toBe('NOT_SET');
    }
  });
});

describe('capacity once the values are entered', () => {
  it('rows x bottles per row x units; rows from height / pitch', () => {
    const c = rackCapacity(filled(), 3);
    expect(c).toEqual({ status: 'OK', rowsPerUnit: 20, bottlesPerRow: 8, bottlesPerRowSource: 'typed', units: 3, capacity: 20 * 8 * 3 });
  });
  it('a stated number of rows is used as given, and then height and pitch are not required', () => {
    const s = filled({ rowsPerUnit: 15, unitHeightMm: null, rowPitchMm: null });
    expect(missingFields(s)).toEqual([]);
    expect(rackCapacity(s, 2)).toMatchObject({ status: 'OK', rowsPerUnit: 15, capacity: 15 * 8 * 2 });
  });
  it('zero units is zero bottles, which is a real answer once the spec is complete', () => {
    expect(rackCapacity(filled(), 0)).toMatchObject({ status: 'OK', capacity: 0 });
  });
});

describe('depth and value checks', () => {
  it('neck-out needs the bottle length plus 15 mm; label-forward needs the inclined footprint', () => {
    expect(rackDepthNeededMm('NECK_OUT', 'BORDEAUX')).toBe(315);
    expect(rackDepthNeededMm('LABEL_FORWARD', 'BORDEAUX')).toBeCloseTo(329.5, 0);
  });
  it('a unit too shallow for its bottles is an error with the depth to use', () => {
    const d = checkRackSpec(filled({ unitDepthMm: 300 }), 'BORDEAUX').find((i) => i.code === 'RACK_DEPTH_TOO_SHALLOW');
    expect(d?.fix).toMatch(/at least 315 mm/);
    expect(checkRackSpec(filled({ unitDepthMm: 350 }), 'BORDEAUX').map((i) => i.code)).not.toContain('RACK_DEPTH_TOO_SHALLOW');
  });
  it('the same depth can pass neck-out and fail label-forward', () => {
    expect(checkRackSpec(filled({ unitDepthMm: 320 }), 'BORDEAUX').map((i) => i.code)).not.toContain('RACK_DEPTH_TOO_SHALLOW');
    expect(checkRackSpec(filled({ unitDepthMm: 320, orientation: 'LABEL_FORWARD' }), 'BORDEAUX').map((i) => i.code)).toContain('RACK_DEPTH_TOO_SHALLOW');
  });
  it('the depth check works on a partly filled spec; only the missing-fields error is raised for the rest', () => {
    const s = { ...blankRackSpec(), unitDepthMm: 300, orientation: 'NECK_OUT' as const };
    const codes = checkRackSpec(s, 'BORDEAUX').map((i) => i.code);
    expect(codes).toContain('RACK_DEPTH_TOO_SHALLOW');
    expect(codes).toContain('RACK_SPEC_MISSING');
  });
  it('a row pitch smaller than the bottle, and zero or negative values, are errors', () => {
    expect(checkRackSpec(filled({ rowPitchMm: 60 }), 'BORDEAUX').map((i) => i.code)).toContain('RACK_PITCH_TOO_SMALL');
    expect(checkRackSpec(filled({ bottlesPerRow: 0 }), 'BORDEAUX').map((i) => i.code)).toContain('RACK_VALUE_INVALID');
    expect(checkRackSpec(filled({ unitWidthMm: -5 }), 'BORDEAUX').map((i) => i.code)).toContain('RACK_VALUE_INVALID');
  });
  it('a complete, sensible spec has no issues', () => {
    expect(checkRackSpec(filled(), 'BORDEAUX')).toEqual([]);
  });
});

describe('bottles per row: calculated unless typed, and never carried over to label-forward', () => {
  const width600 = (over: Partial<RackSpec> = {}): RackSpec => filled({ unitWidthMm: 600, bottlesPerRow: null, ...over });

  it('left blank it is the unit width divided by the bottle pitch, rounded down: Bordeaux 7, Burgundy 6, Champagne 5, Magnum 4 (600 mm)', () => {
    expect(effectiveBottlesPerRow(width600(), 'BORDEAUX')).toEqual({ value: 7, source: 'calculated' });
    expect(effectiveBottlesPerRow(width600(), 'BURGUNDY')).toEqual({ value: 6, source: 'calculated' });
    expect(effectiveBottlesPerRow(width600(), 'CHAMPAGNE')).toEqual({ value: 5, source: 'calculated' });
    expect(effectiveBottlesPerRow(width600(), 'MAGNUM')).toEqual({ value: 4, source: 'calculated' });
  });
  it('a typed number is the fabricator\'s and wins, and is labelled typed', () => {
    expect(effectiveBottlesPerRow(width600({ bottlesPerRow: 5 }), 'BORDEAUX')).toEqual({ value: 5, source: 'typed' });
    expect(rackCapacity(width600({ bottlesPerRow: 5 }), 2, 'BORDEAUX')).toMatchObject({ status: 'OK', bottlesPerRow: 5, bottlesPerRowSource: 'typed', capacity: 20 * 5 * 2 });
  });
  it('the capacity follows the bottle when it is calculated', () => {
    expect(rackCapacity(width600(), 1, 'BORDEAUX')).toMatchObject({ capacity: 20 * 7, bottlesPerRowSource: 'calculated' });
    expect(rackCapacity(width600(), 1, 'CHAMPAGNE')).toMatchObject({ capacity: 20 * 5 });
  });
  it('with no unit width, no orientation or no bottle there is nothing to calculate from: it stays "not set"', () => {
    expect(effectiveBottlesPerRow(width600({ unitWidthMm: null }), 'BORDEAUX')).toBeNull();
    expect(effectiveBottlesPerRow(width600({ orientation: null }), 'BORDEAUX')).toBeNull();
    expect(effectiveBottlesPerRow(width600())).toBeNull();
    expect(rackCapacity(width600(), 1).status).toBe('NOT_SET');
    expect(effectiveBottlesPerRow(width600({ unitWidthMm: 50 }), 'BORDEAUX')).toBeNull(); // not even one bottle wide
  });
  it('label-forward does NOT inherit the neck-out count: it needs its own number, and is "not set" until given', () => {
    const lf = width600({ bottlesPerRow: 7, orientation: 'LABEL_FORWARD' });
    expect(effectiveBottlesPerRow(lf, 'BORDEAUX')).toBeNull();
    const c = rackCapacity(lf, 4, 'BORDEAUX');
    expect(c).toEqual({ status: 'NOT_SET', missing: ['bottles per row (label-forward)'] });
    const issue = checkRackSpec(lf, 'BORDEAUX').find((i) => i.code === 'RACK_SPEC_MISSING');
    expect(issue?.message).toMatch(/bottles per row \(label-forward\)/);
  });
  it('and once the label-forward figure is typed it is used, whatever the neck-out figure says', () => {
    const lf = width600({ bottlesPerRow: 7, bottlesPerRowLabelForward: 2, orientation: 'LABEL_FORWARD' });
    expect(effectiveBottlesPerRow(lf, 'BORDEAUX')).toEqual({ value: 2, source: 'typed' });
    expect(rackCapacity(lf, 1, 'BORDEAUX')).toMatchObject({ status: 'OK', bottlesPerRow: 2, capacity: 20 * 2 });
  });
  it('a typed number that cannot fit across the unit is an error with the most that fit (9 Bordeaux need 684 mm; 600 holds 7)', () => {
    const issue = checkRackSpec(width600({ bottlesPerRow: 9 }), 'BORDEAUX').find((i) => i.code === 'RACK_ROW_TOO_WIDE');
    expect(issue?.message).toMatch(/684 mm/);
    expect(issue?.fix).toMatch(/at most 7/);
    expect(checkRackSpec(width600({ bottlesPerRow: 7 }), 'BORDEAUX').map((i) => i.code)).not.toContain('RACK_ROW_TOO_WIDE');
    expect(checkRackSpec(width600(), 'BORDEAUX').map((i) => i.code)).not.toContain('RACK_ROW_TOO_WIDE'); // calculated values always fit
  });
});
