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

type FetchJson = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const POLL_MS = [2500, 5000, 10000, 20000];

/** CSV of credits (for the Credits page): one row per photo. */
export function creditsCsv(rows: Array<PlantPhoto & { plantId: string }>): string {
  const q = (s: string | null | undefined): string => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['plant', 'creator', 'licence', 'licence link', 'source', 'source link', 'photo link', 'share-alike (display only)'];
  return [head.join(','), ...rows.map((r) => [r.plantId, r.creator, r.licenceCode, r.licenceUrl, r.sourceLabel, r.sourceUrl, r.imageUrl, r.displayOnly ? 'yes' : 'no'].map(q).join(','))].join('\r\n');
}

export function createPlantPhotos(storage: ReadableStorage, fetchFn: FetchJson | undefined = typeof fetch === 'function' ? (fetch as unknown as FetchJson) : undefined, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), base = '/api/plant-images') {
  const done = new Map<string, PhotoAnswer>();
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
