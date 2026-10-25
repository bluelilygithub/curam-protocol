import type { Intent } from './ask';
import type { Place, PlaceCategory } from './placesModel';
import type { BBox, Line, Lines } from './geo';

/** Vault's token lives in localStorage['vault-auth'] (same origin as this app). */
export function token(): string | null {
  try {
    const raw = localStorage.getItem('vault-auth');
    return raw ? ((JSON.parse(raw) as { state?: { token?: string } }).state?.token ?? null) : null;
  } catch { return null; }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const t = token();
  if (!t) throw new ApiError(401, 'Sign in to Vault to use Route Tracer.');
  const headers: Record<string, string> = { Authorization: `Bearer ${t}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(0, 'Could not reach Vault.'); }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'That did not work.', json);
  return json as T;
}

export interface TrackSummary {
  id: string; name: string; color: string; distanceM: number; pointCount: number; bbox: BBox; drawMode: 'freehand' | 'click' | 'import' | 'route'; /** Starred by the person: the list can show only these. */ favourite: boolean; createdAt: string;
}
/** One turn-by-turn direction: what to do, how far until the next one, and the place on the map where it happens. */
export interface Cue { text: string; distanceM: number; durationS: number | null; type: number | null; pos: [number, number] }
export interface Track extends TrackSummary { notes: string | null; geometry: { type: 'MultiLineString'; coordinates: Lines }; /** Only a planned route that has not been reshaped has these. */ cues: Cue[] | null; updatedAt: string }
export interface TrackInput { name: string; notes?: string | null; color?: string; geometry: { type: 'MultiLineString'; coordinates: Lines }; drawMode: 'freehand' | 'click' | 'import' | 'route'; cues?: Cue[] | null }
export type PlanProfile = 'walking' | 'hiking' | 'cycling' | 'driving';
export interface PlannedRoute { distanceM: number; durationS: number | null; coordinates: Line; /** Turn-by-turn directions, when the routing service gave them. */ steps?: Cue[]; /** Loops only: how far the length is from the target, in per cent (+8 = 8% too long). */ offPct?: number }
export interface GeocodeResult { label: string; lat: number; lng: number }

export const api = {
  config: () => call<{ maptilerKey: string | null; routePlanning?: boolean; emailEnabled?: boolean; isAdmin?: boolean }>('GET', '/api/route-tracks/config'),
  /** Owner only: one tiny routing request, to see whether the routing service answers from the server and how fast. */
  diagnose: () => call<{ ok: boolean; keySet: boolean; ms: number; summary: string }>('GET', '/api/route-tracks/diagnose'),
  /** The road or path between two clicks (Click mode with Follow roads on): one route, not alternatives. */
  leg: (input: { from: [number, number]; to: [number, number]; profile: PlanProfile }) =>
    call<{ route: PlannedRoute; cached: boolean }>('POST', '/api/route-tracks/leg', input),
  /** One route through a start, up to eight stops and an end (no alternatives), with directions. */
  multi: (input: { points: [number, number][]; profile: PlanProfile }) =>
    call<{ route: PlannedRoute; attribution: string; cached: boolean }>('POST', '/api/route-tracks/multi', input),
  detour: (input: { from: [number, number]; to: [number, number]; profile: PlanProfile; lengthKm?: number; round: number }) =>
    call<{ routes: PlannedRoute[]; attribution: string; targetM: number | null; directM: number; cached: boolean }>('POST', '/api/route-tracks/detour', input),
  loop: (input: { from: [number, number]; lengthKm: number; profile: PlanProfile; round: number }) =>
    call<{ routes: PlannedRoute[]; attribution: string; targetM: number; cached: boolean }>('POST', '/api/route-tracks/loop', input),
  plan: (input: { from: [number, number]; to: [number, number]; profile: PlanProfile }) =>
    call<{ routes: PlannedRoute[]; attribution: string; cached: boolean }>('POST', '/api/route-tracks/plan', input),
  geocode: (q: string) => call<{ results: GeocodeResult[] }>('POST', '/api/geocode', { q }),
  /** The name of the place at a point (one deliberate lookup after a tap or a pin drop), or null if nothing is known there. */
  reverse: (lat: number, lng: number) => call<{ result: GeocodeResult | null }>('POST', '/api/geocode/reverse', { lat, lng }),
  /** Notable buildings, landmarks and venues within radiusKm of any point on a line (OpenStreetMap through the server). */
  places: (input: { line: [number, number][]; radiusKm: number }) =>
    call<{ places: Place[]; counts: Record<string, number>; truncated: boolean; radiusKm: number; routeKm: number; categories: PlaceCategory[]; attribution: string }>('POST', '/api/route-tracks/places', input),
  /** One plain-English request for a route, worked out by the server: which kind of plan, which two place names, how long, how travelled. */
  ask: (text: string) => call<{ intent: Intent; via: 'local' | 'ai' }>('POST', '/api/route-tracks/ask', { text }),
  /** Email a map PDF (made in the browser) to one address. `pdf` is base64. */
  emailMap: (input: { to: string; subject: string; message: string; copyToMe: boolean; filename: string; pdf: string }) =>
    call<{ ok: true; copied: boolean }>('POST', '/api/route-tracks/email', input),
  /** Email a saved track as a GPX, TCX or KML file. The server makes the file from the stored track. */
  emailFile: (id: string, input: { to: string; format: 'gpx' | 'tcx' | 'kml'; message?: string; copyToMe: boolean }) =>
    call<{ ok: true; copied: boolean }>('POST', `/api/route-tracks/${id}/email-file`, input),
  list: (opts: { q?: string; cursor?: string | null; limit?: number; favourite?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.favourite) p.set('favourite', '1');
    if (opts.q) p.set('q', opts.q);
    if (opts.cursor) p.set('cursor', opts.cursor);
    p.set('limit', String(opts.limit ?? 50));
    return call<{ tracks: TrackSummary[]; nextCursor: string | null }>('GET', `/api/route-tracks?${p}`);
  },
  get: (id: string) => call<{ track: Track }>('GET', `/api/route-tracks/${id}`).then((r) => r.track),
  create: (input: TrackInput) => call<{ track: Track }>('POST', '/api/route-tracks', input).then((r) => r.track),
  update: (id: string, patch: Partial<Pick<TrackInput, 'name' | 'notes' | 'color' | 'geometry' | 'cues'>> & { favourite?: boolean }) =>
    call<{ track: Track }>('PATCH', `/api/route-tracks/${id}`, patch).then((r) => r.track),
  /** Deleting moves the track to Vault's shared recycle bin (30 days); `binId` is what Undo restores. */
  /** Work out directions for a saved track that has none: the line is thinned and the routing service routes through it. They are saved on the track. */
  directions: (id: string, profile: PlanProfile) => call<{ track: Track; routeM: number }>('POST', `/api/route-tracks/${id}/directions`, { profile }),
  /** A new track from this one, same line and directions, named "... (copy)". */
  copyTrack: (id: string) => call<{ track: Track }>('POST', `/api/route-tracks/${id}/copy`).then((r) => r.track),
  /** A new track walking this one the other way, named "... (reversed)"; its directions are not carried over. */
  reverseTrack: (id: string) => call<{ track: Track }>('POST', `/api/route-tracks/${id}/reverse`).then((r) => r.track),
  remove: (id: string) => call<{ ok: true; binId: string }>('DELETE', `/api/route-tracks/${id}`),
  removeMany: (ids: string[]) => call<{ deleted: number; binIds: string[] }>('POST', '/api/route-tracks/delete', { ids }),
  /** Put something back from the recycle bin. */
  restore: (binId: string) => call<unknown>('POST', `/api/recycle-bin/${binId}/restore`),
  /** The GPX comes through fetch (the token is a header), then saves from a Blob link: a plain link or window.open would be unauthenticated. */
  downloadGpx(id: string, fileName: string): Promise<void> {
    return this.downloadFile(id, fileName, 'gpx');
  },
  /** GPX, TCX or KML: the formats the Zepp app reads when you send a route to a watch. */
  async downloadFile(id: string, fileName: string, format: 'gpx' | 'tcx' | 'kml'): Promise<void> {
    const t = token();
    if (!t) throw new ApiError(401, 'Sign in to Vault to use Route Tracer.');
    const res = await fetch(`/api/route-tracks/${id}/file?format=${format}`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, 'Could not export this track.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/[^\w\- .]+/g, '_') + '.' + format;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};
