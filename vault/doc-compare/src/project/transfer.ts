import JSZip from 'jszip';
import type { OriginalReplacement, Project, Round, StoredFile } from './model';

/**
 * Export and import (addendum §7.9): one .doccompare file, a zip holding manifest.json (the project: rounds, changes, decisions and
 * history) and every stored file under files/<sha256>. Made and read in the browser; nothing goes over the network.
 */

const FORMAT = 'doccompare';
const VERSION = 1;
type Paths = Map<string, Blob>;

const out = (f: StoredFile, files: Paths) => { if (f.bytes) files.set(f.sha256, f.bytes); return { ...f, bytes: f.bytes ? `files/${f.sha256}` : null }; };

export async function exportProject(p: Project, at = new Date().toISOString()): Promise<Blob> {
  const files: Paths = new Map();
  const project = {
    ...p,
    original: out(p.original, files),
    originalHistory: p.originalHistory.map((h) => ({ ...h, file: out(h.file, files) })),
    rounds: p.rounds.map((r) => ({ ...r, file: out(r.file, files) })),
    exportedAt: at,
    exportedAtRound: p.rounds.length,
  };
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: at, project }));
  for (const [sha, blob] of files) zip.file(`files/${sha}`, blob);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

export const exportName = (p: Project) => `${p.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'project'}.doccompare`;

// document dates were Date objects before JSON turned them into strings
const DATE_KEYS = new Set(['created', 'modified', 'lastModified']);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const reviver = (k: string, v: unknown) => (DATE_KEYS.has(k) && typeof v === 'string' && ISO.test(v) ? new Date(v) : v);

export class ImportError extends Error {}

/** Reads a .doccompare file back into a project. Anything that is not one is refused with a plain message. */
export async function importProject(file: Blob): Promise<Project> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(file); } catch { throw new ImportError('This is not a DocCompare project file (.doccompare).'); }
  const manifest = await zip.file('manifest.json')?.async('string');
  if (!manifest) throw new ImportError('This file has no project in it (manifest.json is missing).');
  let data: { format?: string; version?: number; project?: Project };
  try { data = JSON.parse(manifest, reviver); } catch { throw new ImportError('The project in this file is damaged and cannot be read.'); }
  const p = data.project;
  if (data.format !== FORMAT || !p || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.original?.doc || !Array.isArray(p.rounds) || !Array.isArray(p.originalHistory)) {
    throw new ImportError('This is not a DocCompare project file, or it was made by a newer version.');
  }
  if ((data.version ?? 0) > VERSION) throw new ImportError('This project was exported by a newer version of DocCompare.');
  const back = async (f: StoredFile): Promise<StoredFile> => {
    const path = f.bytes as unknown;
    if (typeof path !== 'string') return { ...f, bytes: null };
    const entry = zip.file(path);
    if (!entry) return { ...f, bytes: null }; // shown as "File not kept", like a compacted round
    const raw = await entry.async('uint8array');
    return { ...f, bytes: new Blob([raw.slice()], { type: f.type }) };
  };
  return {
    ...p,
    original: await back(p.original),
    originalHistory: await Promise.all(p.originalHistory.map(async (h): Promise<OriginalReplacement> => ({ ...h, file: await back(h.file) }))),
    rounds: await Promise.all(p.rounds.map(async (r): Promise<Round> => ({ ...r, file: await back(r.file) }))),
  };
}

/** Keep both: the imported copy gets a new id and a name that says it was imported. */
export const asCopy = (p: Project, id: string): Project => ({ ...p, id, name: `${p.name} (imported)` });
