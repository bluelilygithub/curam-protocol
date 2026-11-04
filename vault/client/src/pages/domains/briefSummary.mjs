// The brief in one plain sentence, shown at the top of the results so it is always clear what the names were made for.
// "Short invented names, playful but premium, .com.au required."

import { STYLES, TONES, PLATFORMS } from './constants.mjs';

const label = (id) => (STYLES.find((s) => s[0] === id) || [id, id])[1];
const platformLabel = (id) => (PLATFORMS.find((p) => p[0] === id) || [id, id])[1];

const joinWords = (list) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** The tone sliders that are off the middle, as plain words ("playful", "very premium"). */
export function toneWords(tone) {
  const out = [];
  for (const [key, low, high] of TONES) {
    const v = Number((tone || {})[key]) || 3;
    if (v === 3) continue;
    out.push(`${Math.abs(v - 3) === 2 ? 'very ' : ''}${v < 3 ? low : high}`);
  }
  return out;
}

export function briefSummary(brief) {
  const b = brief || {};
  const parts = [];
  const styles = (b.styles || []).map(label);
  if (styles.length) parts.push(`${joinWords(styles.map((s, i) => (i === 0 ? s : s.toLowerCase())))} names`);
  else parts.push('Names in any style');
  const tone = toneWords(b.tone);
  if (tone.length) parts.push(tone.length === 2 ? `${tone[0]} but ${tone[1]}` : joinWords(tone));
  if ((b.include || []).length) parts.push(`built around ${joinWords(b.include)}`);
  if ((b.avoid || []).length) parts.push(`avoiding ${joinWords(b.avoid)}`);
  const req = b.required || {};
  const tlds = (req.tlds || []).map((t) => `.${t}`);
  const plats = (req.platforms || []).map(platformLabel);
  if (tlds.length) parts.push(`${joinWords(tlds)} required`);
  if (plats.length) parts.push(`free on ${joinWords(plats)}`);
  const ownCount = String(b.own || '').split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean).length;
  let text = `${parts.join(', ')}.`;
  if (ownCount) text += ` Includes ${ownCount === 1 ? 'your own name' : `your ${ownCount} own names`}.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
