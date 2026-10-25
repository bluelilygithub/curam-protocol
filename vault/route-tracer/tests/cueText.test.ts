import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/api';
import { cuesToText, textFileName } from '../src/cueText';

const cue = (text: string, distanceM: number): Cue => ({ text, distanceM, durationS: 60, type: 0, pos: [153, -27] });
const cues = [cue('Head north on Smith Street', 400), cue('Turn left onto Park Road', 1200), cue('Arrive at your destination', 0)];

describe('directions as text', () => {
  it('is a title, the total, then numbered lines with the leg distance; arriving has none', () => {
    const t = cuesToText({ title: 'Morning loop', cues, units: 'km' }).split('\n');
    expect(t[0]).toBe('Morning loop');
    expect(t[1]).toBe('1.60 km, 3 steps');
    expect(t[2]).toBe('');
    expect(t[3]).toBe('1. Head north on Smith Street (400 m)');
    expect(t[4]).toBe('2. Turn left onto Park Road (1.20 km)');
    expect(t[5]).toBe('3. Arrive at your destination');
    expect(t.at(-1)).toMatch(/openrouteservice.*OpenStreetMap.*guide only/);
  });
  it('speaks miles when asked', () => { expect(cuesToText({ title: 'x', cues, units: 'mi' })).toMatch(/0\.99 mi, 3 steps/); });
  it('copes with one step, a blank title and awkward spacing', () => {
    const t = cuesToText({ title: '   ', cues: [cue('Go', 10)], units: 'km' });
    expect(t.split('\n')[0]).toBe('Route');
    expect(t).toContain('1 step');
  });
  it('makes a safe file name', () => {
    expect(textFileName('Sunday: loop/5k?')).toBe('Sunday_ loop_5k_ - directions.txt');
    expect(textFileName('')).toBe('route - directions.txt');
    expect(textFileName('x'.repeat(200)).length).toBeLessThan(110);
  });
});
