// Tracing pictures are stored apart from the garden design and referenced from it by `underlay.imageId`, so autosave sends only the small
// design. A picture is uploaded once. Two homes, told apart by the reference's prefix:
//   srv-<id>  the Vault account (garden_images, /api/garden-projects/images)
//   loc-<id>  this browser (IndexedDB), used when signed out or Vault is unreachable; promoted to the account the next time it can be
import { readVaultToken } from '@planner-core/library/library';

export interface BlobStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
}

/** IndexedDB-backed store; falls back to memory (this visit only) where IndexedDB is not available. */
export function createLocalBlobStore(): BlobStore {
  const mem = new Map<string, Blob>();
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open('garden-planner-images', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('images');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return db;
  };
  return {
    async put(id, blob) {
      mem.set(id, blob);
      try {
        const d = await open();
        await new Promise<void>((res, rej) => { const t = d.transaction('images', 'readwrite'); t.objectStore('images').put(blob, id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
      } catch { /* kept in memory for this visit */ }
    },
    async get(id) {
      const m = mem.get(id);
      if (m) return m;
      try {
        const d = await open();
        return await new Promise<Blob | null>((res, rej) => { const r = d.transaction('images').objectStore('images').get(id); r.onsuccess = () => res((r.result as Blob | undefined) ?? null); r.onerror = () => rej(r.error); });
      } catch { return null; }
    },
  };
}

export type FetchBin = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: Blob }) => Promise<{
  ok: boolean; status: number; blob(): Promise<Blob>; json(): Promise<unknown>;
}>;

export interface ImageStorePorts {
  /** Where the library is saving right now. */
  kind(): 'server' | 'local' | null;
  /** Reads `vault-auth`; injectable for tests. */
  token(): string | null;
  fetch: FetchBin | undefined;
  local: BlobStore;
  newId(): string;
  /** Turn a blob into a URL an <img> can use (injectable for tests). */
  objectUrl?(b: Blob): string;
  base?: string;
}

const API = '/api/garden-projects/images';
export const isServerRef = (ref: string): boolean => ref.startsWith('srv-');
export const isLocalRef = (ref: string): boolean => ref.startsWith('loc-');

export function createImageStore(p: ImageStorePorts) {
  const base = p.base ?? API;
  const urls = new Map<string, string>();
  const objectUrl = p.objectUrl ?? ((b: Blob): string => URL.createObjectURL(b));

  async function upload(blob: Blob): Promise<string> {
    const t = p.token();
    if (!t || !p.fetch) throw new Error('not signed in');
    const res = await p.fetch(base, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'Vault could not store the picture.');
    }
    return ((await res.json()) as { image: { id: string } }).image.id;
  }

  async function putLocal(blob: Blob): Promise<string> {
    const ref = `loc-${p.newId()}`;
    await p.local.put(ref, blob);
    return ref;
  }

  const store = {
    /** Store a picture once and return its reference. Account when it can, else this browser. */
    async put(blob: Blob): Promise<{ ref: string; where: 'server' | 'local'; note?: string }> {
      if (p.kind() === 'server') {
        try { return { ref: await upload(blob), where: 'server' }; } catch (e) {
          return { ref: await putLocal(blob), where: 'local', note: `${e instanceof Error ? e.message : 'Could not reach Vault.'} The picture is kept in this browser for now.` };
        }
      }
      return { ref: await putLocal(blob), where: 'local' };
    },

    async blob(ref: string): Promise<Blob> {
      if (isLocalRef(ref)) {
        const b = await p.local.get(ref);
        if (!b) throw new Error('This picture is no longer in this browser.');
        return b;
      }
      const t = p.token();
      if (!t || !p.fetch) throw new Error('Sign in to Vault to see this garden\'s tracing picture.');
      const res = await p.fetch(`${base}/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error(res.status === 404 ? 'The tracing picture was not found.' : 'Could not load the tracing picture.');
      return res.blob();
    },

    /** An object URL for an <img>, fetched once per reference. */
    async url(ref: string): Promise<string> {
      const have = urls.get(ref);
      if (have) return have;
      const u = objectUrl(await store.blob(ref));
      urls.set(ref, u);
      return u;
    },

    /** A browser-only picture becomes an account picture when the library is saving to the account. Returns the (possibly new) reference. */
    async promote(ref: string): Promise<string> {
      if (!isLocalRef(ref) || p.kind() !== 'server') return ref;
      try { return await upload(await store.blob(ref)); } catch { return ref; }
    },
  };
  return store;
}

export type ImageStore = ReturnType<typeof createImageStore>;

export function browserImageStore(kind: () => 'server' | 'local' | null, newId: () => string, storage: { getItem(k: string): string | null }): ImageStore {
  return createImageStore({
    kind, newId, token: () => readVaultToken(storage), local: createLocalBlobStore(),
    fetch: typeof fetch === 'function' ? ((url, init) => fetch(url, init as RequestInit) as ReturnType<FetchBin>) : undefined,
  });
}

/** Read a picture file and shrink it to at most `maxSide` px on the long edge (JPEG, white background so a transparent PNG does not go black). */
export function readPicture(file: Blob, maxSide = 4000): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('This browser cannot read pictures.')); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve({ blob: b, width: w, height: h }) : reject(new Error('Could not shrink that picture.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture we can read.')); };
    img.src = url;
  });
}

/** data: URL <-> Blob, for the export file (which carries its picture so it works anywhere). */
export async function blobToDataUrl(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${b.type || 'image/jpeg'};base64,${btoa(s)}`;
}
export function dataUrlToBlob(u: string): Blob | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(u);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
