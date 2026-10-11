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
  id: string; name: string; color: string; distanceM: number; pointCount: number; bbox: BBox; drawMode: 'freehand' | 'click' | 'import' | 'route'; createdAt: string;
}
export interface Track extends TrackSummary { notes: string | null; geometry: { type: 'MultiLineString'; coordinates: Lines }; updatedAt: string }
export interface TrackInput { name: string; notes?: string | null; color?: string; geometry: { type: 'MultiLineString'; coordinates: Lines }; drawMode: 'freehand' | 'click' | 'import' | 'route' }
export type PlanProfile = 'walking' | 'hiking' | 'cycling' | 'driving';
export interface PlannedRoute { distanceM: number; durationS: number | null; coordinates: Line; /** Loops only: how far the length is from the target, in per cent (+8 = 8% too long). */ offPct?: number }
export interface GeocodeResult { label: string; lat: number; lng: number }

export const api = {
  config: () => call<{ maptilerKey: string | null; routePlanning?: boolean }>('GET', '/api/route-tracks/config'),
  detour: (input: { from: [number, number]; to: [number, number]; profile: PlanProfile; lengthKm?: number; round: number }) =>
    call<{ routes: PlannedRoute[]; attribution: string; targetM: number | null; directM: number; cached: boolean }>('POST', '/api/route-tracks/detour', input),
  loop: (input: { from: [number, number]; lengthKm: number; profile: PlanProfile; round: number }) =>
    call<{ routes: PlannedRoute[]; attribution: string; targetM: number; cached: boolean }>('POST', '/api/route-tracks/loop', input),
  plan: (input: { from: [number, number]; to: [number, number]; profile: PlanProfile }) =>
    call<{ routes: PlannedRoute[]; attribution: string; cached: boolean }>('POST', '/api/route-tracks/plan', input),
  geocode: (q: string) => call<{ results: GeocodeResult[] }>('POST', '/api/geocode', { q }),
  /** The name of the place at a point (one deliberate lookup after a tap or a pin drop), or null if nothing is known there. */
  reverse: (lat: number, lng: number) => call<{ result: GeocodeResult | null }>('POST', '/api/geocode/reverse', { lat, lng }),
  list: (opts: { q?: string; cursor?: string | null; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    if (opts.cursor) p.set('cursor', opts.cursor);
    p.set('limit', String(opts.limit ?? 50));
    return call<{ tracks: TrackSummary[]; nextCursor: string | null }>('GET', `/api/route-tracks?${p}`);
  },
  get: (id: string) => call<{ track: Track }>('GET', `/api/route-tracks/${id}`).then((r) => r.track),
  create: (input: TrackInput) => call<{ track: Track }>('POST', '/api/route-tracks', input).then((r) => r.track),
  update: (id: string, patch: Partial<Pick<TrackInput, 'name' | 'notes' | 'color' | 'geometry'>>) =>
    call<{ track: Track }>('PATCH', `/api/route-tracks/${id}`, patch).then((r) => r.track),
  remove: (id: string) => call<void>('DELETE', `/api/route-tracks/${id}`),
  removeMany: (ids: string[]) => call<{ deleted: number }>('POST', '/api/route-tracks/delete', { ids }),
  /** The GPX comes through fetch (the token is a header), then saves from a Blob link: a plain link or window.open would be unauthenticated. */
  async downloadGpx(id: string, fileName: string): Promise<void> {
    const t = token();
    if (!t) throw new ApiError(401, 'Sign in to Vault to use Route Tracer.');
    const res = await fetch(`/api/route-tracks/${id}/gpx`, { headers: { Authorization: `Bearer ${t}` } });
    if (!res.ok) throw new ApiError(res.status, 'Could not export this track.');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/[^\w\- .]+/g, '_') + '.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};
