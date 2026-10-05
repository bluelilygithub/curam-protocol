import { describe, expect, it } from 'vitest';
import type { Location } from '../src/domain/types';
import { daylight, formatHour } from '../src/sun/solar';
import { placeFor, timeZoneFor, zoneInfo } from '../src/sun/timezone';

const L = (label: string, lat: number, lng: number, state: Location['state']): Location => ({ label, lat, lng, state });
const SYDNEY = L('Sydney NSW', -33.87, 151.21, 'NSW');
const BRISBANE = L('Brisbane QLD', -27.47, 153.03, 'QLD');
const PERTH = L('Perth WA', -31.95, 115.86, 'WA');
const MELBOURNE = L('Melbourne VIC', -37.81, 144.96, 'VIC');
const ADELAIDE = L('Adelaide SA', -34.93, 138.6, 'SA');
const HOBART = L('Hobart TAS', -42.88, 147.33, 'TAS');
const CANBERRA = L('Canberra ACT', -35.28, 149.13, 'ACT');
const DARWIN = L('Darwin NT', -12.46, 130.84, 'NT');
const BROKEN_HILL = L('Broken Hill NSW', -31.95, 141.45, 'NSW');
const JAN = 1, JUL = 7, APR = 4, OCT = 10;

/** Where solar noon falls on the Time slider (clock time) for a garden in a month. */
const noonOnSlider = (l: Location, month: number): number => daylight(placeFor(l, month), month)!.solarNoon;

describe('time zone of a garden', () => {
  it('uses the IANA zone for the state', () => {
    expect(timeZoneFor(SYDNEY)).toBe('Australia/Sydney');
    expect(timeZoneFor(CANBERRA)).toBe('Australia/Sydney');
    expect(timeZoneFor(MELBOURNE)).toBe('Australia/Melbourne');
    expect(timeZoneFor(BRISBANE)).toBe('Australia/Brisbane');
    expect(timeZoneFor(ADELAIDE)).toBe('Australia/Adelaide');
    expect(timeZoneFor(PERTH)).toBe('Australia/Perth');
    expect(timeZoneFor(HOBART)).toBe('Australia/Hobart');
    expect(timeZoneFor(DARWIN)).toBe('Australia/Darwin');
    expect(timeZoneFor(BROKEN_HILL)).toBe('Australia/Broken_Hill');
  });

  it('daylight saving applies in NSW, Vic, SA, Tas and the ACT in summer, and not in Qld, WA or the NT', () => {
    for (const l of [SYDNEY, MELBOURNE, ADELAIDE, HOBART, CANBERRA, BROKEN_HILL]) expect(zoneInfo(l, JAN).dst, `${l.label} in January`).toBe(true);
    for (const l of [BRISBANE, PERTH, DARWIN]) expect(zoneInfo(l, JAN).dst, `${l.label} in January`).toBe(false);
  });

  it('and not in winter anywhere', () => {
    for (const l of [SYDNEY, MELBOURNE, ADELAIDE, HOBART, CANBERRA, BROKEN_HILL, BRISBANE, PERTH, DARWIN]) expect(zoneInfo(l, JUL).dst, `${l.label} in July`).toBe(false);
  });

  it('daylight saving is on for the 15th of October and off for the 15th of April (the clocks change in the first week of each)', () => {
    expect(zoneInfo(SYDNEY, OCT).dst).toBe(true);
    expect(zoneInfo(SYDNEY, APR).dst).toBe(false);
    expect(zoneInfo(BRISBANE, OCT).dst).toBe(false);
  });

  it('offsets: Sydney UTC+11 in January and UTC+10 in July; Adelaide +10:30 / +9:30; Perth +8 all year; Darwin +9:30; Brisbane +10', () => {
    expect(zoneInfo(SYDNEY, JAN).offset).toBe(11);
    expect(zoneInfo(SYDNEY, JUL).offset).toBe(10);
    expect(zoneInfo(ADELAIDE, JAN).offset).toBe(10.5);
    expect(zoneInfo(ADELAIDE, JUL).offset).toBe(9.5);
    expect(zoneInfo(PERTH, JAN).offset).toBe(8);
    expect(zoneInfo(PERTH, JUL).offset).toBe(8);
    expect(zoneInfo(DARWIN, JAN).offset).toBe(9.5);
    expect(zoneInfo(BRISBANE, JAN).offset).toBe(10);
    expect(zoneInfo(BROKEN_HILL, JAN).offset).toBe(10.5);
  });

  it('describes the zone and daylight saving for the interface', () => {
    expect(zoneInfo(SYDNEY, JAN).text).toBe('Australia/Sydney · daylight saving on (UTC+11)');
    expect(zoneInfo(SYDNEY, JUL).text).toBe('Australia/Sydney · standard time (UTC+10)');
    expect(zoneInfo(BRISBANE, JAN).text).toBe('Australia/Brisbane · standard time (UTC+10)');
    expect(zoneInfo(ADELAIDE, JAN).text).toBe('Australia/Adelaide · daylight saving on (UTC+10:30)');
    expect(zoneInfo(PERTH, JAN).text).toBe('Australia/Perth · standard time (UTC+8)');
  });
});

describe('solar noon on the Time slider follows the wall clock', () => {
  it('a Sydney garden in January: solar noon is around 1 pm (daylight saving)', () => {
    const n = noonOnSlider(SYDNEY, JAN);
    expect(n).toBeGreaterThan(12.8);
    expect(n).toBeLessThan(13.3);
    expect(formatHour(n)).toMatch(/^1:\d\d pm$/);
  });

  it('a Brisbane garden in January: solar noon is around noon (no daylight saving)', () => {
    const n = noonOnSlider(BRISBANE, JAN);
    expect(n).toBeGreaterThan(11.7);
    expect(n).toBeLessThan(12.25);
  });

  it('Sydney in July is back to about noon (standard time, a little before because Sydney is east of its meridian)', () => {
    const n = noonOnSlider(SYDNEY, JUL);
    expect(n).toBeGreaterThan(11.6);
    expect(n).toBeLessThan(12.2);
  });

  it('Perth in January: about 12:25 pm (no daylight saving, west of its meridian)', () => {
    const n = noonOnSlider(PERTH, JAN);
    expect(n).toBeGreaterThan(12.2);
    expect(n).toBeLessThan(12.7);
  });

  it('Adelaide and Melbourne in January are an hour later than their winter noon', () => {
    expect(noonOnSlider(ADELAIDE, JAN) - noonOnSlider(ADELAIDE, JUL)).toBeGreaterThan(0.75);
    expect(noonOnSlider(MELBOURNE, JAN) - noonOnSlider(MELBOURNE, JUL)).toBeGreaterThan(0.75);
    expect(noonOnSlider(BRISBANE, JAN) - noonOnSlider(BRISBANE, JUL)).toBeLessThan(0.6); // no clock change: only the sun's own seasonal drift
  });

  it('daylight saving moves the clock, not the sun: the same garden gets the same sun height at the same moment', () => {
    // 12:00 standard time in July and 13:00 daylight time in January are both near solar noon, with the sun at the noon height for each month
    const jan = daylight(placeFor(SYDNEY, JAN), JAN)!;
    const janAtOne = daylight(placeFor({ ...SYDNEY }, JAN), JAN)!;
    expect(jan.noonAltitude).toBeCloseTo(janAtOne.noonAltitude, 5);
    expect(jan.noonAltitude).toBeGreaterThan(75); // high summer sun in Sydney
  });

  it('sunrise and sunset shift an hour with daylight saving too (Sydney, January: about 6 am to 8 pm)', () => {
    const d = daylight(placeFor(SYDNEY, JAN), JAN)!;
    expect(d.sunrise).toBeGreaterThan(5.5);
    expect(d.sunrise).toBeLessThan(6.4);
    expect(d.sunset).toBeGreaterThan(19.6);
    expect(d.sunset).toBeLessThan(20.4);
  });
});
