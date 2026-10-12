'use strict';

/**
 * "None" style answers typed into optional free-text boxes ("Anything to work around?", "Anything else?") mean the
 * box is empty. Treating them as text let a literal "none" leak into AI prompts and then into sentences.
 */

const EMPTY_ANSWERS = new Set([
  'none', 'nil', 'n/a', 'na', 'n.a.', 'no', 'nope', 'nothing', 'not applicable', 'not really', 'no thanks',
  'no injuries', 'no injury', 'no issues', 'no problems', 'none really', 'none at all', 'nothing really',
  'nothing to add', 'nothing special', 'all good', '-', '--', '.', '?',
]);

/** True for blank text and for answers that just say there is nothing. */
function isEmptyAnswer(text) {
  if (text == null) return true;
  const t = String(text).trim().toLowerCase().replace(/[.!\s]+$/g, '').replace(/\s+/g, ' ');
  return t === '' || EMPTY_ANSWERS.has(t);
}

/** Trimmed text, capped, or null when it is empty or a "none" style answer. */
function cleanFreeText(text, max) {
  if (isEmptyAnswer(text)) return null;
  return String(text).trim().slice(0, max);
}

module.exports = { isEmptyAnswer, cleanFreeText };
