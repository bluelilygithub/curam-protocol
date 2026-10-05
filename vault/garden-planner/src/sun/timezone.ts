// Time zones for the Time slider. The slider shows what a clock on the wall says, so it must follow the garden's real zone, including
// daylight saving: NSW, Vic, SA, Tas and the ACT put clocks forward from the first Sunday in October to the first Sunday in April;
// Queensland, WA and the NT never do. The sun does not care about clocks; this only decides which clock time a sun position is shown at.
import type { AuState, Location } from '../domain/types';
import type { Place } from './solar';

/** IANA zone for a garden location: the state's main zone, with Broken Hill (NSW's far west, on South Australian time) as the one exception. */
export function timeZoneFor(l: Pick<Location, 'state' | 'lng'>): string {
  switch (l.state) {
    case 'NSW': return l.lng < 142.5 ? 'Australia/Broken_Hill' : 'Australia/Sydney';
    case 'ACT': return 'Australia/Sydney';
    case 'VIC': return 'Australia/Melbourne';
    case 'QLD': return 'Australia/Brisbane';
    case 'SA': return 'Australia/Adelaide';
    case 'WA': return 'Australia/Perth';
    case 'TAS': return 'Australia/Hobart';
    case 'NT': return 'Australia/Darwin';
  }
}

/** Standard-time offsets (hours from UTC) per state: only a fallback if the browser cannot supply zone data. */
export const STANDARD_OFFSET: Record<AuState, number> = { NSW: 10, VIC: 10, QLD: 10, TAS: 10, ACT: 10, SA: 9.5, NT: 9.5, WA: 8 };

/** The year the month slider's sample days are taken in (the 15th: never a clock-change day, which fall in the first week of April and October). */
export const REFERENCE_YEAR = 2026;

/** Hours from UTC that `zone` is on at 02:00 UTC on the 15th of `month` (decimal, 10.5 = UTC+10:30), or null if the zone is unknown here. */
export function offsetHours(zone: string, month: number, year = REFERENCE_YEAR): number | null {
  try {
    const instant = new Date(Date.UTC(year, month - 1, 15, 2, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(instant);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /^GMT(?:([+−-])(\d{1,2})(?::(\d{2}))?)?$/.exec(name);
    if (!m) return null;
    if (!m[1]) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0));
  } catch {
    return null;
  }
}

export interface ZoneInfo {
  /** IANA name, e.g. "Australia/Sydney". */
  zone: string;
  /** Hours from UTC for the chosen month. */
  offset: number;
  /** True when the clock is on daylight saving in that month. */
  dst: boolean;
  /** "UTC+11" / "UTC+9:30". */
  offsetLabel: string;
  /** One line for the interface: "Australia/Sydney · daylight saving on (UTC+11)". */
  text: string;
}

const offsetLabel = (o: number): string => {
  const sign = o < 0 ? '-' : '+';
  const a = Math.abs(o);
  const h = Math.floor(a), m = Math.round((a - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
};

/** The place the sun position is computed for in a given month: latitude, longitude and the zone's offset that month (daylight saving included). */
export const placeFor = (l: Pick<Location, 'lat' | 'lng' | 'state'>, month: number): Place => ({ lat: l.lat, lng: l.lng, tz: zoneInfo(l, month).offset });

/** The garden's clock for a month: zone, offset, and whether daylight saving is in effect. */
export function zoneInfo(l: Pick<Location, 'state' | 'lng'>, month: number): ZoneInfo {
  const zone = timeZoneFor(l);
  const standardFallback = STANDARD_OFFSET[l.state];
  const now = offsetHours(zone, month);
  const jan = offsetHours(zone, 1), jul = offsetHours(zone, 7);
  const offset = now ?? standardFallback;
  const standard = jan !== null && jul !== null ? Math.min(jan, jul) : standardFallback;
  const dst = offset > standard + 1e-9;
  const label = offsetLabel(offset);
  return { zone, offset, dst, offsetLabel: label, text: `${zone} · ${dst ? 'daylight saving on' : 'standard time'} (${label})` };
}
