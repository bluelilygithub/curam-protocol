import { countWords } from '../readers/finalize';
import type { Block, NormalizedDoc } from '../readers/types';
import { SECTION_DROP_PCT, SECTION_MIN_WORDS, SEVERITY } from '../report/severity';
import type { AlignOp } from './align';
import type { NewChange } from './content';
import { ALL_RULES, normalize } from './normalize';

/**
 * Checks that run after the block comparison, on whole documents (addendum §3-5 adds its submission checks here, one function each, instead
 * of growing content.ts). Each returns new changes; none changes the ones already found.
 */
export type PostCheck = (a: NormalizedDoc, b: NormalizedDoc, ops: AlignOp[]) => NewChange[];

const sectionOf = (bl: Block) => (bl.type === 'heading' ? bl.text.trim().slice(0, 80) : bl.location.section) ?? '';
const key = (s: string) => normalize(s, ALL_RULES).toLowerCase();

/** Words per section, keyed by the section heading (text before the first heading is the "" section). */
export function sectionWords(doc: NormalizedDoc): Map<string, { title: string; words: number }> {
  const out = new Map<string, { title: string; words: number }>();
  for (const bl of doc.blocks) {
    const title = sectionOf(bl);
    const k = key(title);
    const s = out.get(k) ?? { title, words: 0 };
    if (bl.type !== 'heading') s.words += countWords(bl.text);
    out.set(k, s);
  }
  return out;
}

/** Red when one section lost more than 15% of its words and no removal in that section already explains it (addendum §3). */
export const sectionWordDrop: PostCheck = (a, b, ops) => {
  const wa = sectionWords(a), wb = sectionWords(b);
  // sections where a removed or moved-away block (or a whole removed section) is already reported
  const explained = new Set(ops.filter((o) => o.kind === 'removed' || o.kind === 'moved').map((o) => key(sectionOf((o as { a: Block }).a))));
  const out: NewChange[] = [];
  for (const [k, s] of wa) {
    const e = wb.get(k);
    if (!k || !e || explained.has(k) || s.words < SECTION_MIN_WORDS) continue;
    const pct = ((s.words - e.words) / s.words) * 100;
    if (pct <= SECTION_DROP_PCT) continue;
    out.push({
      category: 'metadata',
      severity: SEVERITY.sectionWordDrop,
      location: `${s.title.length > 50 ? `${s.title.slice(0, 49)}…` : s.title}`,
      detail: `Section "${s.title}" lost ${Math.round(pct)}% of its words`,
      original: String(s.words),
      edited: String(e.words),
    });
  }
  return out;
};

export const POST_CHECKS: PostCheck[] = [sectionWordDrop];
