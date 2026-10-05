// Plant tag scan, part 2: from the text read off a nursery tag to the plants in the library it could be, and what the tag says about size and
// sun. Pure (no OCR, no DOM) so it is tested with realistic, noisy text.
//
// What it will not do: decide. It ranks candidates and says why each one fits; the person picks. A plant that is not in the library is
// not guessed at. And the tag's size and sun are shown NEXT TO our draft data (which is unverified), never written over it.
import type { PlantRecord, Sun } from './types';

export type MatchConfidence = 'strong' | 'possible' | 'weak';
export interface TagMatch { plant: PlantRecord; score: number; confidence: MatchConfidence; reasons: string[] }
export interface TagFacts { height?: [number, number]; spread?: [number, number]; sun?: Sun[] }

const strip = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Words of the text, lower case, accents and punctuation gone ("Robyn Gordon'" -> robyn gordon). One-letter words are noise, except a hybrid sign. */
export function tokens(text: string): string[] {
  return strip(text).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 || w === 'x');
}
const words = (s: string): string[] => tokens(s).filter((w) => w !== 'x'); // for plant names: the hybrid sign is not a word to match

/** Edit distance, stopping early once it is past `max`. */
function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How many letters a word may be off by (a camera misreads l/1/i, rn/m, 0/o): none for short words, one for medium, two for long. */
const allowed = (w: string): number => (w.length <= 4 ? 0 : w.length <= 8 ? 1 : 2);

interface Found { dist: number }
/** Is this phrase in the text, word after word? Returns the smallest total edit distance, or null. */
function findPhrase(text: string[], phrase: string[]): Found | null {
  if (!phrase.length || text.length < phrase.length) return null;
  let best: Found | null = null;
  for (let i = 0; i + phrase.length <= text.length; i += 1) {
    let total = 0;
    let ok = true;
    for (let k = 0; k < phrase.length; k += 1) {
      const d = distance(text[i + k], phrase[k], allowed(phrase[k]));
      if (d > allowed(phrase[k])) { ok = false; break; }
      total += d;
    }
    if (ok && (!best || total < best.dist)) best = { dist: total };
  }
  return best;
}

const GENERIC = new Set(['native', 'garden', 'plant', 'tree', 'shrub', 'common', 'australian', 'dwarf', 'red', 'white', 'blue', 'green', 'pink', 'golden', 'giant', 'lily']);

/** Rank the library against the text from a tag. Best first; nothing under 30 is returned. */
export function matchTag(text: string, plants: readonly PlantRecord[], limit = 6): TagMatch[] {
  const t = tokens(text).filter((w) => w !== 'x'); // a hybrid sign on the tag is not a word to match
  if (t.length === 0) return [];
  const out: TagMatch[] = [];
  for (const p of plants) {
    const bw = words(p.botanical);
    const genus = bw[0];
    const species = bw[1];
    const cultivar = p.cultivar ? words(p.cultivar) : [];
    const reasons: string[] = [];
    const signals: number[] = [];

    const genusHit = genus ? findPhrase(t, [genus]) : null;
    const cultivarHit = cultivar.length ? findPhrase(t, cultivar) : null;

    if (species) {
      const hit = findPhrase(t, [genus, species]);
      if (hit) {
        let s = hit.dist === 0 ? 100 : 85;
        reasons.push(hit.dist === 0 ? `The botanical name ${p.botanical} is on the tag` : `Reads like the botanical name ${p.botanical} (a letter or two unclear)`);
        // a named variety of this species: the tag should name it too, otherwise the plain species is the better answer
        if (cultivar.length) {
          if (cultivarHit) { s += 10; reasons.push(`and the variety '${p.cultivar}'`); } else s -= 15;
        }
        signals.push(s);
      }
    } else if (genus && cultivar.length) {
      // a variety known only by genus + name (Grevillea 'Robyn Gordon')
      if (genusHit && cultivarHit) { signals.push(cultivarHit.dist === 0 && genusHit.dist === 0 ? 95 : 80); reasons.push(`The variety '${p.cultivar}' of ${p.botanical} is on the tag`); }
      else if (cultivarHit && (cultivar.length > 1 || cultivar.join('').length >= 7)) { signals.push(cultivarHit.dist === 0 ? 60 : 50); reasons.push(`The variety name '${p.cultivar}' is on the tag`); }
    } else if (genus) {
      const hit = findPhrase(t, [genus]);
      if (hit) { signals.push(hit.dist === 0 ? 90 : 75); reasons.push(`The name ${p.botanical} is on the tag`); }
    }

    // common names
    let commonBest = 0;
    let commonText = '';
    for (const c of p.common) {
      const cw = words(c);
      if (!cw.length || cw.join('').length < 4) continue;
      const hit = findPhrase(t, cw);
      if (!hit) {
        // a short search ("lilly pilly", "lavender") is part of a longer common name ("Weeping lilly pilly"): worth offering, not worth trusting
        if (t.length <= 3 && cw.length > t.length && !(t.length === 1 && GENERIC.has(t[0])) && t.join('').length >= 5) {
          for (let i = 0; i + t.length <= cw.length; i += 1) {
            if (t.every((w, k) => distance(w, cw[i + k], allowed(cw[i + k])) <= allowed(cw[i + k]))) { if (commonBest < 40) { commonBest = 40; commonText = c; } break; }
          }
        }
        continue;
      }
      const multi = cw.length > 1;
      const weakWord = !multi && GENERIC.has(cw[0]);
      const s = multi ? (hit.dist === 0 ? 75 : 65) : weakWord ? 28 : hit.dist === 0 ? 45 : 35;
      if (s > commonBest) { commonBest = s; commonText = c; }
    }
    if (commonBest) { signals.push(commonBest); reasons.push(`Matches the common name '${commonText}'`); }

    // just the genus, for a species-level plant: a hint, never an answer
    if (!signals.length && genus && species && genusHit) { signals.push(30); reasons.push(`Only the genus ${p.botanical.split(' ')[0]} matched, not the species`); }

    if (!signals.length) continue;
    const top = Math.max(...signals);
    const score = Math.min(110, top + (signals.length > 1 ? 5 * (signals.length - 1) : 0));
    if (score < 30) continue;
    out.push({ plant: p, score, confidence: score >= 85 ? 'strong' : score >= 55 ? 'possible' : 'weak', reasons });
  }
  out.sort((a, b) => b.score - a.score || (a.plant.common[0] ?? a.plant.botanical).localeCompare(b.plant.common[0] ?? b.plant.botanical));
  return out.slice(0, limit);
}

/**
 * True when the person really must choose: the best match is not a strong one (a common name, a variety on its own, a genus) and other plants
 * fit too. A botanical name on the tag is an answer; "lilly pilly" is a question.
 */
export function isAmbiguous(m: TagMatch[]): boolean {
  return m.length > 1 && m[0].score < 85;
}

// ---------------------------------------------------------------- what the tag says about size and sun
const NUM = '(\\d+(?:[.,]\\d+)?)';
const RANGE = `${NUM}(?:\\s*(?:-|–|—|to)\\s*${NUM})?`;
const toNum = (s: string): number => Number(s.replace(',', '.'));

function metres(a: string, b: string | undefined, unit: string): [number, number] | null {
  const k = unit === 'cm' ? 0.01 : 1;
  const lo = toNum(a) * k, hi = (b ? toNum(b) : toNum(a)) * k;
  const r: [number, number] = lo <= hi ? [lo, hi] : [hi, lo];
  return r[0] >= 0.03 && r[1] <= 60 ? r : null;
}

/** Height, spread and sun as the tag states them. Anything not clearly stated is left out. */
export function parseTagFacts(text: string): TagFacts {
  const s = strip(text).replace(/\s+/g, ' ');
  const facts: TagFacts = {};
  const unit = '(cm|m|mtr|metres?|meters?)\\b';
  const u = (x: string): string => (x === 'cm' ? 'cm' : 'm');

  // "1.5 x 1 m", "1.5m x 1m": height first, then width
  const pair = new RegExp(`${NUM}\\s*(cm|m)?\\s*[x×]\\s*${NUM}\\s*${unit}`).exec(s);
  if (pair) {
    const second = u(pair[4]);
    const first = pair[2] ? u(pair[2]) : second;
    const h = metres(pair[1], undefined, first), w = metres(pair[3], undefined, second);
    if (h && w) { facts.height = h; facts.spread = w; }
  }
  const h1 = new RegExp(`(?:height|tall|high|\\bh)\\s*[:=]?\\s*(?:up to\\s*|to\\s*|approx\\.?\\s*)?${RANGE}\\s*${unit}`).exec(s);
  const h2 = new RegExp(`${RANGE}\\s*${unit}\\s*(?:high|tall|height)`).exec(s);
  const w1 = new RegExp(`(?:width|wide|spread|\\bw)\\s*[:=]?\\s*(?:up to\\s*|to\\s*|approx\\.?\\s*)?${RANGE}\\s*${unit}`).exec(s);
  const w2 = new RegExp(`${RANGE}\\s*${unit}\\s*(?:wide|width|spread)`).exec(s);
  if (!facts.height) { const m = h1 ?? h2; if (m) { const r = metres(m[1], m[2], u(m[3])); if (r) facts.height = r; } }
  if (!facts.spread) { const m = w1 ?? w2; if (m) { const r = metres(m[1], m[2], u(m[3])); if (r) facts.spread = r; } }

  const sun: Sun[] = [];
  if (/full sun/.test(s)) sun.push('full_sun');
  if (/(part|partial|semi|dappled|filtered)[ -]?(shade|sun)/.test(s)) sun.push('part_shade');
  if (/(^|[^a-z])(full |deep )?shade\b/.test(s.replace(/(part|partial|semi)[ -]?shade/g, '')) && !/full sun.*shade|shade.*full sun/.test(s)) sun.push('shade');
  if (sun.length) facts.sun = [...new Set(sun)];
  return facts;
}

const fmtRange = (r: [number, number]): string => (r[0] === r[1] ? `${round(r[0])} m` : `${round(r[0])} to ${round(r[1])} m`);
const round = (n: number): string => String(Math.round(n * 100) / 100);

/** Where the tag and our (draft, unverified) data disagree. Informational: tags describe a typical specimen, and ours is a draft. */
export function compareFacts(plant: PlantRecord, facts: TagFacts): string[] {
  const notes: string[] = [];
  const off = (tag: [number, number], ours: [number, number]): boolean => tag[1] > ours[1] * 1.4 + 0.2 || tag[1] < ours[0] * 0.6 - 0.2;
  if (facts.height && off(facts.height, plant.height)) notes.push(`The tag says ${fmtRange(facts.height)} high; our draft data says ${fmtRange(plant.height)}.`);
  if (facts.spread && off(facts.spread, plant.spread)) notes.push(`The tag says ${fmtRange(facts.spread)} wide; our draft data says ${fmtRange(plant.spread)}.`);
  if (facts.sun && !facts.sun.every((x) => plant.sun.includes(x))) {
    const name = (x: Sun): string => x.replace('_', ' ');
    notes.push(`The tag says ${facts.sun.map(name).join(' or ')}; our draft data says ${plant.sun.map(name).join(' or ')}.`);
  }
  return notes;
}
