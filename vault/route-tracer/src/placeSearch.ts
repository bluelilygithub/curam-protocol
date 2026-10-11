import type { GeocodeResult } from './api';
import type { Pos } from './geo';

/**
 * Suggestions as you type in the A and B fields, from MapTiler's geocoding (the same MapTiler key as the map, used straight from the
 * browser). This is the one place a typed place name leaves the browser for a third party without passing through Vault: the header search
 * and Garden Planner still go through Vault's private lookup (server/services/geocode.js), which forbids type-ahead by Nominatim's policy.
 * What keeps the number of requests down: nothing is asked for under 3 letters, the component waits for a pause in typing, an answer for a
 * query already asked recently is remembered, and a newer keystroke cancels the request for an older one.
 */

export const MIN_LETTERS = 3;
const MAX_RESULTS = 5;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 100;

export interface MapTilerFeature {
  place_name?: unknown;
  text?: unknown;
  center?: unknown;
  geometry?: { coordinates?: unknown };
}

/** The request for one query. `near` biases the answers towards where the map is looking, so a suburb name finds the one beside you. */
export function suggestUrl(query: string, key: string, near?: Pos | null): string {
  const params = new URLSearchParams({ key, autocomplete: 'true', limit: String(MAX_RESULTS), language: 'en' });
  if (near && Number.isFinite(near[0]) && Number.isFinite(near[1])) params.set('proximity', `${near[0].toFixed(4)},${near[1].toFixed(4)}`);
  return `https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json?${params}`;
}

const isPos = (c: unknown): c is Pos => Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number'
  && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

/** A long "Hawthorne Park, Hawthorne, Brisbane, Queensland, Australia" is shortened to what fits a field: the first three parts. */
export const shortLabel = (name: string): string => name.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 3).join(', ');

/** MapTiler's answer -> places the app can use. Anything without a name or a usable point is dropped, and so is a repeat of the same label. */
export function parsePlaces(json: unknown): GeocodeResult[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: GeocodeResult[] = [];
  const seen = new Set<string>();
  for (const f of features as MapTilerFeature[]) {
    const name = typeof f?.place_name === 'string' ? f.place_name : typeof f?.text === 'string' ? f.text : '';
    const c = isPos(f?.center) ? f.center : isPos(f?.geometry?.coordinates) ? f.geometry.coordinates : null;
    const label = shortLabel(name);
    if (!label || !c || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ label, lng: c[0], lat: c[1] });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

const cache = new Map<string, { at: number; places: GeocodeResult[] }>();
const keyOf = (query: string, near?: Pos | null): string => `${query.trim().toLowerCase()}|${near ? `${near[0].toFixed(1)},${near[1].toFixed(1)}` : ''}`;

export class SuggestError extends Error {}

/**
 * Places for what has been typed so far. Throws SuggestError on a bad answer (the caller falls back or says so) and lets an abort through
 * unchanged. Fewer than MIN_LETTERS letters is an empty answer with no request.
 */
export async function suggestPlaces(
  query: string, key: string | null, near: Pos | null, signal?: AbortSignal, fetchFn: typeof fetch = (...a) => fetch(...a), now: () => number = Date.now,
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < MIN_LETTERS) return [];
  if (!key) throw new SuggestError('Place suggestions are not available.');
  const ck = keyOf(q, near);
  const hit = cache.get(ck);
  if (hit && now() - hit.at < CACHE_MS) return hit.places;
  let res: Response;
  try { res = await fetchFn(suggestUrl(q, key, near), { signal }); } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new SuggestError('Place suggestions could not be reached.');
  }
  if (!res.ok) throw new SuggestError('Place suggestions are not available right now.');
  let json: unknown;
  try { json = await res.json(); } catch { throw new SuggestError('Place suggestions sent something unreadable.'); }
  const places = parsePlaces(json);
  cache.set(ck, { at: now(), places });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return places;
}

/** For tests: forget what was learned. */
export const clearSuggestCache = (): void => cache.clear();
