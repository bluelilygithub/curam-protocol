import { describe, expect, it } from 'vitest';
import { LIGHTING } from '@planner-core/render3d/photo';
import { gardenLighting, mix } from '../src/render3d/photoLighting';

const lum = (c: string): number => (parseInt(c.slice(1, 3), 16) * 0.299 + parseInt(c.slice(3, 5), 16) * 0.587 + parseInt(c.slice(5, 7), 16) * 0.114);
const warmth = (c: string): number => parseInt(c.slice(1, 3), 16) - parseInt(c.slice(5, 7), 16); // red minus blue

describe('garden photo lighting', () => {
  it('the sun below the horizon means no daytime picture', () => {
    expect(gardenLighting('daylight', 0).sunUp).toBe(false);
    expect(gardenLighting('daylight', -5).sunUp).toBe(false);
    expect(gardenLighting('daylight', -5).sunIntensity).toBe(0);
    expect(gardenLighting('daylight', 0.5).sunUp).toBe(true);
  });

  it('a high clear-sky sun uses the daylight preset as it is', () => {
    const l = gardenLighting('daylight', 70);
    expect(l.sunIntensity).toBeCloseTo(LIGHTING.daylight.sun, 6);
    expect(l.sunColour).toBe(LIGHTING.daylight.sunColour);
    expect(l.skyTop).toBe(LIGHTING.daylight.skyTop);
    expect(l.skyLight).toBeCloseTo(LIGHTING.daylight.skyLight, 6);
  });

  it('a lower sun is weaker and warmer, in every mood', () => {
    for (const mood of ['daylight', 'overcast', 'evening'] as const) {
      const noon = gardenLighting(mood, 70), mid = gardenLighting(mood, 15), low = gardenLighting(mood, 4);
      expect(noon.sunIntensity).toBeGreaterThan(mid.sunIntensity);
      expect(mid.sunIntensity).toBeGreaterThan(low.sunIntensity);
      if (mood !== 'overcast') expect(warmth(low.sunColour)).toBeGreaterThanOrEqual(warmth(noon.sunColour));
    }
    expect(gardenLighting('daylight', 3).sunIntensity).toBeGreaterThan(0);
  });

  it('a clear sky turns golden as the sun sinks, smoothly, and is untouched above 12 degrees', () => {
    expect(gardenLighting('daylight', 12).skyTop).toBe(LIGHTING.daylight.skyTop);
    expect(gardenLighting('daylight', 40).skyHorizon).toBe(LIGHTING.daylight.skyHorizon);
    const a = gardenLighting('daylight', 9), b = gardenLighting('daylight', 3), c = gardenLighting('daylight', 0.5);
    expect(warmth(a.skyHorizon)).toBeLessThan(warmth(b.skyHorizon));
    expect(warmth(b.skyHorizon)).toBeLessThan(warmth(c.skyHorizon));
    expect(c.skyLight).toBeLessThan(LIGHTING.daylight.skyLight);
  });

  it('overcast is soft: a much weaker sun and a brighter sky than daylight, and its sky does not change with the sun', () => {
    const o = gardenLighting('overcast', 60), d = gardenLighting('daylight', 60);
    expect(o.sunIntensity).toBeLessThan(d.sunIntensity / 4);
    expect(o.skyLight).toBeGreaterThanOrEqual(d.skyLight);
    expect(gardenLighting('overcast', 5).skyTop).toBe(gardenLighting('overcast', 60).skyTop);
    expect(o.sunColour).toBe(LIGHTING.overcast.sunColour);
  });

  it('evening is warm with a dim rosy sky even when the sun is high', () => {
    const e = gardenLighting('evening', 50), d = gardenLighting('daylight', 50);
    expect(warmth(e.skyHorizon)).toBeGreaterThan(warmth(d.skyHorizon));
    expect(e.skyLight).toBeLessThan(d.skyLight);
  });

  it('every colour it returns is a valid six-digit hex colour, at every altitude and mood', () => {
    for (const mood of ['daylight', 'overcast', 'evening'] as const) {
      for (let alt = -10; alt <= 90; alt += 5) {
        const l = gardenLighting(mood, alt);
        for (const c of [l.sunColour, l.skyTop, l.skyHorizon]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
        expect(Number.isFinite(l.sunIntensity) && l.sunIntensity >= 0).toBe(true);
        expect(l.skyLight).toBeGreaterThan(0);
      }
    }
  });

  it('mix blends and clamps', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#ffffff', 2)).toBe('#ffffff');
    expect(lum(mix('#000000', '#ffffff', 0.25))).toBeLessThan(lum(mix('#000000', '#ffffff', 0.75)));
  });
});
