import { ALL_RULES, mapQuotes, normalize } from '../compare/normalize';
import { charDice, words } from '../compare/textSim';
import type { Block, NormalizedDoc } from '../readers/types';

/** Shared helpers for the submission checks (addendum §4-5). */

/** The whole document as one normalised string (trivial differences removed), for "is this anywhere in the original?". */
export const docText = (d: NormalizedDoc) => normalize(d.blocks.map((b) => b.text).join('\n'), ALL_RULES);

/** A reference list heading: References, Bibliography, Sources, Works cited, Endnotes, Notes (numbering ignored). */
export const isReferenceHeading = (text: string) => /^(?:[\d.]+\s*)?(references?|bibliography|sources|works cited|endnotes|notes|reference list)\s*$/i.test(text.trim());

/** Block ids in a reference list section (from its heading to the next heading of the same or a higher level). */
export function referenceBlockIds(d: NormalizedDoc): Set<string> {
  const ids = new Set<string>();
  let inRefs = false, level = 0;
  for (const b of d.blocks) {
    if (b.type === 'heading') {
      if (inRefs && (b.level ?? 9) <= level) inRefs = false;
      if (isReferenceHeading(b.text)) { inRefs = true; level = b.level ?? 9; }
    } else if (inRefs) ids.add(b.id);
  }
  return ids;
}

export interface Quote { text: string; block: Block }

/** Direct quotes of four or more words: text in double quotes (straight or curly), curly single quotes, and Quote-styled or blockquote blocks. */
export function extractQuotes(d: NormalizedDoc): Quote[] {
  const out: Quote[] = [];
  for (const b of d.blocks) {
    if (b.type === 'heading') continue;
    if (b.style && /quote/i.test(b.style)) {
      if (words(b.text).length >= 4) out.push({ text: b.text.trim(), block: b });
      continue;
    }
    const t = b.text;
    for (const m of mapQuotes(t).matchAll(/"([^"]+)"/g)) if (words(m[1]).length >= 4) out.push({ text: m[1].trim(), block: b });
    for (const m of t.matchAll(/(?:^|[\s(])‘([^’]+)’/g)) if (words(m[1]).length >= 4) out.push({ text: m[1].trim(), block: b });
  }
  return out;
}

export const normQuote = (s: string) => normalize(s, ALL_RULES);

/** The closest quote in a list (Dice on characters), with its score. */
export function closestQuote(q: string, list: Quote[]): { quote?: Quote; score: number } {
  let best: Quote | undefined, score = 0;
  for (const x of list) { const s = charDice(normQuote(q), normQuote(x.text)); if (s > score) { score = s; best = x; } }
  return { quote: best, score };
}
