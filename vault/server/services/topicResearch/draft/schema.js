'use strict';

// Topic Research: the shape of a draft article, and the strict check every answer from the model goes through before it is trusted.
//
// A draft is built from ONE brief (never from article text) and is a starting point for the owner to edit. The model is asked for JSON, and
// nothing it says is believed without this check:
//   - each paragraph is a `fact` (a claim, which must cite at least one source that is really in the brief), a `framing` line (an opening,
//     a transition or a closing that makes no claim) or a `gap` (a place the owner has to supply something);
//   - a `fact` whose sources are not among the brief's cited sources is NOT shown as a fact: it becomes a gap marker and is counted;
//   - a `framing` line containing a digit is treated the same way (a number is a claim, and it has no source);
//   - sources are numbers in the brief's Sources list; only numbers the brief's own facts cite are valid, and they are turned into addresses here;
//   - every list and length is capped, HTML tags are stripped, unknown fields are ignored;
//   - the length must be near what was asked for, and there must be a title and at least one sourced paragraph, otherwise the answer comes
//     back as problems (the caller asks once more, then gives up).
// Pure code. See docs/topic-research.md.

const { clean, tidy } = require('../brief/schema');

const LENGTHS = Object.freeze({ short: 400, medium: 800, long: 1400 });
const DEFAULT_LENGTH = 'medium';
const LIMITS = Object.freeze({ title: 160, heading: 150, paragraph: 1200, gapNote: 600, sections: 14, paragraphs: 12, sourcesPerParagraph: 6 });
const TOO_LONG = 1.8; // times the asked length
const TOO_SHORT = 0.3;

const GAP_FOR_UNSOURCED = 'Add a sourced point here. The draft made a claim with no source from the brief, so it was left out.';

const list = (v) => (Array.isArray(v) ? v : []);
const words = (text) => String(text || '').split(/\s+/).filter(Boolean).length;

/** A paragraph's text, kept to one block of plain text (line breaks inside a paragraph become spaces). */
const paragraphText = (v) => tidy(v, LIMITS.paragraph);

/**
 * @param raw          the model's parsed JSON
 * @param allowed      Map: source number (1-based, as listed in the prompt) -> source address, only for numbers the brief's facts cite
 * @param lengthChoice 'short' | 'medium' | 'long'
 * @returns {{ value, dropped: { unsourced, sources }, words, problems: string[] }}  `problems` empty means `value` is safe to use
 */
function validateDraft(raw, { allowed, lengthChoice = DEFAULT_LENGTH } = {}) {
  const problems = [];
  const dropped = { unsourced: 0, sources: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: null, dropped, words: 0, problems: ['The answer was not a JSON object.'] };
  const sourceMap = allowed instanceof Map ? allowed : new Map();
  const target = LENGTHS[lengthChoice] || LENGTHS[DEFAULT_LENGTH];

  const title = clean(raw.title, LIMITS.title);
  if (!title) problems.push('"title" is missing or empty.');

  const sections = [];
  if (!Array.isArray(raw.sections)) problems.push('"sections" must be a list.');
  let proseWords = 0;
  let factParagraphs = 0;
  for (const s of list(raw.sections).slice(0, LIMITS.sections)) {
    const heading = clean(s?.heading, LIMITS.heading);
    const paragraphs = [];
    for (const p of list(s?.paragraphs).slice(0, LIMITS.paragraphs)) {
      const kind = p?.kind === 'fact' || p?.kind === 'framing' || p?.kind === 'gap' ? p.kind : null;
      if (!kind) continue;
      if (kind === 'gap') {
        const note = tidy(p.text, LIMITS.gapNote);
        if (note) paragraphs.push({ kind: 'gap', text: note, sources: [] });
        continue;
      }
      const text = paragraphText(p.text);
      if (!text) continue;
      if (kind === 'framing') {
        // a figure is a claim, and a framing line has no source to back it
        if (/\d/.test(text)) { dropped.unsourced += 1; paragraphs.push({ kind: 'gap', text: GAP_FOR_UNSOURCED, sources: [], demoted: true }); } else { paragraphs.push({ kind: 'framing', text, sources: [] }); proseWords += words(text); }
        continue;
      }
      const urls = new Map();
      for (const n of list(p.sources).slice(0, LIMITS.sourcesPerParagraph * 2)) {
        const url = Number.isInteger(n) ? sourceMap.get(n) : undefined;
        if (url) urls.set(url, true); else dropped.sources += 1;
      }
      const sources = [...urls.keys()].slice(0, LIMITS.sourcesPerParagraph);
      if (!sources.length) { dropped.unsourced += 1; paragraphs.push({ kind: 'gap', text: GAP_FOR_UNSOURCED, sources: [], demoted: true }); continue; }
      paragraphs.push({ kind: 'fact', text, sources });
      proseWords += words(text);
      factParagraphs += 1;
    }
    if (paragraphs.length) sections.push({ heading, paragraphs });
  }
  if (Array.isArray(raw.sections) && !factParagraphs) problems.push('No paragraph had a valid source number. Every claim needs the number of at least one listed source.');
  if (factParagraphs && proseWords > target * TOO_LONG) problems.push(`The draft is too long (${proseWords} words). Aim for about ${target} words.`);
  if (factParagraphs && proseWords < target * TOO_SHORT) problems.push(`The draft is too short (${proseWords} words). Aim for about ${target} words.`);

  if (problems.length) return { value: null, dropped, words: proseWords, problems };
  return { value: { title, sections }, dropped, words: proseWords, problems: [] };
}

/** Every piece of draft text with a name for where it is, so the overlap check can say where it found a match. */
function textFields(draft) {
  const out = [{ field: 'title', text: draft.title }];
  draft.sections.forEach((s, i) => {
    if (s.heading) out.push({ field: `heading ${i + 1}`, text: s.heading });
    s.paragraphs.forEach((p, j) => { if (p.kind !== 'gap') out.push({ field: `section ${i + 1} paragraph ${j + 1}`, text: p.text }); });
  });
  return out.filter((x) => x.text);
}

module.exports = { validateDraft, textFields, LENGTHS, DEFAULT_LENGTH, LIMITS, GAP_FOR_UNSOURCED };
