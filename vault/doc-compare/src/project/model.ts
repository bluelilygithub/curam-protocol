import type { DocMetadata, NormalizedDoc } from '../readers/types';
import type { Change, ComparisonResult, SimilarityResult } from '../report/model';
import { run } from '../review/db';
import type { Decision, Verdict } from '../review/verdict';

/**
 * Projects (addendum §7): one per document, an original kept as a clean copy, and rounds 1, 2, 3 … each checked against the accepted state
 * (the original plus the changes the person accepted) and against the previous round. Kept in this browser's IndexedDB only.
 */

export interface StoredFile {
  name: string;
  type: string;
  sizeBytes: number;
  sha256: string;
  lastModified: number;
  bytes: Blob | null; // null once the round is compacted (§7.8): the summary, changes and decisions stay
  doc: NormalizedDoc;
  metadata: DocMetadata;
}

export type ItemStatus = 'fixed' | 'accepted' | 'notFixed' | 'changedAgain' | 'new' | 'open';

export interface TrackedItem {
  itemId: string; // the same original content and kind of change in every round (§7.5)
  key: string; // the change's content: differs when it changed differently
  change: Change;
  status: ItemStatus;
  decision?: Decision;
  decidedAt?: string;
  decidedInRound?: number;
  firstRound: number; // the round that first lost or changed it (drift, §7.6)
  fixedInRound?: number;
  absorbed?: boolean; // accepted because its round became the new original (§7.7)
}

export interface Round {
  number: number;
  addedAt: string;
  note?: string;
  file: StoredFile;
  vsPrevious?: ComparisonResult; // what changed this round (none for round 1)
  vsAccepted: ComparisonResult; // is it still true to the original? (sets the verdict)
  items: TrackedItem[];
  verdict: Verdict;
  counts: { red: number; amber: number; info: number };
  summary: { fixed: number; notFixed: number; new: number };
  stats: { words: number; sections: number; references: number };
  similarity?: SimilarityResult; // the same-document check when the round was added
  override?: boolean; // compared anyway, below the threshold
}

export interface OriginalReplacement {
  file: StoredFile;
  replacedAt: string;
  replacedByRound: number;
  reason: string;
  absorbed: number; // open red items accepted as part of the new original
  absorbedItems: string[];
}

export interface ProjectSettings { wordLimit: number | null; pageLimit: number | null; requiredHeadings: string[]; glossary: string[] }

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  original: StoredFile;
  originalHistory: OriginalReplacement[];
  baseRound: number; // rounds after this one are checked against the current original (0 until it is replaced)
  rounds: Round[];
  settings?: Partial<ProjectSettings>;
  exportedAt?: string;
  exportedAtRound?: number;
  sizeBytes?: number; // storage used, worked out when saved
}

// ---- storage: the 'projects' store of the app's database (review/db.ts), or memory when the browser blocks storage ----
export interface ProjectStore {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  put(p: Project): Promise<void>;
  remove(id: string): Promise<void>;
  persistent: boolean;
}

export function indexedDbProjects(): ProjectStore {
  return {
    persistent: true,
    list: () => run<Project[]>('projects', 'readonly', (s) => s.getAll()),
    get: (id) => run<Project | undefined>('projects', 'readonly', (s) => s.get(id)),
    put: async (p) => { await run('projects', 'readwrite', (s) => s.put(p)); },
    remove: async (id) => { await run('projects', 'readwrite', (s) => s.delete(id)); },
  };
}

export function memoryProjects(): ProjectStore {
  const m = new Map<string, Project>();
  return {
    persistent: false,
    list: async () => [...m.values()],
    get: async (id) => m.get(id),
    put: async (p) => { m.set(p.id, p); },
    remove: async (id) => { m.delete(id); },
  };
}

export async function defaultProjects(): Promise<ProjectStore> {
  try {
    if (typeof indexedDB === 'undefined') return memoryProjects();
    const s = indexedDbProjects();
    await s.list();
    return s;
  } catch { return memoryProjects(); }
}

/** Bytes kept for a project: every stored file plus a rough size of the documents, changes and decisions. */
export function projectSize(p: Project): number {
  const files = [p.original, ...p.originalHistory.map((h) => h.file), ...p.rounds.map((r) => r.file)];
  const bytes = files.reduce((s, f) => s + (f.bytes ? f.sizeBytes : 0), 0);
  // JSON length is close enough to what IndexedDB keeps for the rest (UTF-16 doubles it at most)
  const rest = JSON.stringify({ ...p, original: { ...p.original, bytes: null }, originalHistory: p.originalHistory.map((h) => ({ ...h, file: { ...h.file, bytes: null } })), rounds: p.rounds.map((r) => ({ ...r, file: { ...r.file, bytes: null } })) }).length;
  return bytes + rest;
}

export const PROJECT_WARN_MB = 200;
