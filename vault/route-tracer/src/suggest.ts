import type { Pos, Units } from './geo';

/**
 * "Suggested loops": three ready-made loop lengths offered on the home screen, started from where the person is now (the browser's location,
 * asked for only when they press one) or, failing that, the last start they used. Pressing one sets up Plan route as a loop of that length, so
 * everything after it is the ordinary loop planner. Nothing here calls the server.
 */

export const SUGGESTED_KM = [5, 10, 15] as const;
const KM_PER_MI = 1.609344;
const LAST_KEY = 'route-tracer:last-start';

export interface LoopChoice { label: string; km: number }

/** 5, 10 and 15 km, or the round miles nearest to them (3, 6 and 9 mi) when the person works in miles. */
export function loopChoices(units: Units): LoopChoice[] {
  if (units === 'mi') return [3, 6, 9].map((mi) => ({ label: `${mi} mi`, km: Math.round(mi * KM_PER_MI * 10) / 10 }));
  return SUGGESTED_KM.map((km) => ({ label: `${km} km`, km }));
}

const valid = (p: unknown): p is Pos => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** The last place a loop or route was started from on this device, or null. */
export function readLastStart(): Pos | null {
  try { const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as unknown; return valid(v) ? [v[0], v[1]] : null; } catch { return null; }
}

export function saveLastStart(p: Pos): void {
  if (!valid(p)) return;
  try { localStorage.setItem(LAST_KEY, JSON.stringify([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])); } catch { /* private window: just not remembered */ }
}

export type StartSource = 'here' | 'remembered';

/** Where to start: the device's position if it will say (a few seconds at most), else the remembered start, else null. */
export async function findStart(geo: Pick<Geolocation, 'getCurrentPosition'> | undefined = typeof navigator !== 'undefined' ? navigator.geolocation : undefined): Promise<{ pos: Pos; source: StartSource } | null> {
  if (geo) {
    const here = await new Promise<Pos | null>((resolve) => {
      geo.getCurrentPosition((p) => resolve([p.coords.longitude, p.coords.latitude]), () => resolve(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
    });
    if (here && valid(here)) { saveLastStart(here); return { pos: here, source: 'here' }; }
  }
  const last = readLastStart();
  return last ? { pos: last, source: 'remembered' } : null;
}
