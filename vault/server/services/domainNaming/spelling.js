'use strict';

// How hard is a name to say, hear and spell? Pure code, no network. Used to drop names nobody could type after hearing them once, to
// fill the "hard to spell when heard" note on a card, and as the data behind the "hide hard-to-spell names" filter.
//
// This is a set of rules about English sounds, not a judgement of taste: every note it gives is a specific, checkable reason
// ("could be spelled with a k or a c"), so a person can disagree with it.

/** A rough syllable count: groups of vowels (y counts), less a silent final e. Always at least 1. */
function syllables(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 0;
  const groups = s.match(/[aeiouy]+/g) || [];
  let n = groups.length;
  if (n > 1 && /[^aeiouy]e$/.test(s) && !/(le|ee)$/.test(s)) n -= 1;
  return Math.max(1, n);
}

// [pattern, points, note]. Points add up (capped at 100): 0 is easy to say and spell, 100 is a name people will get wrong.
const RULES = [
  [/^c[aou]|^k/, 14, 'could start with a k or a c'],
  [/^q/, 10, 'starts with q, which is often written k or kw'],
  [/ph/, 14, 'ph sounds like f'],
  [/(?<!p)f(?!f)/, 4, 'f can also be written ph'],
  [/ck|[^c]k$/, 8, 'k, ck and c can sound the same'],
  [/^kn|^wr|^gn|^ps/, 14, 'starts with a silent letter'],
  [/gh/, 14, 'gh is silent or sounds like f'],
  [/z/, 6, 'z can also be written s'],
  [/(?<![aeiou])s(?=[aeiou])|c(?=[ei])/, 6, 's and soft c sound the same'],
  [/(ee|ea|ie|ei)/, 10, 'ee can be written ee, ea or ie'],
  [/(ai|ay|ei|ey)/, 8, 'the "ay" sound has several spellings'],
  [/(oo|ou|ew|ue|u_e)/, 8, 'the "oo" sound has several spellings'],
  [/(io|eo)$/, 10, 'ending could be -io or -eo'],
  [/[aeiou]{3,}/, 12, 'three vowels in a row are hard to read aloud'],
  [/[^aeiouy]{4,}/, 14, 'a run of consonants is hard to say'],
  [/(.)\1{2,}/, 10, 'a repeated letter looks like a typo'],
  [/(er|ur|ir|or|ar)$/, 6, 'final -er, -ur or -ir sound alike'],
  [/(i|y)$/, 6, 'ending -i, -y or -ie sound alike'],
  [/(a|ah)$/, 4, 'ending -a or -ah sound alike'],
  [/x/, 6, 'x can be written ks'],
  [/que$|tique$/, 10, 'a final -que sounds like k'],
];

/**
 * @returns {{ score: number, notes: string[] }} score 0 (easy) to 100 (hard); notes are the reasons, strongest first (at most 3).
 */
function spellingRisk(name) {
  const raw = String(name || '').toLowerCase();
  const s = raw.replace(/[^a-z0-9-]/g, '');
  let score = 0;
  const hits = [];
  if (/[0-9]/.test(s)) { score += 25; hits.push([25, 'has a number, which is awkward to say aloud']); }
  if (/-/.test(s)) { score += 15; hits.push([15, 'has a hyphen, which people forget when typing']); }
  const letters = s.replace(/[^a-z]/g, '');
  for (const [re, pts, note] of RULES) {
    if (re.test(letters)) { score += pts; hits.push([pts, note]); }
  }
  if (letters.length > 14) { score += 8; hits.push([8, 'long names are easy to mistype']); }
  if (syllables(letters) > 4) { score += 8; hits.push([8, 'more than four syllables is a lot to say']); }
  hits.sort((a, b) => b[0] - a[0]);
  return { score: Math.min(100, score), notes: hits.slice(0, 3).map((h) => h[1]) };
}

module.exports = { syllables, spellingRisk };
