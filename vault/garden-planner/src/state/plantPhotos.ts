// Plant photos on the client. Asks Vault's own `/api/plant-images` (never a photo site directly; the key and the licence filter live on the
// server). An answer is "pending" while the server fetches photos in the background; this side asks again a few times, then gives up quietly:
// the card keeps showing the colour swatch, so a missing photo is never an error and never blocks anything.
import { readVaultToken, type ReadableStorage } from '@planner-core/library/library';

export interface PlantPhoto {
  id: string; source: string; sourceLabel: string; sourceUrl: string; imageUrl: string; thumbUrl: string;
  creator: string; licenceCode: string; licenceUrl: string | null; displayOnly: boolean; title: string;
  role: 'flower' | 'foliage' | 'plant' | 'habitat' | 'other'; width: number | null; height: number | null; modified: boolean;
  /** "Photo: creator, licence via source": shown next to every photo. */
  credit: string; defaultFor: string[];
}
export type PhotoStatus = 'pending' | 'ready' | 'none' | 'error' | 'disabled' | 'offline' | 'unknown_plant';
export interface PhotoAnswer { status: PhotoStatus; images: PlantPhoto[] }

type FetchJson = (url: string, init: { headers: Record<string, string>; method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** What a curator sees of a photo: everything the plant card sees, plus whether it is hidden and why. */
export type AdminPhoto = PlantPhoto & { hidden: boolean; hiddenReason: string | null };
export interface AdminSummaryRow { plantId: string; visible: number; hidden: number; defaults: number; status: string | null; fetchedAt: number | null }
export type DefaultRole = 'flower' | 'foliage' | 'plant';
export interface AdminResult<T = undefined> { ok: boolean; error?: string; data?: T }
const POLL_MS = [2500, 5000, 10000, 20000];

/** CSV of credits (for the Credits page): one row per photo. */
export function creditsCsv(rows: Array<PlantPhoto & { plantId: string }>): string {
  const q = (s: string | null | undefined): string => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['plant', 'creator', 'licence', 'licence link', 'source', 'source link', 'photo link', 'share-alike (display only)'];
  return [head.join(','), ...rows.map((r) => [r.plantId, r.creator, r.licenceCode, r.licenceUrl, r.sourceLabel, r.sourceUrl, r.imageUrl, r.displayOnly ? 'yes' : 'no'].map(q).join(','))].join('\r\n');
}

export function createPlantPhotos(storage: ReadableStorage, fetchFn: FetchJson | undefined = typeof fetch === 'function' ? (fetch as unknown as FetchJson) : undefined, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), base = '/api/plant-images') {
  const done = new Map<string, PhotoAnswer>();
  const authed = (): Record<string, string> | null => { const t = readVaultToken(storage); return t ? { Authorization: `Bearer ${t}` } : null; };
  const asking = new Map<string, Promise<PhotoAnswer>>();

  async function once(plantId: string): Promise<PhotoAnswer> {
    const token = readVaultToken(storage);
    if (!token || !fetchFn) return { status: 'offline', images: [] };
    try {
      const res = await fetchFn(`${base}/${encodeURIComponent(plantId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { status: res.status === 404 ? 'unknown_plant' : 'error', images: [] };
      const body = (await res.json()) as Partial<PhotoAnswer>;
      // Belt and braces: never show a photo that arrives without its creator, licence and source link, whatever the server said.
      const images = (body.images ?? []).filter((i) => i.creator && i.licenceCode && i.sourceUrl && i.imageUrl);
      return { status: (body.status ?? 'none') as PhotoStatus, images };
    } catch { return { status: 'error', images: [] }; }
  }

  return {
    /** What is known right now for this plant (no network). */
    peek: (plantId: string): PhotoAnswer | undefined => done.get(plantId),
    /** Photos for a plant: asks, and while the server is still fetching asks again a few times. Resolves with the last answer. */
    get(plantId: string, onUpdate?: (a: PhotoAnswer) => void): Promise<PhotoAnswer> {
      const have = done.get(plantId);
      if (have) return Promise.resolve(have);
      const running = asking.get(plantId);
      if (running) return running;
      const p = (async () => {
        let a = await once(plantId);
        onUpdate?.(a);
        for (let i = 0; a.status === 'pending' && i < POLL_MS.length; i += 1) { await wait(POLL_MS[i]); a = await once(plantId); onUpdate?.(a); }
        // "ready", "none" and "disabled" are settled for this visit; anything else is asked again next time
        if (a.status === 'ready' || a.status === 'none' || a.status === 'disabled') done.set(plantId, a);
        return a;
      })().finally(() => asking.delete(plantId));
      asking.set(plantId, p);
      return p;
    },
    /** Forget what was learned about a plant (after a curator changed its photos), so the card asks again. */
    forget: (plantId: string): void => { done.delete(plantId); },

    /** Is the signed-in Vault user an admin? Only decides whether the curator button shows: the server checks again on every call. */
    isAdmin(): boolean {
      try {
        const raw = storage.getItem('vault-auth');
        return !!raw && (JSON.parse(raw) as { state?: { user?: { isAdmin?: unknown } } } | null)?.state?.user?.isAdmin === true;
      } catch { return false; }
    },
    /** Curator calls (admin only on the server). Each says plainly what went wrong, never throws. */
    admin: (() => {
      async function call<T>(method: string, path: string, body?: unknown): Promise<AdminResult<T>> {
        const h = authed();
        if (!h || !fetchFn) return { ok: false, error: 'Sign in to Vault as an admin to curate photos.' };
        try {
          const res = await fetchFn(`${base}${path}`, { method, headers: body === undefined ? h : { ...h, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          const j = (await res.json().catch(() => ({}))) as T & { error?: string };
          if (res.status === 403) return { ok: false, error: 'Only a Vault admin can curate photos.' };
          if (!res.ok) return { ok: false, error: (j as { error?: string }).error ?? 'That did not work.' };
          return { ok: true, data: j };
        } catch { return { ok: false, error: 'Could not reach Vault.' }; }
      }
      const enc = encodeURIComponent;
      return {
        summary: async (): Promise<AdminResult<AdminSummaryRow[]>> => { const r = await call<{ plants: AdminSummaryRow[] }>('GET', '/summary'); return r.ok ? { ok: true, data: r.data?.plants ?? [] } : { ok: false, error: r.error }; },
        all: async (plantId: string): Promise<AdminResult<AdminPhoto[]>> => { const r = await call<{ images: AdminPhoto[] }>('GET', `/${enc(plantId)}/all`); return r.ok ? { ok: true, data: r.data?.images ?? [] } : { ok: false, error: r.error }; },
        hide: (plantId: string, imageId: string, hidden: boolean) => call('POST', `/images/${enc(imageId)}/hide`, { hidden }).then((r) => { done.delete(plantId); return r; }),
        role: (plantId: string, imageId: string, role: string) => call('POST', `/images/${enc(imageId)}/role`, { role }).then((r) => { done.delete(plantId); return r; }),
        setDefault: (plantId: string, role: DefaultRole, imageId: string | null) => call('POST', `/${enc(plantId)}/default`, { role, imageId }).then((r) => { done.delete(plantId); return r; }),
        refresh: (plantId: string) => call('POST', `/${enc(plantId)}/refresh`, {}).then((r) => { done.delete(plantId); return r; }),
        refreshMissing: async (): Promise<AdminResult<number>> => { const r = await call<{ queued: number }>('POST', '/refresh-missing', {}); return r.ok ? { ok: true, data: r.data?.queued ?? 0 } : { ok: false, error: r.error }; },
      };
    })(),

    /** Credits for these plants (the Credits panel and CSV). */
    async credits(plantIds: string[]): Promise<Array<PlantPhoto & { plantId: string }>> {
      const token = readVaultToken(storage);
      if (!token || !fetchFn || plantIds.length === 0) return [];
      const res = await fetchFn(`${base}/credits?ids=${plantIds.slice(0, 300).map(encodeURIComponent).join(',')}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return ((await res.json()) as { credits?: Array<PlantPhoto & { plantId: string }> }).credits ?? [];
    },
  };
}
export type PlantPhotos = ReturnType<typeof createPlantPhotos>;
