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
import { wordCounts } from '../checks/limits';

export { similarity };

/** Content, formatting and metadata comparison of two read documents (no DOM; runs in the worker or in tests). */
export function compareDocs(a: NormalizedDoc, b: NormalizedDoc, settings: Settings): ComparisonResult {
  const ops = align(a.blocks, b.blocks);
  const { changes, trivialCount } = compareContent(ops, settings.trivial);
  for (const s of compareTableShapes(a, b)) changes.push({ category: 'formatting', severity: SEVERITY.structure, location: `Table ${s.table}`, detail: `Table shape ${s.from} → ${s.to} (rows × columns)` });
  changes.push(...runPostChecks(a, b, ops, settings, changes));
  const meta = compareMetadata(a.metadata, b.metadata, settings);
  return { changes: numbered([...changes, ...meta.changes]), trivialCount, metadata: meta.rows, words: wordCounts(a, b, settings) };
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
