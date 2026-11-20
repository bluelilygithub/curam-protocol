import { ALL_RULES, normalize } from '../compare/normalize';
import { charDice, words } from '../compare/textSim';
import type { NormalizedDoc } from '../readers/types';
import type { SimilarityResult } from '../report/model';

const SHINGLE = 5;

function shingles(doc: NormalizedDoc): Set<string> {
  const w = words(doc.blocks.map((b) => b.text).join(' '));
  const out = new Set<string>();
  if (w.length < SHINGLE) { if (w.length) out.add(w.join(' ')); return out; }
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}

const closeness = (a: number, b: number) => (a === b ? 1 : 1 - Math.abs(a - b) / Math.max(a, b));

/** Gate 2: how likely the two files are versions of the same document, 0-100, with reasons people can read. */
export function similarity(a: NormalizedDoc, b: NormalizedDoc): SimilarityResult {
  const reasons: string[] = [];
  const headsA = a.blocks.filter((x) => x.type === 'heading').map((x) => normalize(x.text, ALL_RULES)).filter(Boolean);
  const headsB = b.blocks.filter((x) => x.type === 'heading').map((x) => normalize(x.text, ALL_RULES)).filter(Boolean);
  const matched = headsA.filter((h) => headsB.some((g) => charDice(h, g) >= 0.8)).length;
  const headingScore = headsA.length ? matched / headsA.length : headsB.length ? 0 : 1;
  if (headsA.length && headingScore < 0.8) reasons.push(`Only ${matched} of ${headsA.length} headings match`);
  if (!headsA.length && headsB.length) reasons.push(`Original has no headings, edited has ${headsB.length}`);

  // shortcut: exact Jaccard over a Set (fine to a few hundred thousand words); switch to MinHash if memory becomes a problem
  const sa = shingles(a), sb = shingles(b);
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  const union = sa.size + sb.size - inter;
  const overlapScore = union ? inter / union : 1;
  if (overlapScore < 0.5) reasons.push(`Only ${Math.round(overlapScore * 100)}% of the wording overlaps`);

  const parts: number[] = [closeness(a.blocks.length, b.blocks.length), closeness(a.metadata.tableCount, b.metadata.tableCount)];
  if (a.metadata.tableCount !== b.metadata.tableCount) reasons.push(`Edited file has ${b.metadata.tableCount} table${b.metadata.tableCount === 1 ? '' : 's'}, original has ${a.metadata.tableCount}`);
  if (a.metadata.pageCount && b.metadata.pageCount) {
    parts.push(closeness(a.metadata.pageCount, b.metadata.pageCount));
    if (closeness(a.metadata.pageCount, b.metadata.pageCount) < 0.7) reasons.push(`Edited file has ${b.metadata.pageCount} pages, original has ${a.metadata.pageCount}`);
  }
  const structureScore = parts.reduce((s, x) => s + x, 0) / parts.length;
  if (closeness(a.blocks.length, b.blocks.length) < 0.6) reasons.push(`Edited file has ${b.blocks.length} blocks, original has ${a.blocks.length}`);

  const score = Math.round(100 * (0.4 * headingScore + 0.4 * overlapScore + 0.2 * structureScore));
  return { score, headingScore, overlapScore, structureScore, reasons };
}
