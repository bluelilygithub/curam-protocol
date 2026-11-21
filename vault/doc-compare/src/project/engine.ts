import { referenceCount } from '../checks/references';
import type { NormalizedDoc } from '../readers/types';
import type { ComparisonResult } from '../report/model';
import { sha256 } from '../review/decisions';
import type { Decision } from '../review/verdict';
import { acceptedState } from './accepted';
import type { Project, Round, StoredFile, TrackedItem } from './model';
import { countTiers, isOpenItem, itemIdOf, queueOrder, reviewable, roundSummary, roundVerdict, trackItems } from './track';

/**
 * Everything a project does (addendum §7), as functions that take a project and return the changed copy. The comparison is passed in
 * (the worker in the app, compareDocs in tests). Adding a round compares it twice, with the accepted state and with the previous round,
 * so checking a round costs the same however many rounds there are; old rounds are never compared again (§7.8).
 */

export type CompareFn = (a: NormalizedDoc, b: NormalizedDoc) => Promise<ComparisonResult>;

const now = () => new Date().toISOString();
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export async function storeFile(file: File, doc: NormalizedDoc): Promise<StoredFile> {
  return { name: file.name, type: file.type, sizeBytes: file.size, sha256: await sha256(file), lastModified: file.lastModified, bytes: file, doc, metadata: doc.metadata };
}
export const fileOf = (s: StoredFile): File | undefined => (s.bytes ? new File([s.bytes], s.name, { type: s.type, lastModified: s.lastModified }) : undefined);

/** The project's name by default: the document's title, else the file name without its extension. */
export const defaultName = (f: StoredFile) => (f.metadata.title?.trim() && f.metadata.title !== 'Fixture' ? f.metadata.title.trim() : f.name.replace(/\.[^.]+$/, ''));

export function createProject(original: StoredFile, name?: string, at = now()): Project {
  return { id: newId(), name: name?.trim() || defaultName(original), createdAt: at, updatedAt: at, original, originalHistory: [], baseRound: 0, rounds: [] };
}

export const latest = (p: Project): Round | undefined => p.rounds[p.rounds.length - 1];
// words as the verdict screen counts them (the reference list left out unless Settings says otherwise)
const stats = (d: NormalizedDoc, r?: ComparisonResult): Round['stats'] => ({ words: r?.words?.edited ?? d.metadata.wordCount, sections: d.metadata.headingCount, references: referenceCount(d) });

/** The comparison's changes carrying their item's round note (and red when not fixed), in the order the review queue shows them. */
function annotate(result: ComparisonResult, items: TrackedItem[]): ComparisonResult {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const rank = new Map(queueOrder(items).map((i, n) => [i.itemId, n]));
  const changes = result.changes.map((c) => {
    const i = reviewable(c) ? byId.get(itemIdOf(c)) : undefined;
    return i ? { ...c, roundNote: i.change.roundNote, tier: i.change.tier ?? c.tier, severity: i.change.severity } : c;
  });
  const order = (c: (typeof changes)[number]) => (reviewable(c) ? rank.get(itemIdOf(c)) ?? 1e6 : 1e6);
  return { ...result, changes: changes.map((c, n) => ({ c, n })).sort((x, y) => order(x.c) - order(y.c) || x.n - y.n).map((x) => x.c) };
}

function finish(round: Omit<Round, 'verdict' | 'counts' | 'summary'>): Round {
  const vsAccepted = annotate(round.vsAccepted, round.items);
  return { ...round, vsAccepted, verdict: roundVerdict(round.items), counts: countTiers(vsAccepted.changes), summary: roundSummary(round.items, round.number) };
}

export type AddResult = { project: Project; duplicateOf?: number | 'original' };

/** Adds the next round. The same file as the original or an earlier round is not added again (§7.2). */
export async function addRound(p: Project, file: StoredFile, compare: CompareFn, note?: string, at = now()): Promise<AddResult> {
  if (file.sha256 === p.original.sha256) return { project: p, duplicateOf: 'original' };
  const dup = p.rounds.find((r) => r.file.sha256 === file.sha256);
  if (dup) return { project: p, duplicateOf: dup.number };
  const prev = latest(p);
  const number = (prev?.number ?? 0) + 1;
  const vsAccepted = await compare(acceptedState(p), file.doc);
  const vsPrevious = prev && prev.number > p.baseRound ? await compare(prev.file.doc, file.doc) : undefined;
  // the round that became the original is not a previous round to compare with: its items were all accepted with it
  const items = trackItems(number, vsAccepted.changes, prev && prev.number > p.baseRound ? prev.items : prev?.number === p.baseRound ? [] : undefined);
  const round = finish({ number, addedAt: at, note: note?.trim() || undefined, file, vsPrevious, vsAccepted, items, stats: stats(file.doc, vsAccepted) });
  return { project: { ...p, rounds: [...p.rounds, round], updatedAt: at } };
}

/** Checks the latest round again against the rebuilt accepted state, keeping the decisions made in it (§7.3, §7.8). */
export async function recheckLatest(p: Project, compare: CompareFn): Promise<Project> {
  const last = latest(p);
  if (!last || last.number <= p.baseRound) return p;
  const prev = p.rounds[p.rounds.length - 2];
  const vsAccepted = await compare(acceptedState(p, last.number - 1), last.file.doc);
  const items = trackItems(last.number, vsAccepted.changes, prev && prev.number > p.baseRound ? prev.items : prev?.number === p.baseRound ? [] : undefined, last.items);
  const round = finish({ ...last, vsAccepted, items, stats: stats(last.file.doc, vsAccepted) });
  return { ...p, rounds: [...p.rounds.slice(0, -1), round] };
}

/**
 * Records a decision on an item. In the latest round any decision can be made or undone. In an earlier round only an acceptance can be
 * undone: that change leaves the accepted state, and the latest round is checked again (§7.3).
 */
export async function decide(p: Project, roundNo: number, itemId: string, decision: Decision | null, compare: CompareFn, at = now()): Promise<Project> {
  const r = p.rounds.find((x) => x.number === roundNo);
  const item = r?.items.find((i) => i.itemId === itemId);
  if (!r || !item) return p;
  const isLatest = r === latest(p);
  const undoAccept = decision === null && item.decision === 'accept';
  if (!isLatest && !undoAccept) return p;
  if (item.absorbed) return p; // part of a replaced original: shown, never undone
  const changed: TrackedItem = decision
    ? { ...item, decision, decidedAt: at, decidedInRound: roundNo, status: item.status === 'accepted' && decision !== 'accept' ? 'open' : item.status }
    : { ...item, decision: undefined, decidedAt: undefined, decidedInRound: undefined, status: item.status === 'accepted' ? 'open' : item.status };
  const rounds = p.rounds.map((x) => (x.number !== roundNo ? x : finish({ ...x, items: x.items.map((i) => (i.itemId === itemId ? changed : i)) })));
  let next: Project = { ...p, rounds, updatedAt: at };
  if (!isLatest) {
    // later rounds carried this acceptance forward: the latest one is checked again without it (older rounds stay as they were)
    const last = latest(next)!;
    next = { ...next, rounds: [...next.rounds.slice(0, -1), { ...last, items: last.items.filter((i) => !(i.itemId === itemId && i.decidedInRound === roundNo)) }] };
    next = await recheckLatest(next, compare);
  }
  // in the latest round a decision only changes the item: its own acceptances shape the accepted state from the next round on
  return next;
}

/** Accept every open item of this kind in the latest round at once (amber "Dismiss all similar"). */
export function acceptMany(p: Project, itemIds: string[], at = now()): Project {
  const last = latest(p);
  if (!last) return p;
  const ids = new Set(itemIds);
  const items = last.items.map((i) => (ids.has(i.itemId) ? { ...i, decision: 'accept' as const, decidedAt: at, decidedInRound: last.number } : i));
  return { ...p, rounds: [...p.rounds.slice(0, -1), finish({ ...last, items })], updatedAt: at };
}

/** The open red items that would be accepted if the latest round became the new original (listed by name before confirming). */
export const openRedItems = (r: Round) => r.items.filter((i) => isOpenItem(i) && i.change.severity === 'high');

/**
 * Makes the latest round the new original (§7.7). A reason is required. Its open items are accepted as part of the new original and
 * counted, the old original moves to the history with the reason, and later rounds are checked against the new one.
 */
export function makeNewOriginal(p: Project, reason: string, at = now()): Project {
  const last = latest(p);
  if (!last || !reason.trim()) throw new Error('A reason is required to make a round the new original.');
  if (!last.file.bytes) throw new Error('This round\'s file is not kept, so it cannot become the original.');
  const absorbedItems = openRedItems(last).map((i) => i.change.summary ?? i.change.detail ?? i.itemId);
  const items = last.items.map((i) => (isOpenItem(i) ? { ...i, decision: 'accept' as const, decidedAt: at, decidedInRound: last.number, status: 'accepted' as const, absorbed: true } : i));
  return {
    ...p,
    original: last.file,
    originalHistory: [...p.originalHistory, { file: p.original, replacedAt: at, replacedByRound: last.number, reason: reason.trim(), absorbed: absorbedItems.length, absorbedItems }],
    baseRound: last.number,
    rounds: [...p.rounds.slice(0, -1), finish({ ...last, items })],
    updatedAt: at,
  };
}

/** Round `from` and every later round go: each round is compared with the one before it, so a later round cannot stay without it (§7.9). */
export function deleteRounds(p: Project, from: number, at = now()): Project {
  return { ...p, rounds: p.rounds.filter((r) => r.number < from), updatedAt: at };
}

/**
 * Drops the files of old rounds and keeps everything else (summary, changes, decisions, verdict). The originals, the latest round and the
 * previous round always keep their files (§7.8). Returns the bytes freed.
 */
export function compact(p: Project, at = now()): { project: Project; freed: number } {
  const keep = new Set(p.rounds.slice(-2).map((r) => r.number));
  let freed = 0;
  const rounds = p.rounds.map((r) => {
    if (keep.has(r.number) || !r.file.bytes) return r;
    freed += r.file.sizeBytes;
    return { ...r, file: { ...r.file, bytes: null } };
  });
  return { project: freed ? { ...p, rounds, updatedAt: at } : p, freed };
}

export interface TimelineRow {
  number: number; addedAt: string; note?: string; words: number; sections: number; references: number;
  summary: Round['summary']; counts: Round['counts']; verdict: Round['verdict']; compacted: boolean;
  wordsLost: number; largestLoss: boolean; replacedOriginal?: { reason: string; absorbed: number; replacedAt: string };
}

/** One row per round (§7.6); the round that lost the most words on the one before is marked. */
export function timeline(p: Project): TimelineRow[] {
  const rows: TimelineRow[] = p.rounds.map((r, n) => {
    const before = n ? p.rounds[n - 1].stats.words : r.vsAccepted.words?.original ?? p.original.doc.metadata.wordCount;
    const rep = p.originalHistory.find((h) => h.replacedByRound === r.number);
    return {
      number: r.number, addedAt: r.addedAt, note: r.note, ...r.stats, summary: r.summary, counts: r.counts, verdict: r.verdict, compacted: !r.file.bytes,
      wordsLost: Math.max(0, before - r.stats.words), largestLoss: false,
      replacedOriginal: rep && { reason: rep.reason, absorbed: rep.absorbed, replacedAt: rep.replacedAt },
    };
  });
  const most = Math.max(0, ...rows.map((r) => r.wordsLost));
  if (most > 0) rows.find((r) => r.wordsLost === most)!.largestLoss = true;
  return rows;
}

/** "Export your project to keep a copy" is shown at the start and again every 5 rounds without an export (§7.8). */
export function exportDue(p: Project): boolean {
  const since = p.rounds.length - (p.exportedAtRound ?? 0);
  return p.exportedAt ? since >= 5 : p.rounds.length >= 1 && (p.rounds.length === 1 || since % 5 === 0);
}
