'use strict';

// Topic Research: did the brief copy a source? Every run of RUN words or more in the brief's text that also appears, in the same order, in the
// text of a ticked article (its page text, snippet or headline) is reported with where it was found and which source it matches.
// Words are compared without case, punctuation or spacing, so a copied sentence with a changed comma still counts. A short quotation under
// RUN words is allowed (the brief's rules allow one short phrase per source, attributed). Pure code. See docs/topic-research.md.

const RUN = 12;
const EXCERPT_WORDS = 14; // what is shown of a match: never more than a short excerpt

const normaliseWords = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * @param fields   [{ field, text }] the brief's text, named by where it is (schema.textFields)
 * @param sources  [{ url, title, texts: string[] }] each ticked article; every text is compared on its own, never joined to the next
 * @returns [{ field, words, excerpt, sourceUrl, sourceTitle }] one entry per copied stretch
 */
function findOverlaps(fields, sources, { run = RUN } = {}) {
  const index = new Map(); // run-word string -> the first source that contains it
  for (const s of sources) {
    for (const text of s.texts || []) {
      const w = normaliseWords(text);
      for (let i = 0; i + run <= w.length; i += 1) {
        const key = w.slice(i, i + run).join(' ');
        if (!index.has(key)) index.set(key, s);
      }
    }
  }
  const findings = [];
  if (!index.size) return findings;
  for (const { field, text } of fields) {
    const w = normaliseWords(text);
    let i = 0;
    while (i + run <= w.length) {
      const hit = index.get(w.slice(i, i + run).join(' '));
      if (!hit) { i += 1; continue; }
      // extend the match for as long as the next window is also a copy of the same source, then report it once
      let end = i + run;
      while (end < w.length && index.get(w.slice(end - run + 1, end + 1).join(' ')) === hit) end += 1;
      findings.push({ field, words: end - i, excerpt: w.slice(i, i + EXCERPT_WORDS).join(' '), sourceUrl: hit.url, sourceTitle: hit.title || '' });
      i = end;
    }
  }
  return findings;
}

module.exports = { findOverlaps, normaliseWords, RUN };
