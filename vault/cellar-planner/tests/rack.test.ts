import { describe, expect, it } from 'vitest';
import { blankRackSpec, checkRackSpec, missingFields, rackCapacity, rackDepthNeededMm, type RackSpec } from '../src/rack';

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
    expect(c).toEqual({ status: 'OK', rowsPerUnit: 20, bottlesPerRow: 8, units: 3, capacity: 20 * 8 * 3 });
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
