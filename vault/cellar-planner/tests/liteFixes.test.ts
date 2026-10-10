import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/lite/config';
import { suggestFix } from '../src/lite/fixes';
import { BOTTLES, WALLS, defaultLite, liteResult, type LiteSettings } from '../src/lite/settings';

// A stand-in engine with known rules, so the suggestions can be tested without waiting for the real one to fail (it currently never does).
const fakeEngine = (rule: (s: LiteSettings) => boolean) => (s: LiteSettings) => ({ problems: rule(s) ? [] : ['cannot be built'] });

describe('suggesting a fix for a design that cannot be built', () => {
  it('says nothing for a design that can be built', () => {
    expect(suggestFix(defaultLite(), DEFAULT_CONFIG, 'm')).toBeNull();
  });
  it('a ceiling that is too low: raises it to the smallest height that works, and says so in the visitor\'s unit', () => {
    const ev = fakeEngine((s) => s.heightMm >= 2120);
    const s = { ...defaultLite(), heightMm: 2000 };
    const fix = suggestFix(s, DEFAULT_CONFIG, 'm', ev)!;
    expect(fix.settings.heightMm).toBe(2150); // 50 mm steps: the first one that works
    expect(fix.text).toBe('Make the ceiling 2.15 m high');
    expect(suggestFix(s, DEFAULT_CONFIG, 'mm', ev)!.text).toBe('Make the ceiling 2150 mm high');
    expect(suggestFix(s, DEFAULT_CONFIG, 'ft', ev)!.text).toBe('Make the ceiling 7 ft 1 in high');
  });
  it('changes only the one thing', () => {
    const ev = fakeEngine((s) => s.heightMm >= 2120);
    const s = { ...defaultLite(), heightMm: 2050, widthMm: 3333, bottle: 'BURGUNDY' as const };
    const fix = suggestFix(s, DEFAULT_CONFIG, 'm', ev)!;
    expect({ ...fix.settings, heightMm: s.heightMm }).toEqual(s);
  });
  it('tries a taller ceiling, then wider, then deeper, then a single door, then a smaller bottle', () => {
    expect(suggestFix(defaultLite(), DEFAULT_CONFIG, 'm', fakeEngine((s) => s.widthMm >= 3000))!.text).toBe('Make the room 3.05 m wide');
    expect(suggestFix(defaultLite(), DEFAULT_CONFIG, 'm', fakeEngine((s) => s.depthMm >= 1800))!.text).toMatch(/^Make the room 1.8[67] m deep$/);
    expect(suggestFix({ ...defaultLite(), doorStyle: 'DOUBLE' }, DEFAULT_CONFIG, 'm', fakeEngine((s) => s.doorStyle === 'SINGLE'))!.text).toBe('Use a single door');
    const m = suggestFix({ ...defaultLite(), bottle: 'MAGNUM' }, DEFAULT_CONFIG, 'm', fakeEngine((s) => s.bottle !== 'MAGNUM'))!;
    expect(m.settings.bottle).toBe('CHAMPAGNE');
    expect(m.text).toMatch(/^Choose Champagne/);
  });
  it('gives nothing when no single change helps', () => {
    expect(suggestFix(defaultLite(), DEFAULT_CONFIG, 'm', fakeEngine(() => false))).toBeNull();
  });
  it('never goes past the allowed sizes', () => {
    const fix = suggestFix(defaultLite(), DEFAULT_CONFIG, 'm', fakeEngine((s) => s.widthMm > 9000));
    expect(fix).toBeNull();
  });
});

describe('the real engine', () => {
  it('has no design the visitor can reach that cannot be built (a low ceiling gets a lower door), or else every one has a working fix', () => {
    let tried = 0, bad = 0;
    for (const heightMm of [1800, 1900, 2000, 2119, 2120, 2400, 3200]) for (const widthMm of [1000, 1500, 2750, 8000]) for (const depthMm of [1000, 2000, 8000]) {
      for (const bottle of BOTTLES) for (const doorStyle of ['SINGLE', 'DOUBLE'] as const) for (const doorWall of WALLS) {
        const s = { ...defaultLite(), heightMm, widthMm, depthMm, bottle, doorStyle, doorWall };
        tried++;
        if (liteResult(s).problems.length === 0) { expect(suggestFix(s, DEFAULT_CONFIG, 'm')).toBeNull(); continue; }
        bad++;
        const fix = suggestFix(s, DEFAULT_CONFIG, 'm');
        expect(fix, JSON.stringify(s)).not.toBeNull();
        expect(liteResult(fix!.settings).problems).toEqual([]);
      }
    }
    expect(tried).toBeGreaterThan(1000);
    expect(bad).toBe(0);
  });
  it('a 1.8 m ceiling builds, with a door that fits under it', () => {
    const r = liteResult({ ...defaultLite(), heightMm: 1800 });
    expect(r.problems).toEqual([]);
    expect(r.bottles).toBeGreaterThan(0);
  });
});
