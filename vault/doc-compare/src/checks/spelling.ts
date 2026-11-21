import { locate, type NewChange } from '../compare/content';
import { mapQuotes } from '../compare/normalize';
import type { PostCheck } from '../compare/postChecks';
import type { Block, NormalizedDoc } from '../readers/types';
import { SEVERITY } from '../report/severity';
import data from './spellingList.json';
import { referenceBlockIds } from './docText';

/**
 * Spelling standard (addendum §5.5). The standard is the one the original mostly uses (not a setting); every word in the edited version
 * that switched to the other standard is reported, grouped into one amber change with a child per word. Quotes and the reference list
 * are left out: a quoted US source keeps its spelling.
 */

const ISE = ['e', 'ed', 'es', 'ing', 'ation', 'ations', 'ational', 'ationally', 'er', 'ers', 'able'];
const YSE = ['e', 'ed', 'es', 'ing', 'er', 'ers'];
const OUR = ['', 's', 'ed', 'ing', 'ful', 'less', 'able', 'ably', 'er', 'ers', 'ite', 'ites', 'hood', 'hoods', 'al', 'ally'];

export const AU_TO_US = new Map<string, string>();
for (const s of data.iseStems) for (const f of ISE) AU_TO_US.set(s + f, s.replace(/s$/, 'z') + f);
for (const s of data.yseStems) for (const f of YSE) AU_TO_US.set(s + f, s.replace(/s$/, 'z') + f);
for (const s of data.ourStems) for (const f of OUR) AU_TO_US.set(`${s}ur${f}`, `${s}r${f}`);
for (const [au, us] of data.pairs) AU_TO_US.set(au, us);
export const US_TO_AU = new Map([...AU_TO_US].map(([au, us]) => [us, au]));

type Std = 'au' | 'us';
export interface SpellingCounts { au: number; us: number; words: Map<string, { n: number; block: Block }> }

/** Australian and US spellings in the body text, outside quotes and the reference list. */
export function spellingCounts(d: NormalizedDoc): SpellingCounts {
  const refs = referenceBlockIds(d);
  const out: SpellingCounts = { au: 0, us: 0, words: new Map() };
  for (const b of d.blocks) {
    if (refs.has(b.id)) continue;
    for (const m of mapQuotes(b.text).replace(/"[^"]*"/g, ' ').matchAll(/[A-Za-z]+/g)) {
      const w = m[0].toLowerCase();
      if (w === 'labor' && m[0][0] === 'L') continue; // the Australian Labor Party
      const std: Std | undefined = AU_TO_US.has(w) ? 'au' : US_TO_AU.has(w) ? 'us' : undefined;
      if (!std) continue;
      out[std]++;
      const e = out.words.get(w) ?? { n: 0, block: b };
      e.n++;
      out.words.set(w, e);
    }
  }
  return out;
}

const NAME: Record<Std, string> = { au: 'Australian', us: 'US' };

export const spelling: PostCheck = (a, b) => {
  const ca = spellingCounts(a);
  if (ca.au === ca.us) return []; // no clear standard in the original
  const std: Std = ca.au > ca.us ? 'au' : 'us';
  const other = std === 'au' ? US_TO_AU : AU_TO_US;
  const cb = spellingCounts(b);
  const kids: NewChange[] = [];
  let places = 0;
  for (const [w, e] of cb.words) {
    if (!other.has(w)) continue;
    const extra = e.n - (ca.words.get(w)?.n ?? 0);
    if (extra <= 0) continue;
    places += extra;
    const was = other.get(w)!;
    kids.push({ category: 'spelling', severity: SEVERITY.spelling, location: locate(e.block, true), original: was, edited: w, detail: `${was} → ${w}${extra > 1 ? ` (${extra}×)` : ''}` });
  }
  if (!kids.length) return [];
  const to = std === 'au' ? 'us' : 'au';
  return [{
    category: 'spelling',
    severity: SEVERITY.spelling,
    location: 'Whole document',
    detail: `Spelling switched from ${NAME[std]} to ${NAME[to]}: ${places} place${places === 1 ? '' : 's'}, ${kids.length} word${kids.length === 1 ? '' : 's'} (${kids.slice(0, 3).map((k) => k.edited).join(', ')}${kids.length > 3 ? ', …' : ''})`,
    children: kids,
  }];
};
