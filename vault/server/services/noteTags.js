'use strict';

// Tags on notes. One rule for what a tag is, used by every route and by the AI suggestions, so "Budget", "#budget " and "budget"
// are the same tag. The browser has its own copy of the rule (client/src/pages/notes/noteTags.mjs) for instant feedback while
// typing; server/routes/notes.test.js checks the two agree. Unit-tested: node server/services/noteTags.test.js

const MAX_TAG_LENGTH = 30;
const MAX_TAGS_PER_NOTE = 20;

/** The tag as stored: trimmed, no leading #, one space between words, lowercase, no commas, at most 30 characters. '' if nothing is left. */
function normalizeTag(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f,;]/g, ' ')
    .replace(/^[#\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/**
 * A list of tags made safe: each normalised, empty ones and repeats dropped, order kept, capped at 20.
 * Returns null when `value` is not an array (so a route can answer 400 instead of guessing).
 */
function normalizeTags(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS_PER_NOTE) break;
  }
  return out;
}

module.exports = { MAX_TAG_LENGTH, MAX_TAGS_PER_NOTE, normalizeTag, normalizeTags };
