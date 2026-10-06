import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('every step that points at something points at a hook that exists in the interface (the tour cannot drift away from the screen)', () => {
    const dir = join(__dirname, '../src/ui');
    const source = readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    for (const s of TOUR_STEPS) if (s.target) expect(source, s.id).toContain(`data-tour="${s.target}"`);
  });

  it('covers the main parts of the app, in a sensible order (draw, plants, sun, checks, schedule, 3D)', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    for (const id of ['gp-tools', 'gp-library', 'gp-growth', 'gp-checks', 'gp-schedule', 'gp-3dbar']) expect(ids).toContain(id);
    expect(ids.indexOf('gp-tools')).toBeLessThan(ids.indexOf('gp-library'));
    expect(ids.indexOf('gp-growth')).toBeLessThan(ids.indexOf('gp-checks'));
    expect(ids.indexOf('gp-view')).toBeLessThan(ids.indexOf('gp-3dbar'));
    expect(TOUR_STEPS.find((s) => s.id === 'gp-3dbar')?.needs3d).toBe(true);
    expect(TOUR_STEPS.length).toBe(12);
  });

  it('the tour talks about the address, now that the garden starts from one', () => {
    const all = TOUR_STEPS.map((s) => s.text).join(' ');
    expect(all).toMatch(/street address/);
    expect(TOUR_STEPS.find((s) => s.id === 'gp-library')?.text).toMatch(/address/);
    expect(TOUR_STEPS.find((s) => s.id === 'gp-inspector')?.text).toMatch(/address/);
  });

  it('every step has a title and some text', () => {
    for (const s of TOUR_STEPS) { expect(s.title.length).toBeGreaterThan(3); expect(s.text.length).toBeGreaterThan(30); }
  });
});
