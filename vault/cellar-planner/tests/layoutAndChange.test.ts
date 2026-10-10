import { describe, expect, it } from 'vitest';
import { applyRackType, describeRackChange } from '../src/app/catalogue';
import { clampLeft, DEFAULT_LAYOUT, LAYOUT_KEY, LEFT_DEFAULT, LEFT_MAX, LEFT_MIN, loadLayout, saveLayout } from '../src/app/layoutPrefs';
import { sampleProject, testCaseProject } from '../src/app/model';
import { DEFAULT_CONFIG, type RackType } from '../src/lite/config';

const T: RackType = { ...DEFAULT_CONFIG.rackTypes[0]!, id: 'std', name: 'Standard 600', unitDepthMm: 350, rowPitchMm: 100, postsPerUnit: 2, pricePerUnit: 900, confirmed: true };
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

describe('the screen layout is remembered safely', () => {
  it('starts standard, and a saved layout comes back', () => {
    expect(loadLayout(mem())).toEqual(DEFAULT_LAYOUT);
    const s = mem(); saveLayout(s, { leftW: 400, leftHidden: true, rightHidden: false });
    expect(loadLayout(s)).toEqual({ leftW: 400, leftHidden: true, rightHidden: false });
  });
  it('widths are kept inside sensible limits, whatever is stored', () => {
    expect([clampLeft(10), clampLeft(99999), clampLeft(333.4), clampLeft(NaN)]).toEqual([LEFT_MIN, LEFT_MAX, 333, LEFT_DEFAULT]);
    expect(loadLayout(mem({ [LAYOUT_KEY]: JSON.stringify({ leftW: 5, leftHidden: false, rightHidden: false }) })).leftW).toBe(LEFT_MIN);
    const s = mem(); saveLayout(s, { leftW: 9000, leftHidden: false, rightHidden: false });
    expect(JSON.parse(s.m.get(LAYOUT_KEY)!).leftW).toBe(LEFT_MAX);
  });
  it('damaged or odd storage gives the standard layout and never throws', () => {
    for (const bad of ['not json', 'null', '[]', '"x"', '5', JSON.stringify({ leftW: 'wide', leftHidden: 'yes', rightHidden: 1 })]) {
      const l = loadLayout(mem({ [LAYOUT_KEY]: bad }));
      expect(l.leftW, bad).toBeGreaterThanOrEqual(LEFT_MIN); expect(l.leftHidden, bad).toBe(false); expect(l.rightHidden, bad).toBe(false);
    }
    expect(loadLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(() => saveLayout(undefined, DEFAULT_LAYOUT)).not.toThrow();
    expect(() => saveLayout({ setItem() { throw new Error('full'); } }, DEFAULT_LAYOUT)).not.toThrow();
    expect(() => loadLayout({ getItem() { throw new Error('blocked'); } })).not.toThrow();
  });
});

describe('what choosing a rack type changed', () => {
  it('lists each value that moved, from and to', () => {
    const before = { ...testCaseProject(), rackSpec: { ...testCaseProject().rackSpec, unitWidthMm: 650, unitDepthMm: null } };
    const t = describeRackChange(before, applyRackType(before, T));
    expect(t).toContain('unit width 650 → 600'); expect(t).toContain('unit depth not set → 350');
    expect(t).toMatch(/^Applied "Standard 600": /); expect(t).toMatch(/Undo takes it back\.$/);
  });
  it('from blank, every value that was set is listed with "not set" as the start', () => {
    const t = describeRackChange(sampleProject(), applyRackType(sampleProject(), T));
    expect(t).toContain('unit width not set → 600'); expect(t).toContain('bottle orientation not set → neck-out'); expect(t).toContain('posts per unit not set → 2');
  });
  it('says so when nothing changed', () => {
    const p = applyRackType(testCaseProject(), T);
    expect(describeRackChange(p, applyRackType(p, T))).toBe('Applied "Standard 600": the rack values were already the same.');
  });
  it('mentions estimated values for an unconfirmed type', () => {
    const t = describeRackChange(sampleProject(), applyRackType(sampleProject(), { ...T, confirmed: false }));
    expect(t).toMatch(/\d+ values are marked estimated because it is not confirmed by the supplier\./);
  });
  it('never prints NaN, undefined or null', () => {
    expect(describeRackChange(sampleProject(), applyRackType(sampleProject(), T))).not.toMatch(/NaN|undefined|null/);
  });
});
