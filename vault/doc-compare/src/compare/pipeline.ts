// no reader imports here: this module runs in the comparison worker and must not pull pdf.js in
import { compareMetadata } from '../checks/metadata';
import { similarity } from '../checks/similarity';
import type { NormalizedDoc } from '../readers/types';
import { describe, originOf } from '../report/messages';
import type { Change, ComparisonResult, SimilarityResult } from '../report/model';
import { SEVERITY, TIER } from '../report/severity';
import type { Settings } from '../settings';
import { align } from './align';
import { compareContent, type NewChange } from './content';
import { compareTableShapes } from './formatting';
import { runPostChecks } from './postChecks';
import { sectionGroups } from './sections';
import { wordCounts } from '../checks/limits';
import { referenceBlockIds } from '../checks/docText';
import { referenceCount } from '../checks/references';

export { similarity };

/** Content, formatting and metadata comparison of two read documents (no DOM; runs in the worker or in tests). */
/** `versions`: the two are meant to differ (addendum §0.2): the result also groups the sections; the checks run as usual. */
export function compareDocs(a: NormalizedDoc, b: NormalizedDoc, settings: Settings, versions = false): ComparisonResult {
  const ops = align(a.blocks, b.blocks);
  // reference-list entries are compared as references (checks/references.ts), not as paragraphs, so each finding shows once
  const refA = referenceBlockIds(a), refB = referenceBlockIds(b);
  const inRefs = (o: (typeof ops)[number]) => ('a' in o && refA.has(o.a.id)) || ('b' in o && refB.has(o.b.id));
  const { changes, trivialCount } = compareContent(ops.filter((o) => !inRefs(o)), settings.trivial);
  for (const s of compareTableShapes(a, b)) changes.push({ category: 'formatting', severity: SEVERITY.structure, location: `Table ${s.table}`, detail: `Table shape ${s.from} → ${s.to} (rows × columns)` });
  changes.push(...runPostChecks(a, b, ops, settings, changes));
  const counted = (d: NormalizedDoc) => ({ ...d.metadata, referenceCount: referenceCount(d), noteCount: (d.notes ?? []).filter((n) => n.kind !== 'link').length });
  const meta = compareMetadata(counted(a), counted(b), settings, a.sourceType !== b.sourceType);
  return { changes: numbered([...changes, ...meta.changes]), trivialCount, metadata: meta.rows, words: wordCounts(a, b, settings), ...(versions ? { sections: sectionGroups(a, b) } : {}) };
}

/** Tier, plain-language summary / why it matters / action, and origin, from the message catalogue (addendum §2). */
export function annotate<T extends Omit<Change, 'id' | 'children'>>(c: T): T {
  const m = describe(c as unknown as Change);
  return { ...c, tier: TIER[c.severity], summary: m.summary, whyItMatters: m.whyItMatters, action: m.action, origin: originOf(c as unknown as Change) };
}

/** Top-level changes are numbered 1..n (what people see in the # column); children get ids after them. Every change is annotated. */
export function numbered(list: NewChange[]): Change[] {
  let next = list.length + 1;
  return list.map((c, i) => ({ ...annotate(c), id: i + 1, children: c.children?.map((k) => ({ ...annotate(k), id: next++, children: undefined })) }));
}

export type { SimilarityResult };
