// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { findStart, loopChoices, readLastStart, saveLastStart } from '../src/suggest';

const geoOk = (lng: number, lat: number) => ({ getCurrentPosition: (ok: PositionCallback) => ok({ coords: { longitude: lng, latitude: lat } } as GeolocationPosition) });
const geoNo = { getCurrentPosition: (_ok: PositionCallback, bad?: PositionErrorCallback | null) => bad?.({ code: 1 } as GeolocationPositionError) };

beforeEach(() => localStorage.clear());

describe('loop choices', () => {
  it('are 5, 10 and 15 km', () => { expect(loopChoices('km')).toEqual([{ label: '5 km', km: 5 }, { label: '10 km', km: 10 }, { label: '15 km', km: 15 }]); });
  it('are round miles when working in miles, with the length in km behind them', () => {
    const c = loopChoices('mi');
    expect(c.map((x) => x.label)).toEqual(['3 mi', '6 mi', '9 mi']);
    expect(c[0].km).toBeCloseTo(4.8, 1);
    expect(c.every((x) => x.km >= 1 && x.km <= 50)).toBe(true);
  });
});

describe('where to start', () => {
  it('uses the device position, and remembers it', async () => {
    expect(await findStart(geoOk(153.03, -27.47))).toEqual({ pos: [153.03, -27.47], source: 'here' });
    expect(readLastStart()).toEqual([153.03, -27.47]);
  });
  it('falls back to the remembered start when location is refused', async () => {
    saveLastStart([153.1, -27.5]);
    expect(await findStart(geoNo)).toEqual({ pos: [153.1, -27.5], source: 'remembered' });
  });
  it('falls back to the remembered start when the device cannot say at all', async () => {
    saveLastStart([153.1, -27.5]);
    expect(await findStart(undefined)).toEqual({ pos: [153.1, -27.5], source: 'remembered' });
  });
  it('is null when there is neither', async () => { expect(await findStart(geoNo)).toBeNull(); });
  it('ignores a damaged or off-the-map remembered value', () => {
    localStorage.setItem('route-tracer:last-start', '[999,0]');
    expect(readLastStart()).toBeNull();
    localStorage.setItem('route-tracer:last-start', 'not json');
    expect(readLastStart()).toBeNull();
    localStorage.clear();
    saveLastStart([500, 500]);
    expect(readLastStart()).toBeNull();
  });
});
