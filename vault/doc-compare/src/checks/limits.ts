import { countWords } from '../readers/finalize';
import type { NormalizedDoc } from '../readers/types';
import type { NewChange } from '../compare/content';
import type { PostCheck } from '../compare/postChecks';
import type { WordCounts } from '../report/model';
import { SEVERITY } from '../report/severity';
import type { Settings } from '../settings';
import { isReferenceHeading, referenceBlockIds } from './docText';

/** Word counts (addendum §5.4): total and per section, the reference list left out by default. */
export function wordCounts(a: NormalizedDoc, b: NormalizedDoc, s: Settings): WordCounts {
  const count = (d: NormalizedDoc) => {
    const refs = s.excludeReferences ? referenceBlockIds(d) : new Set<string>();
    const sections = new Map<string, number>();
    let total = 0, section = '(before the first heading)';
    for (const bl of d.blocks) {
      if (bl.type === 'heading') { section = bl.text.trim(); if (!sections.has(section)) sections.set(section, 0); continue; }
      if (refs.has(bl.id)) continue;
      const n = countWords(bl.text);
      total += n;
      sections.set(section, (sections.get(section) ?? 0) + n);
    }
    // footnotes and endnotes count by default (Settings); link definitions are not prose
    if (s.includeFootnotes) total += (d.notes ?? []).filter((n) => n.kind !== 'link').reduce((sum, n) => sum + countWords(n.text), 0);
    return { total, sections };
  };
  const ca = count(a), cb = count(b);
  const titles = [...new Set([...ca.sections.keys(), ...cb.sections.keys()])]
    .filter((t) => !(s.excludeReferences && isReferenceHeading(t)) && ((ca.sections.get(t) ?? 0) + (cb.sections.get(t) ?? 0) > 0));
  return {
    original: ca.total,
    edited: cb.total,
    limit: s.wordLimit,
    referencesExcluded: s.excludeReferences,
    sections: titles.map((title) => ({ title, original: ca.sections.get(title) ?? 0, edited: cb.sections.get(title) ?? 0 })),
  };
}

/** Red when the edited version is over the word or page limit set for this submission. */
export const limits: PostCheck = (a, b, _ops, ctx) => {
  const out: NewChange[] = [];
  const s = ctx.settings;
  if (s.wordLimit && s.wordLimit > 0) {
    const w = wordCounts(a, b, s);
    if (w.edited > s.wordLimit) out.push({ category: 'wordLimit', severity: SEVERITY.wordLimit, location: 'Whole document', original: String(w.original), edited: String(w.edited), detail: `${w.edited.toLocaleString('en-AU')} words, over the ${s.wordLimit.toLocaleString('en-AU')}-word limit by ${(w.edited - s.wordLimit).toLocaleString('en-AU')}${s.excludeReferences ? ' (reference list not counted)' : ''}` });
  }
  const pages = b.metadata.pageCount;
  const web = a.sourceType === 'html' || b.sourceType === 'html'; // a web page has no pages
  if (!web && s.pageLimit && s.pageLimit > 0 && pages && pages > s.pageLimit) {
    out.push({ category: 'wordLimit', severity: SEVERITY.wordLimit, location: 'Whole document', original: String(a.metadata.pageCount ?? '—'), edited: String(pages), detail: `${pages} pages, over the ${s.pageLimit}-page limit by ${pages - s.pageLimit}` });
  }
  return out;
};
