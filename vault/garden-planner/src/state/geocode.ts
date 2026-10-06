// Place lookup. Goes through Vault's own `/api/geocode` (never straight to OpenStreetMap): the server keeps to Nominatim's usage policy for
// everyone together (1 request a second, identifying User-Agent, cached results). This side makes one request per deliberate button press,
// never while typing (no type-ahead), and never for text that is too short to be a place.
import { readVaultToken, type ReadableStorage } from '@planner-core/library/library';
import type { AuState, LocationPrecision } from '../domain/types';

export interface PlaceHit { label: string; lat: number; lng: number; state: AuState | null; postcode: string | null; precision: LocationPrecision; address: string | null }
/** What each precision means, in words for the person. */
export const PRECISION_TEXT: Record<LocationPrecision, string> = { address: 'Exact address', street: 'Street only: the house number was not found', place: 'A suburb or place, not an address' };
export interface PlaceAnswer { results: PlaceHit[]; attribution: string; cached: boolean }

/** The text OpenStreetMap asks to be shown next to results that come from its data (ODbL). */
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const MIN_QUERY = 3;

export class PlaceLookupError extends Error {}

type FetchJson = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function createPlaceLookup(storage: ReadableStorage, fetchFn: FetchJson | undefined = typeof fetch === 'function' ? (fetch as unknown as FetchJson) : undefined, base = '/api/geocode') {
  const session = new Map<string, PlaceAnswer>(); // the same search twice in one visit does not go to the server twice
  return {
    /** Look a suburb, town or postcode up. Throws `PlaceLookupError` with a plain message when it cannot. */
    async search(raw: string): Promise<PlaceAnswer> {
      const q = raw.trim().replace(/\s+/g, ' ');
      if (q.length < MIN_QUERY) throw new PlaceLookupError(`Type an address, or at least ${MIN_QUERY} letters of a suburb or postcode, then press the button.`);
      const key = q.toLowerCase();
      const have = session.get(key);
      if (have) return have;
      const token = readVaultToken(storage);
      if (!token || !fetchFn) throw new PlaceLookupError('Place lookup needs you to be signed in to Vault. Pick a place from the list, or type the state, latitude and longitude yourself.');
      let res: Awaited<ReturnType<FetchJson>>;
      // POST with the text in the body, never in the URL (URLs reach proxy logs and error traces)
      try { res = await fetchFn(base, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) }); } catch {
        throw new PlaceLookupError('Could not reach Vault to look that up. Pick a place from the list, or type the latitude and longitude yourself.');
      }
      const body = (await res.json().catch(() => ({}))) as Partial<PlaceAnswer> & { error?: string };
      if (!res.ok) throw new PlaceLookupError(body.error ?? 'The place lookup did not work. Pick a place from the list instead.');
      const answer: PlaceAnswer = { results: (body.results ?? []).map((h) => ({ ...h, precision: h.precision ?? 'place', address: h.address ?? null })), attribution: body.attribution ?? OSM_ATTRIBUTION, cached: !!body.cached };
      session.set(key, answer);
      return answer;
    },
  };
}
