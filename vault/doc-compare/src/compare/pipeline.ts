// no reader imports here: this module runs in the comparison worker and must not pull pdf.js in
import { compareMetadata } from '../checks/metadata';
import { similarity } from '../checks/similarity';
import type { NormalizedDoc } from '../readers/types';
import type { Change, ComparisonResult, SimilarityResult } from '../report/model';
import { SEVERITY } from '../report/severity';
import type { Settings } from '../settings';
import { align } from './align';
import { compareContent, type NewChange } from './content';
import { compareTableShapes } from './formatting';

export { similarity };

/** Content, formatting and metadata comparison of two read documents (no DOM; runs in the worker or in tests). */
export function compareDocs(a: NormalizedDoc, b: NormalizedDoc, settings: Settings): ComparisonResult {
  const ops = align(a.blocks, b.blocks);
  const { changes, trivialCount } = compareContent(ops, settings.trivial);
  for (const s of compareTableShapes(a, b)) changes.push({ category: 'formatting', severity: SEVERITY.structure, location: `Table ${s.table}`, detail: `Table shape ${s.from} → ${s.to} (rows × columns)` });
  const meta = compareMetadata(a.metadata, b.metadata, settings);
  return { changes: numbered([...changes, ...meta.changes]), trivialCount, metadata: meta.rows };
}

/** Top-level changes are numbered 1..n (what people see in the # column); children get ids after them. */
export function numbered(list: NewChange[]): Change[] {
  let next = list.length + 1;
  return list.map((c, i) => ({ ...c, id: i + 1, children: c.children?.map((k) => ({ ...k, id: next++, children: undefined })) }));
}

export type { SimilarityResult };
