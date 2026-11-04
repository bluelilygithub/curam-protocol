// Instant filters on the names already generated. They cost no credits and change nothing but what is shown, and the page always says
// how many are showing ("12 of 40 shown"), so nothing is hidden silently. The person's own names (a book title, an artist) are never
// filtered out.

export const BLANK_FILTERS = {
  maxLetters: 0,        // 0 = any
  maxSyllables: 0,      // 0 = any
  endings: [],          // endings that must be positively free
  styles: [],           // only these styles (empty = all)
  startsWith: '',       // "b, br, st": the name must start with one of these
  avoidLetters: '',     // letters the name must not contain
  hideHardSpelling: false,
  shortlistedOnly: false,
};

export const HARD_SPELLING_SCORE = 25;

const letters = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const starts = (s) => String(s || '').toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/[^a-z]/g, '')).filter(Boolean);

const isFree = (card, tld) => ((card.domains && card.domains.results) || []).some((r) => r.tld === tld && r.available === true);

export function matches(card, filters, shortlist = []) {
  const f = filters || BLANK_FILTERS;
  if (card.own) return true;
  if (f.maxLetters && card.name.length > f.maxLetters) return false;
  if (f.maxSyllables && card.syllables > f.maxSyllables) return false;
  if ((f.endings || []).some((t) => !isFree(card, t))) return false;
  if ((f.styles || []).length && !f.styles.includes(card.style)) return false;
  const prefixes = starts(f.startsWith);
  if (prefixes.length && !prefixes.some((p) => card.name.startsWith(p))) return false;
  const avoid = letters(f.avoidLetters);
  if (avoid && [...avoid].some((ch) => card.name.includes(ch))) return false;
  if (f.hideHardSpelling && card.spell && card.spell.score >= HARD_SPELLING_SCORE) return false;
  if (f.shortlistedOnly && !shortlist.includes(card.name)) return false;
  return true;
}

export function applyFilters(pool, f, shortlist = []) {
  return (pool || []).filter((c) => matches(c, f || BLANK_FILTERS, shortlist));
}

export function activeFilters(f) {
  const x = f || BLANK_FILTERS;
  const out = [];
  if (x.maxLetters) out.push(`up to ${x.maxLetters} letters`);
  if (x.maxSyllables) out.push(`up to ${x.maxSyllables} syllable${x.maxSyllables === 1 ? '' : 's'}`);
  if ((x.endings || []).length) out.push(`${x.endings.map((t) => `.${t}`).join(' and ')} free`);
  if ((x.styles || []).length) out.push(`style: ${x.styles.join(', ')}`);
  if (starts(x.startsWith).length) out.push(`starting ${starts(x.startsWith).join(' or ')}`);
  if (letters(x.avoidLetters)) out.push(`without ${[...letters(x.avoidLetters)].join(', ')}`);
  if (x.hideHardSpelling) out.push('easy to spell');
  if (x.shortlistedOnly) out.push('shortlisted only');
  return out;
}

/** "12 of 40 shown", and what is filtering them. */
export function countLine(shown, total, f) {
  const active = activeFilters(f);
  return `${shown} of ${total} shown${active.length ? ` (${active.join(', ')})` : ''}`;
}
