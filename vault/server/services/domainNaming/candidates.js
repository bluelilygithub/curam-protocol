'use strict';

// From a wide list of ideas to a short list worth checking. Pure code, no network. The point of this step is to throw away most of what
// the AI wrote BEFORE spending any lookup credit: names that are the wrong length, hard to spell when heard, too like each other, or
// too like a well-known brand are dropped here, for free, and the reason for each drop is counted so nothing disappears silently.

const { syllables, spellingRisk } = require('./spelling');

// Famous names an invented word should not sit on top of. A deliberately short, obvious list: this is a safety net for the clumsiest
// near-misses (googel, amazan), not a trade mark search. The trade mark step later is the real check.
const WELL_KNOWN = [
  'google', 'amazon', 'apple', 'microsoft', 'facebook', 'meta', 'instagram', 'twitter', 'tiktok', 'youtube', 'netflix', 'spotify', 'uber',
  'airbnb', 'tesla', 'nike', 'adidas', 'puma', 'samsung', 'sony', 'intel', 'oracle', 'adobe', 'paypal', 'stripe', 'shopify', 'canva',
  'atlassian', 'xero', 'myob', 'zoom', 'slack', 'dropbox', 'linkedin', 'pinterest', 'snapchat', 'whatsapp', 'telegram', 'reddit', 'twitch',
  'qantas', 'virgin', 'jetstar', 'telstra', 'optus', 'vodafone', 'woolworths', 'coles', 'aldi', 'kmart', 'target', 'bunnings', 'officeworks',
  'harvey', 'norman', 'jbhifi', 'ikea', 'walmart', 'costco', 'starbucks', 'mcdonalds', 'subway', 'dominos', 'kfc', 'coca', 'cola', 'pepsi',
  'fanta', 'sprite', 'nestle', 'kraft', 'heinz', 'cadbury', 'lindt', 'toyota', 'honda', 'mazda', 'ford', 'bmw', 'mercedes', 'audi', 'volvo',
  'nissan', 'hyundai', 'kia', 'rolex', 'gucci', 'prada', 'chanel', 'dior', 'lego', 'disney', 'pixar', 'marvel', 'nintendo', 'xbox',
  'playstation', 'zara', 'uniqlo', 'lululemon', 'patagonia', 'nokia', 'huawei', 'xiaomi', 'dell', 'lenovo', 'canon', 'nikon', 'fitbit',
  'garmin', 'gopro', 'kodak', 'fedex', 'dhl', 'ups', 'visa', 'mastercard', 'westpac', 'anz', 'nab', 'commbank', 'suncorp', 'medibank',
  'bupa', 'nrma', 'rac', 'chatgpt', 'openai', 'claude', 'anthropic', 'gemini', 'alexa', 'siri', 'cortana',
];

// Words that make a name sound like every other name. Whole name or either end.
const FILLER_START = ['my', 'get', 'best', 'top', 'the', 'new'];
const FILLER_END = ['hub', 'pro', 'app', 'online', 'solutions', 'group', 'global', 'inc', 'corp'];

/** A name as a domain label: lower case letters, numbers and hyphens, no hyphen at either end. */
function normalizeName(raw) {
  return String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 63);
}

/** Edit distance where swapping two neighbouring letters counts as one edit (googel / google). Gives up early once it is above `max`. */
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i += 1) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j += 1) { d[0][j] = j; }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The well-known brand a name sits on, if any: [brand, 'is' | 'near' | 'contains'] or null. */
function brandClash(name) {
  for (const b of WELL_KNOWN) {
    if (name === b) return [b, 'is'];
    if (b.length >= 5 && distance(name, b, 1) <= 1) return [b, 'near'];
  }
  for (const b of WELL_KNOWN) {
    if (b.length >= 5 && name.length > b.length && name.includes(b)) return [b, 'contains'];
  }
  return null;
}

// A name with two or more real spelling traps (ph and gh and a silent letter, say) is one people will get wrong after hearing it once.
const HARD_TO_SPELL = 40;

// Descriptive and compound names are made of real words and are naturally longer, so they get more room on length and spelling.
const lengthLimits = (brief) => {
  const styles = (brief && brief.styles) || [];
  const longOk = styles.includes('descriptive') || styles.includes('compound');
  return { min: 4, max: longOk ? 18 : 14, hard: longOk ? HARD_TO_SPELL + 15 : HARD_TO_SPELL };
};

/**
 * Filter a wide list. `items` are { name, style?, own? }. Own names (a book title, a person) are never dropped here.
 * Returns { kept, dropped } where dropped is a count by reason. Kept items gain { syllables, spell, notes } (notes: risks found).
 */
function filterCandidates(items, brief, { seen = [] } = {}) {
  const avoid = ((brief && brief.avoid) || []).map((w) => String(w).toLowerCase()).filter(Boolean);
  const { min, max, hard } = lengthLimits(brief);
  const dropped = { invalid: 0, length: 0, filler: 0, avoided: 0, hard_to_spell: 0, brand: 0, similar: 0, seen: 0 };
  const seenSet = new Set((seen || []).map(normalizeName));
  const kept = [];
  const names = new Set();

  for (const it of items || []) {
    const name = normalizeName(it && it.name);
    const own = !!(it && it.own);
    if (!name || name.length < 3) { dropped.invalid += 1; continue; }
    if (names.has(name)) continue; // an exact repeat is not worth counting
    if (!own) {
      if (!/^[a-z]+$/.test(name)) { dropped.invalid += 1; continue; }
      if (name.length < min || name.length > max) { dropped.length += 1; continue; }
      if (FILLER_START.some((w) => name.startsWith(w) && name.length > w.length + 2) && !(brief && (brief.include || []).some((i) => name.startsWith(String(i).toLowerCase())))) { dropped.filler += 1; continue; }
      if (FILLER_END.some((w) => name.endsWith(w))) { dropped.filler += 1; continue; }
      if (avoid.some((w) => name.includes(w))) { dropped.avoided += 1; continue; }
      if (seenSet.has(name)) { dropped.seen += 1; continue; }
    }
    const spell = spellingRisk(name);
    const clash = own ? null : brandClash(name);
    if (!own && clash && clash[1] !== 'contains') { dropped.brand += 1; continue; }
    if (!own && spell.score >= hard) { dropped.hard_to_spell += 1; continue; }
    names.add(name);
    const notes = [];
    if (clash && clash[1] === 'contains') notes.push(`contains the well-known name "${clash[0]}"`);
    kept.push({ ...it, name, own, style: it.style || '', syllables: syllables(name), spell, brandNotes: notes });
  }

  // too like another name in the list: keep the first, drop the later one (own names always stay)
  const out = [];
  for (const c of kept) {
    const twin = out.find((o) => !c.own && c.name.length >= 5 && distance(o.name, c.name, 1) <= 1);
    if (twin) { dropped.similar += 1; continue; }
    out.push(c);
  }
  return { kept: out, dropped };
}

/**
 * Order the kept names best first, mixing styles so the top is not all one kind. Score: easy to say and spell, a comfortable length
 * (6 to 10 letters), two or three syllables.
 */
function rankLocal(cands) {
  const score = (c) => {
    if (c.own) return 1000;
    let s = 60 - c.spell.score * 0.5;
    const len = c.name.length;
    s += len >= 6 && len <= 10 ? 12 : len >= 5 && len <= 12 ? 5 : -4;
    s += c.syllables === 2 || c.syllables === 3 ? 8 : c.syllables === 1 ? 2 : -6;
    return s;
  };
  // the person's own names keep the order they typed them in; everything else is ranked
  const sorted = [...cands.filter((c) => c.own), ...cands.filter((c) => !c.own).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))];
  // round-robin across styles, keeping each style's own order
  const byStyle = new Map();
  for (const c of sorted) {
    if (c.own) continue;
    const k = c.style || '';
    if (!byStyle.has(k)) byStyle.set(k, []);
    byStyle.get(k).push(c);
  }
  const mixed = [];
  while ([...byStyle.values()].some((l) => l.length)) {
    for (const l of byStyle.values()) if (l.length) mixed.push(l.shift());
  }
  return [...sorted.filter((c) => c.own), ...mixed];
}

/** A name with the facts the cards need, without judging it (used for variations, which are meant to look like prefixes and suffixes). */
function describe(item) {
  const name = normalizeName(item && item.name);
  return { ...item, name, own: !!(item && item.own), style: (item && item.style) || '', syllables: syllables(name), spell: spellingRisk(name), brandNotes: [] };
}

const PREFIXES = ['get', 'try', 'use', 'hello', 'meet', 'the'];
const SUFFIXES = ['ly', 'hq', 'labs', 'now', 'co', 'works'];

/**
 * Variations of a favourite, useful when its .com is taken: prefixes, suffixes, other spellings and the brief's own words joined on.
 * Deterministic, so they cost nothing to make; each still has to be checked. Returns [{ name, style: 'variation' }], at most 24.
 */
function variations(seed, brief) {
  const base = normalizeName(seed);
  if (base.length < 3) return [];
  const out = new Set();
  PREFIXES.forEach((p) => out.add(p + base));
  SUFFIXES.forEach((s) => out.add(base + s));
  // other spellings: c/k, ph/f, a final y/i/ie
  if (/c(?=[aou])/.test(base)) out.add(base.replace(/c(?=[aou])/g, 'k'));
  if (/k/.test(base)) out.add(base.replace(/k/g, 'c'));
  if (/ph/.test(base)) out.add(base.replace(/ph/g, 'f'));
  if (/f/.test(base) && !/ff/.test(base)) out.add(base.replace(/f/g, 'ph'));
  if (/y$/.test(base)) { out.add(base.replace(/y$/, 'i')); out.add(base.replace(/y$/, 'ie')); }
  if (/ie$/.test(base)) out.add(base.replace(/ie$/, 'y'));
  // joined with the brief's own words
  for (const w of ((brief && brief.include) || []).map(normalizeName).filter((x) => x.length >= 3).slice(0, 4)) {
    out.add(base + w);
    out.add(w + base);
  }
  out.delete(base);
  return [...out].filter((n) => n.length >= 4 && n.length <= 24).slice(0, 24).map((name) => ({ name, style: 'variation' }));
}

module.exports = { describe, HARD_TO_SPELL, WELL_KNOWN, normalizeName, distance, brandClash, filterCandidates, rankLocal, variations };
