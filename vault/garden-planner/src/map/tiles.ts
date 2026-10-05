// Satellite tiles for the plan underlay. Asks Vault's own `/api/map-tiles` (never MapTiler directly: the key lives on the server), signed in
// with the Vault token. A tile that is not here yet is simply not drawn; it is fetched in the background and `onReady` fires when it lands,
// so panning and zooming never wait on the network. Failed tiles are not retried for 30 seconds (no storm against a server that is down).
import { readVaultToken, type ReadableStorage } from '@planner-core/library/library';

export interface MapStatus {
  enabled: boolean;
  /** The provider's own credit line: always shown while the map is. */
  attribution: string;
  maxZoom: number;
  /** Why it is off, in plain words (signed out, not set up, unreachable). */
  reason?: string;
}
export const DEFAULT_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors';

type Res = { ok: boolean; status: number; json(): Promise<unknown>; blob(): Promise<Blob> };
type FetchFn = (url: string, init: { headers: Record<string, string> }) => Promise<Res>;
export type TileImage = CanvasImageSource;

const MAX_CACHED = 300;
const CONCURRENT = 6;
const RETRY_FAILED_MS = 30000;

export function createMapTiles(
  storage: ReadableStorage,
  fetchFn: FetchFn | undefined = typeof fetch === 'function' ? (fetch as unknown as FetchFn) : undefined,
  decode: (b: Blob) => Promise<TileImage> = (b) => createImageBitmap(b),
  now: () => number = Date.now,
  base = '/api/map-tiles',
) {
  const cache = new Map<string, TileImage>(); // insertion order = least recently used first
  const failed = new Map<string, number>();
  const waiting: Array<() => void> = [];
  const inflight = new Set<string>();
  let running = 0;
  let status: Promise<MapStatus> | null = null;
  let known: MapStatus | null = null;

  const headers = (): Record<string, string> | null => {
    const token = readVaultToken(storage);
    return token ? { Authorization: `Bearer ${token}` } : null;
  };

  function pump(): void {
    while (running < CONCURRENT && waiting.length) { running += 1; waiting.shift()!(); }
  }

  return {
    /** Is the map available, and what must be credited. Asked once per visit unless it failed. */
    status(): Promise<MapStatus> {
      if (status) return status;
      const h = headers();
      if (!h || !fetchFn) return Promise.resolve({ enabled: false, attribution: DEFAULT_ATTRIBUTION, maxZoom: 20, reason: 'Sign in to Vault to see the map.' });
      const p = (async (): Promise<MapStatus> => {
        try {
          const res = await fetchFn(`${base}/status`, { headers: h });
          if (!res.ok) return { enabled: false, attribution: DEFAULT_ATTRIBUTION, maxZoom: 20, reason: 'The map is not available right now.' };
          const j = (await res.json()) as Partial<MapStatus>;
          const s: MapStatus = j.enabled
            ? { enabled: true, attribution: j.attribution || DEFAULT_ATTRIBUTION, maxZoom: Math.min(20, Math.max(1, Number(j.maxZoom) || 20)) }
            : { enabled: false, attribution: DEFAULT_ATTRIBUTION, maxZoom: 20, reason: 'The satellite map is not set up on this server yet (it needs a MapTiler key).' };
          known = s;
          return s;
        } catch {
          return { enabled: false, attribution: DEFAULT_ATTRIBUTION, maxZoom: 20, reason: 'Could not reach Vault for the map.' };
        }
      })();
      status = p;
      void p.then((s) => { if (!s.enabled && !known) status = null; }); // not set up / unreachable: ask again next time
      return p;
    },
    /** The status if it is already known (no network). */
    peekStatus: (): MapStatus | null => known,

    /** A tile if it is here; otherwise null, with a background fetch started that calls `onReady` when it arrives. */
    tile(z: number, x: number, y: number, onReady: () => void): TileImage | null {
      const key = `${z}/${x}/${y}`;
      const have = cache.get(key);
      if (have) { cache.delete(key); cache.set(key, have); return have; }
      const h = headers();
      if (!h || !fetchFn || inflight.has(key)) return null;
      const bad = failed.get(key);
      if (bad !== undefined && now() - bad < RETRY_FAILED_MS) return null;
      inflight.add(key);
      waiting.push(() => {
        void (async () => {
          try {
            const res = await fetchFn(`${base}/${z}/${x}/${y}`, { headers: h });
            if (!res.ok) throw new Error(String(res.status));
            const img = await decode(await res.blob());
            cache.set(key, img);
            while (cache.size > MAX_CACHED) { const oldest = cache.keys().next().value as string; const old = cache.get(oldest) as { close?: () => void }; old?.close?.(); cache.delete(oldest); }
            failed.delete(key);
            onReady();
          } catch {
            failed.set(key, now());
          } finally {
            inflight.delete(key);
            running -= 1;
            pump();
          }
        })();
      });
      pump();
      return null;
    },
    /** Tiles waiting or loading (the status bar can say "Loading map…"). */
    pending: (): number => inflight.size,
    /** True if some tile recently failed (so the map may have holes). */
    hasFailures: (): boolean => [...failed.values()].some((t) => now() - t < RETRY_FAILED_MS),
  };
}
export type MapTiles = ReturnType<typeof createMapTiles>;
