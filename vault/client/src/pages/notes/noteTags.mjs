// What a tag is, for typing feedback in the browser. The server applies the same rule when it saves
// (server/services/noteTags.js; server/routes/notes.test.js checks the two agree), so this never decides what is stored.
// Unit-tested: node client/src/pages/notes/noteTags.test.mjs

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS_PER_NOTE = 20;

/** The tag as it will be stored: trimmed, no leading #, one space between words, lowercase, no commas, at most 30 characters. */
export function normalizeTag(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f,;]/g, ' ')
    .replace(/^[#\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

/** `tags` with `value` added (normalised): the same list back if it is empty, a repeat, or the note already has 20. */
export function addTag(tags, value) {
  const list = Array.isArray(tags) ? tags : [];
  const tag = normalizeTag(value);
  if (!tag || list.includes(tag) || list.length >= MAX_TAGS_PER_NOTE) return list;
  return [...list, tag];
}

export const removeTag = (tags, tag) => (Array.isArray(tags) ? tags : []).filter((t) => t !== tag);

/** Existing tags worth offering while typing: not already on the note, containing what was typed (starts-with first), at most `limit`. */
export function suggestTags(allTags, current, typed, limit = 8) {
  const q = normalizeTag(typed);
  const have = new Set(Array.isArray(current) ? current : []);
  const names = (Array.isArray(allTags) ? allTags : []).map((t) => (typeof t === 'string' ? t : t.tag)).filter((t) => t && !have.has(t));
  const hits = q ? names.filter((t) => t.includes(q)) : names;
  hits.sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q)));
  return hits.slice(0, limit);
}

/** Split one text box's contents on commas/semicolons/new lines into tags to add (a pasted "a, b, c" becomes three). */
export function splitTags(text) {
  return String(text ?? '').split(/[,;\n]/).map(normalizeTag).filter(Boolean);
}
