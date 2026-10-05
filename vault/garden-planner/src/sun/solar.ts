// Where the sun is. Southern hemisphere, Australia only: at solar noon the sun is in the NORTH for every Australian garden except in the far
// north in summer (Darwin, Cairns and anywhere north of the sun's latitude), where it passes to the south. Nothing here assumes a side; it
// is computed from latitude and longitude (negative latitude = south, longitude east-positive).
//
// Algorithm: NOAA's solar position (equation of time + declination from the fractional year), good to a fraction of a degree, which is far
// finer than a garden plan needs. Times are LOCAL STANDARD TIME (no daylight saving): daylight saving moves the clock an hour, not the sun.
import type { AuState } from '../domain/types';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Standard-time offset from UTC by state, in hours (Broken Hill and a few border towns differ; they are close enough for a garden). */
export const TZ_HOURS: Record<AuState, number> = { NSW: 10, VIC: 10, QLD: 10, TAS: 10, ACT: 10, SA: 9.5, NT: 9.5, WA: 8 };

const CUMULATIVE_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
/** Day of the year (1-365) in a non-leap year. */
export const dayOfYear = (month: number, day: number): number => CUMULATIVE_DAYS[month - 1] + day;

/** The date used for a month on the month slider: the 15th, which sits close to the month's average sun path. */
export const MID_MONTH_DAY = 15;

export interface SolarPosition {
  /** Degrees above the horizon (negative: below it). */
  altitude: number;
  /** Compass bearing of the sun, degrees clockwise from true north (0 = N, 90 = E, 180 = S, 270 = W). */
  azimuth: number;
}

export interface Place { lat: number; lng: number; tz: number }

/**
 * Sun position at a place on a given day and local standard time (decimal hours, 13.5 = 1:30 pm).
 */
export function solarPosition(place: Place, month: number, day: number, hour: number): SolarPosition {
  const n = dayOfYear(month, day);
  const g = ((2 * Math.PI) / 365) * (n - 1 + (hour - 12) / 24); // fractional year, radians
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); // minutes
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const trueSolarMinutes = hour * 60 + eqTime + 4 * place.lng - 60 * place.tz;
  const ha = (trueSolarMinutes / 4 - 180) * RAD; // hour angle: 0 at solar noon, negative in the morning
  const lat = place.lat * RAD;
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;
  // azimuth from the SOUTH, positive towards the west (the textbook form), then turned to a compass bearing from north
  const fromSouth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * DEG;
  const azimuth = (((fromSouth + 180) % 360) + 360) % 360;
  return { altitude, azimuth };
}

export interface DaylightTimes { sunrise: number; sunset: number; solarNoon: number; noonAltitude: number }

/** Sunrise, sunset (decimal hours, local standard time) and the noon altitude for a date; found by scanning, so it is robust at any latitude. */
export function daylight(place: Place, month: number, day = MID_MONTH_DAY, minAltitude = 0): DaylightTimes | null {
  let sunrise = NaN, sunset = NaN, noon = 12, best = -90;
  let prev = solarPosition(place, month, day, 0).altitude;
  for (let m = 1; m <= 24 * 60; m++) {
    const a = solarPosition(place, month, day, m / 60).altitude;
    if (a > best) { best = a; noon = m / 60; }
    if (prev < minAltitude && a >= minAltitude && Number.isNaN(sunrise)) sunrise = m / 60;
    if (prev >= minAltitude && a < minAltitude) sunset = m / 60;
    prev = a;
  }
  if (Number.isNaN(sunrise) || Number.isNaN(sunset)) return null; // no sunrise or sunset that day (polar): not an Australian case
  return { sunrise, sunset, solarNoon: noon, noonAltitude: best };
}

/**
 * The direction TOWARD the sun on the plan, as a unit vector (x right, y up the screen). True north points `northDeg` degrees clockwise from
 * the top of the plan, so a sun at compass bearing `a` is at plan bearing `a + northDeg`.
 */
export function sunDirectionOnPlan(azimuth: number, northDeg: number): { x: number; y: number } {
  const b = (azimuth + northDeg) * RAD;
  return { x: Math.sin(b), y: Math.cos(b) };
}

/** "N", "NNE" ... for a compass bearing. */
export function compassPoint(deg: number): string {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function formatHour(h: number): string {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60) % 24, mm = total % 60;
  const ap = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}
