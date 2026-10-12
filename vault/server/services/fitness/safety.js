'use strict';

/**
 * Keyword safety check on free-text notes. Code, not AI: predictable and testable.
 *
 * Result never eases anything by itself. It tells the caller what to show; the user confirms easing.
 * Chest and dizziness symptoms also suggest seeing a GP. Pain suggests a GP only if it persists.
 */

const NEGATED = /\b(no|not|never|without|free of|zero)\s+(any\s+)?(chest\s+)?(pain|aches?|dizziness|dizzy|numbness|swelling)\b|\bpain[- ]free\b|\bnothing hurts\b/gi;

const RULES = [
  {
    flag: 'chest',
    re: /\bchest\s+(pain|tight(ness)?|pressure|discomfort)\b|\btight(ness)?\s+in\s+(my\s+|the\s+)?chest\b|\bangina\b|\bpalpitations?\b|\bheart\s+(pain|racing|pounding|flutter)\w*/i,
  },
  {
    flag: 'dizzy',
    re: /\bdizz(y|iness)\b|\blight[- ]?headed\b|\bfaint(ed|ing)?\b|\bblack(ed)?[- ]?out\b|\bpassed out\b/i,
  },
  {
    flag: 'pain',
    re: /\b(pain|painful|hurts?|hurting|sharp|aching|aches?|swollen|swelling|numb(ness)?|tingling)\b/i,
  },
];

/**
 * @param {...string} texts free-text fields to scan
 * @returns {{ flags: string[], suggestGp: boolean, offerEase: boolean, message: string|null }}
 */
function checkNotes(...texts) {
  const joined = texts.filter((t) => typeof t === 'string' && t.trim()).join(' \n ');
  if (!joined) return { flags: [], suggestGp: false, offerEase: false, message: null };
  const scrubbed = joined.replace(NEGATED, ' ');
  const flags = RULES.filter((r) => r.re.test(scrubbed)).map((r) => r.flag);
  if (!flags.length) return { flags: [], suggestGp: false, offerEase: false, message: null };

  const gpFirst = flags.includes('chest') || flags.includes('dizzy');
  let message;
  if (flags.includes('chest')) {
    message = 'You mentioned chest symptoms. It is worth seeing your GP before starting a new program. We can also keep the first weeks gentle if you would like.';
  } else if (flags.includes('dizzy')) {
    message = 'You mentioned dizziness or feeling faint. It is worth mentioning to your GP. We can keep the first weeks gentle if you would like.';
  } else {
    message = 'You mentioned some pain or discomfort. We can keep the first weeks gentle and work around it. If it lingers or gets worse, a GP or physio is a good next step.';
  }
  return { flags, suggestGp: gpFirst, offerEase: true, message };
}

module.exports = { checkNotes };
