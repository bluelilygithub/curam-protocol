import { locate, type NewChange } from '../compare/content';
import { mapQuotes } from '../compare/normalize';
import type { PostCheck } from '../compare/postChecks';
import type { Block, NormalizedDoc } from '../readers/types';
import { SEVERITY } from '../report/severity';
import { referenceBlockIds } from './docText';

/**
 * Terminology (addendum §5.5), found in the original automatically:
 *   defined terms   "X" means …, (the "X")
 *   acronyms        Spelled Out Phrase (SOP), with that expansion
 *   phrases         capitalised multi-word phrases used 3 or more times
 *   glossary        terms from Settings (one per line), protected even when used once
 * Amber: a term no longer used or used less than half as often; an acronym used without the expansion the original had; an acronym that is
 * new in the edited version and never spelled out.
 */

export type TermKind = 'defined' | 'acronym' | 'phrase' | 'glossary';
export interface Term { term: string; kind: TermKind; expansion?: string }

const SMALL = new Set(['of', 'and', 'for', 'the', 'on', 'in', 'to', 'a', '&']);
const LEADING = /^(?:The|This|That|These|Those|A|An|In|On|At|By|For|Of|Our|We|It|Its|Each|Every|Either|If|When|Under|From|With|As|And|But|To)\s+/;
// shortcut: a fixed list of acronyms that need no expansion; a glossary entry or Settings list could replace it if people ask
const WELL_KNOWN = new Set(['AM', 'PM', 'OK', 'TV', 'UK', 'US', 'USA', 'EU', 'UN', 'PDF', 'URL', 'ID', 'CEO', 'GST', 'GDP', 'COVID', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'NT', 'TAS', 'ACT', 'AI', 'IT', 'HR', 'FAQ', 'DIY', 'ATM', 'PIN', 'ISBN', 'DOI', 'HTML', 'LLM', 'NZ', 'AUD', 'USD']);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const countOf = (term: string, text: string) => (text.match(new RegExp(`(?<![\\w-])${esc(term)}(?![\\w-])`, 'g')) ?? []).length;

/** Body text (no reference list), one string, quotes made straight. Blocks in all capitals (shouted headings) are left out of acronym finding. */
function body(d: NormalizedDoc): { text: string; blocks: Block[] } {
  const refs = referenceBlockIds(d);
  const blocks = d.blocks.filter((b) => !refs.has(b.id) && b.text.trim());
  return { text: blocks.map((b) => mapQuotes(b.text)).join('\n'), blocks };
}

/** Acronyms defined as "Spelled Out Phrase (SOP)": the capitals of the acronym match the initials of the words before it. */
export function acronymDefinitions(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\(([A-Z][A-Za-z&]{1,9})\)/g)) {
    const acr = m[1], letters = acr.replace(/[^A-Z]/g, '');
    if (letters.length < 2 || out.has(acr)) continue;
    const words = text.slice(Math.max(0, m.index - 200), m.index).trim().split(/\s+/);
    let i = words.length, found = 0;
    while (i > 0 && found < letters.length) { i--; if (!SMALL.has(words[i].toLowerCase())) found++; }
    const phrase = words.slice(i);
    const initials = phrase.filter((w) => !SMALL.has(w.toLowerCase())).map((w) => w[0]?.toUpperCase()).join('');
    if (initials === letters) out.set(acr, phrase.join(' ').replace(/^[^\w]+|[^\w]+$/g, ''));
  }
  return out;
}

/** The terms the original defines or relies on. */
export function findTerms(d: NormalizedDoc, glossary: string[] = []): Term[] {
  const { text } = body(d);
  const out = new Map<string, Term>();
  const add = (t: Term) => { if (t.term.length > 1 && !out.has(t.term)) out.set(t.term, t); };
  for (const re of [/"([^"\n]{2,60})"\s+means\b/g, /\((?:the\s+)?"([^"\n]{2,60})"\)/g]) for (const m of text.matchAll(re)) add({ term: m[1].trim(), kind: 'defined' });
  for (const [acr, expansion] of acronymDefinitions(text)) add({ term: acr, kind: 'acronym', expansion });
  const phrases = new Map<string, number>();
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:\s+(?:(?:of|and|for|the|on|in)\s+)*[A-Z][a-z]+)+/g)) {
    const p = m[0].replace(LEADING, '');
    if (/\s/.test(p)) phrases.set(p, (phrases.get(p) ?? 0) + 1);
  }
  for (const [p, n] of phrases) if (n >= 3) add({ term: p, kind: 'phrase' });
  for (const g of glossary.map((s) => s.trim()).filter(Boolean)) out.set(g, { term: g, kind: 'glossary' });
  return [...out.values()];
}

const KIND_WORD: Record<TermKind, string> = { defined: 'Defined term', acronym: 'Acronym', phrase: 'Term', glossary: 'Glossary term' };

export const terms: PostCheck = (a, b, _ops, ctx) => {
  const A = body(a), B = body(b);
  const out: NewChange[] = [];
  const firstIn = (term: string) => B.blocks.find((bl) => countOf(term, mapQuotes(bl.text)) > 0);
  const where = (term: string) => { const bl = firstIn(term); return bl ? locate(bl, true) : 'Whole document'; };
  const known = findTerms(a, ctx.settings.glossary ?? []);
  for (const t of known) {
    const na = countOf(t.term, A.text), nb = countOf(t.term, B.text);
    if (na < (t.kind === 'phrase' ? 3 : t.kind === 'glossary' ? 1 : 2)) continue;
    if (nb === 0) out.push({ category: 'terminology', severity: SEVERITY.terminology, location: 'Whole document', original: t.term, detail: `${KIND_WORD[t.kind]} "${t.term}" is no longer used (${na}× in the original)` });
    else if (nb < na * 0.5) out.push({ category: 'terminology', severity: SEVERITY.terminology, location: where(t.term), original: t.term, edited: t.term, detail: `${KIND_WORD[t.kind]} "${t.term}" is used less than half as often (${na}× → ${nb}×)` });
    else if (t.kind === 'acronym' && t.expansion && !B.text.toLowerCase().includes(t.expansion.toLowerCase())) {
      out.push({ category: 'terminology', severity: SEVERITY.terminology, location: where(t.term), original: `${t.expansion} (${t.term})`, edited: t.term, detail: `Acronym ${t.term} is used without its expansion "${t.expansion}"` });
    }
  }
  // acronyms new in the edited version, never spelled out there
  const defsB = acronymDefinitions(B.text);
  const seen = new Set<string>();
  for (const bl of B.blocks) {
    if (!/[a-z]/.test(bl.text)) continue; // a heading in capitals
    for (const m of bl.text.matchAll(/\b[A-Z]{2,6}(?=s?\b)/g)) {
      const acr = m[0];
      if (seen.has(acr) || WELL_KNOWN.has(acr) || /^[IVXLC]+$/.test(acr) || defsB.has(acr) || countOf(acr, A.text) > 0) continue;
      seen.add(acr);
      out.push({ category: 'terminology', severity: SEVERITY.terminology, location: locate(bl, true), edited: acr, detail: `Acronym ${acr} is new and never spelled out` });
    }
  }
  return out;
};
