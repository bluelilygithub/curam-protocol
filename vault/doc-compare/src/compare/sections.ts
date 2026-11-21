import { countWords } from '../readers/finalize';
import type { NormalizedDoc } from '../readers/types';
import type { Change, SectionGroup } from '../report/model';
import { ALL_RULES, normalize } from './normalize';
import { wordDice } from './textSim';

/**
 * Intentionally different versions (addendum §0.2): each section of the two versions is in both (same text), worded differently, only in
 * A or only in B. Sections match by heading; a section left over in each version matches the most alike one (Dice >= 0.5), as a renamed
 * section that is worded differently.
 */

interface Section { key: string; title: string; text: string; words: number; order: number }

const BEFORE = '(before the first heading)';
const keyOf = (s: string) => normalize(s, ALL_RULES).toLowerCase().replace(/^[\d.()\s]+/, '').replace(/\s+/g, ' ').trim();
export const SECTION_MATCH_MIN = 0.5;

function sections(d: NormalizedDoc): Section[] {
  const out: Section[] = [];
  let cur: Section = { key: '', title: BEFORE, text: '', words: 0, order: 0 };
  for (const b of d.blocks) {
    if (b.type === 'heading') {
      if (cur.text.trim() || cur.key) out.push(cur);
      cur = { key: keyOf(b.text), title: b.text.trim(), text: '', words: 0, order: out.length + 1 };
      continue;
    }
    cur.text += `${b.text}\n`;
    cur.words += countWords(b.text);
  }
  if (cur.text.trim() || cur.key) out.push(cur);
  return out;
}

export function sectionGroups(a: NormalizedDoc, b: NormalizedDoc): SectionGroup[] {
  const sa = sections(a), sb = sections(b);
  const pairs = new Map<Section, Section>();
  const usedB = new Set<Section>();
  for (const x of sa) {
    const y = sb.find((s) => !usedB.has(s) && s.key === x.key);
    if (y) { pairs.set(x, y); usedB.add(y); }
  }
  // left over on both sides: pair the most alike, best first
  const cand: [number, Section, Section][] = [];
  for (const x of sa) if (!pairs.has(x)) for (const y of sb) if (!usedB.has(y)) { const s = wordDice(x.text, y.text); if (s >= SECTION_MATCH_MIN) cand.push([s, x, y]); }
  cand.sort((p, q) => q[0] - p[0]);
  for (const [, x, y] of cand) if (!pairs.has(x) && !usedB.has(y)) { pairs.set(x, y); usedB.add(y); }

  const out: SectionGroup[] = sa.map((x) => {
    const y = pairs.get(x);
    if (!y) return { title: x.title, status: 'onlyA', wordsA: x.words, wordsB: 0 };
    const same = normalize(x.text, ALL_RULES).trim() === normalize(y.text, ALL_RULES).trim();
    return {
      title: x.title,
      ...(y.title !== x.title ? { titleB: y.title } : {}),
      status: same ? 'both' : 'reworded',
      wordsA: x.words,
      wordsB: y.words,
      ...(same ? {} : { similarity: Math.round(wordDice(x.text, y.text) * 100) }),
    };
  });
  for (const y of sb) if (!usedB.has(y)) out.push({ title: y.title, status: 'onlyB', wordsA: 0, wordsB: y.words });
  return out;
}

export const stillCheck = (changes: Change[]) => changes.filter((c) => !c.trivial && (c.category === 'number' || c.category === 'quote'));

export const SECTION_STATUS_LABEL: Record<SectionGroup['status'], string> = {
  both: 'In both versions',
  reworded: 'Worded differently',
  onlyA: 'Only in A',
  onlyB: 'Only in B',
};
