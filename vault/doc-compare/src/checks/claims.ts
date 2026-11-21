import { diffWordsWithSpace } from 'diff';
import { locate } from '../compare/content';
import { ALL_RULES, mapQuotes, normalize } from '../compare/normalize';
import type { PostCheck } from '../compare/postChecks';
import type { NewChange } from '../compare/content';
import { SEVERITY } from '../report/severity';
import { closestQuote, docText, extractQuotes, normQuote } from './docText';

/**
 * New claims (addendum §4): statistics, quotes, citations, links and attributions in added or changed text that appear nowhere in the
 * original. LLMs sometimes invent these. A figure that replaced another figure stays a number change; a quote that resembles one in the
 * original is a changed quote (checks/quotes.ts).
 */

export type ClaimKind = 'statistic' | 'quote' | 'citation' | 'link' | 'attribution';
export interface Claim { kind: ClaimKind; text: string }

const UNITS = 'respondents|people|persons|households|participants|students|businesses|jobs|cases|patients|homes|dwellings|tenants|renters|landlords|families|children|residents|members|staff|workers|years|months|weeks|days|hours|km|kilometres|kg|tonnes|hectares|dollars|properties|applications|submissions|organisations|schools';
const PATTERNS: [ClaimKind, RegExp][] = [
  ['statistic', /\b\d+(?:[.,]\d+)?\s?(?:%|per\s?cent\b)/gi],
  ['statistic', /(?:A\$|AUD\s?|[$€£])\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|thousand|m|bn|k)\b)?/gi],
  ['statistic', new RegExp(`\\b\\d[\\d,]*(?:\\.\\d+)?\\s+(?:(?:million|billion|thousand)\\s+)?(?:${UNITS})\\b`, 'gi')],
  ['statistic', /\b(?:in|since|by|from|during|until|before|after)\s+(?:1[89]\d{2}|20\d{2})\b/gi],
  ['citation', /\[\d+(?:\s*[-–,]\s*\d+)*\]/g],
  ['citation', /\(([A-Z][\w'’-]+(?:\s+et al\.?|\s+(?:and|&)\s+[A-Z][\w'’-]+)?,?\s+(?:19|20)\d{2}[a-z]?(?:,\s*p+\.\s*\d+)?)\)/g],
  ['citation', /\b[A-Z][\w'’-]+(?:\s+et al\.?|\s+(?:and|&)\s+[A-Z][\w'’-]+)?\s+\((?:19|20)\d{2}[a-z]?\)/g],
  ['link', /\bhttps?:\/\/[^\s)>\]]+|\bwww\.[^\s)>\]]+|\bdoi:\s?10\.\d{4,}\/\S+|\b10\.\d{4,}\/[^\s)]+/gi],
  // case matters after the lead-in: the source is the run of capitalised words ("by the Housing Research Centre"), so no /i flag
  ['attribution', /\b(?:[Aa]ccording to|[Rr]eported by|[Rr]esearch (?:from|by)|(?:[Aa]|[Tt]he|[Oo]ne)\s+(?:\d{4}\s+)?(?:study|survey|report|review|analysis|inquiry)\s+(?:by|from|of))(?:\s+(?:the|of|for|and|&|on|in)?\s*[A-Z][\w'’&.-]*)+/g],
];

/** Claim-like tokens in a piece of text (not counting quotes; see quotesIn). */
export function findClaims(text: string): Claim[] {
  const t = mapQuotes(text);
  const out: Claim[] = [];
  for (const [kind, re] of PATTERNS) for (const m of t.matchAll(re)) out.push({ kind, text: m[0].replace(/[.,;:]+$/, '').trim() });
  // a longer statistic swallows a shorter one found inside it ("85,000 households" vs "85,000")
  return out.filter((c, i) => !out.some((o, j) => j !== i && o.kind === c.kind && o.text.length > c.text.length && o.text.includes(c.text)));
}

const numberOf = (s: string) => /\d[\d,]*(?:\.\d+)?/.exec(s)?.[0].replace(/,/g, '');
const KIND_LABEL: Record<ClaimKind, string> = { statistic: 'Statistic', quote: 'Quote', citation: 'Citation', link: 'Link', attribution: 'Source' };

export const newClaims: PostCheck = (a, b, ops) => {
  const orig = docText(a);
  const origLower = orig.toLowerCase();
  const origNumbers = new Set((orig.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')));
  const origQuotes = extractQuotes(a);
  const editedQuotes = extractQuotes(b);
  const seen = new Set<string>();
  const out: NewChange[] = [];

  const isNew = (c: Claim) => {
    if (c.kind === 'statistic') { const n = numberOf(c.text); return !!n && !origNumbers.has(n); }
    return !origLower.includes(normalize(c.text, ALL_RULES).toLowerCase());
  };
  const report = (c: Claim, block: (typeof b.blocks)[number]) => {
    const k = `${c.kind}|${normalize(c.text, ALL_RULES).toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ category: 'newClaim', severity: SEVERITY.newClaim, location: locate(block, true), edited: block.text, detail: `${KIND_LABEL[c.kind]}: ${c.text}` });
  };

  for (const op of ops) {
    if (op.kind !== 'added' && op.kind !== 'modified') continue;
    const blk = op.b;
    let scan = blk.text;
    if (op.kind === 'modified') {
      // only what was put in; a figure that replaced a figure is a number change, not a new claim
      const parts = diffWordsWithSpace(normalize(op.a.text, ALL_RULES), normalize(blk.text, ALL_RULES));
      const inserted: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (!parts[i].added) continue;
        const del = parts[i - 1]?.removed ? parts[i - 1].value : '';
        inserted.push(/\d/.test(del) ? parts[i].value.replace(/\d[\d,.]*/g, ' ') : parts[i].value);
      }
      scan = inserted.join(' … ');
    }
    for (const c of findClaims(scan)) if (isNew(c)) report(c, blk);
    // quotes: new only when nothing like it is in the original (a reworded quote is checks/quotes.ts's job)
    for (const q of editedQuotes.filter((x) => x.block.id === blk.id)) {
      if (orig.includes(normQuote(q.text))) continue;
      if (closestQuote(q.text, origQuotes).score >= 0.6) continue;
      report({ kind: 'quote', text: `"${q.text}"` }, blk);
    }
  }
  return out;
};
