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

const STRENGTH_PATTERNS = new Set(['squat', 'hinge', 'lunge', 'push', 'pull', 'core', 'carry']);

/**
 * Plain safety lines for one session, from what is in it. Every session gets the stop rule; the rest appear only when they apply.
 * @param {{ outdoor?:boolean, exercises:{ slug:string }[] }} session
 */
function sessionSafetyLines(session, library, timeZone) {
  const lines = ['Stop if you have chest pain, dizziness or unusual breathlessness, and see your GP if it happens.'];
  const items = (session.exercises || []).map((e) => library.get(e.slug)).filter(Boolean);
  if (items.some((e) => STRENGTH_PATTERNS.has(e.pattern))) lines.push('Breathe out on the effort and do not hold your breath.');
  if (items.some((e) => (e.tags || []).includes('floor'))) lines.push('Get up slowly after floor work.');
  if (session.outdoor) {
    lines.push(timeZone === 'Australia/Brisbane'
      ? 'Take water and sun protection. In Brisbane heat and humidity choose early morning or evening, and slow down rather than push through.'
      : 'Take water and sun protection. In hot weather choose early morning or evening, and slow down rather than push through.');
  }
  if (items.some((e) => (e.tags || []).includes('pool'))) lines.push('Swim where others are around or a lifeguard is on duty, and never swim alone in open water.');
  return lines;
}

module.exports = { checkNotes, sessionSafetyLines };
