// A gentle warning for music descriptions that say what they do NOT want ("no electronic sounds", "without drums").
// A music model reads the words it is given as things to include, so naming a sound pulls the music towards it even after
// "no". Pure, so it is unit-tested (node client/src/pages/music/promptTips.test.mjs).

const NEGATION = /\b(?:no|not|without|avoid|never|don'?t|non-?)\s+(?:any\s+|a\s+|an\s+|the\s+|of\s+)?([a-z][a-z-]{2,})/gi;

/** The words that follow "no", "without" and similar in `text` (lower case, no repeats, at most three). */
export function negatedWords(text) {
  const found = [];
  for (const m of String(text || '').matchAll(NEGATION)) {
    const w = m[1].toLowerCase();
    if (!found.includes(w)) found.push(w);
    if (found.length === 3) break;
  }
  return found;
}

/** A short tip when the description names things it does not want; null when it does not. */
export function negationTip(text) {
  const words = negatedWords(text);
  if (!words.length) return null;
  const quoted = words.map((w) => `“${w}”`).join(', ');
  return `Tip: naming a sound you don't want can pull the music towards it. ${quoted} may come through even after “no”. `
    + 'Describe what you do want instead, for example “solo cello, warm and slow, spacious”.';
}
