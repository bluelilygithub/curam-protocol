import { describe, expect, it } from 'vitest';
import { TOUR_STEPS } from '../src/help/gardenTour';

describe('guided tour', () => {
  it('has unique step ids, a welcome and a finish, and every target is a gp- hook', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOUR_STEPS[0].target).toBeUndefined();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined();
    for (const s of TOUR_STEPS) if (s.target) expect(s.target).toMatch(/^gp-/);
  });
});
