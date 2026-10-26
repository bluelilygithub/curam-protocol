'use strict';

// Topic Research: the shape of a structure verdict (a second opinion on how to structure the essay), and the strict check every answer from
// the model goes through before it is shown.
//
// A verdict is ADVICE to the writer: a view on the draft's structure, which sections to keep, merge, cut, reorder or add, what evidence is
// missing and what only the writer can supply. It never contains text to publish. The model is asked for JSON and nothing it says is believed
// without this check:
//   - a verdict paragraph and at least two recommended sections are required, otherwise the answer comes back as problems (the caller asks once
//     more, then gives up);
//   - a source number is valid only if it is a number in the list the model was given; anything else is dropped and counted;
//   - every list and length is capped, HTML tags are stripped, unknown fields are ignored; a move's action must be one of a fixed set.
// Pure code. See docs/topic-research.md.

const { clean, tidy } = require('../brief/schema');

const LIMITS = Object.freeze({
  verdict: 2000, thesis: 400, title: 160, titles: 3,
  sections: 14, heading: 150, purpose: 400, contents: 900, writerInput: 600, sourcesPerSection: 8,
  moves: 10, move: 500, evidence: 8, evidenceText: 500, risks: 8, risk: 500, outside: 6, outsideText: 500,
});
const ACTIONS = Object.freeze(['keep', 'merge', 'cut', 'reorder', 'add']);

const list = (v) => (Array.isArray(v) ? v : []);

/**
 * @param raw         the model's parsed JSON
 * @param sourceCount how many numbered sources the model was given (valid numbers are 1..sourceCount)
 * @returns {{ value, dropped: { sources }, problems: string[] }}  `problems` empty means `value` is safe to show
 */
function validateReview(raw, { sourceCount = 0 } = {}) {
  const problems = [];
  const dropped = { sources: 0 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: null, dropped, problems: ['The answer was not a JSON object.'] };

  const verdict = tidy(raw.verdict, LIMITS.verdict);
  if (!verdict) problems.push('"verdict" is missing or empty.');
  const thesis = tidy(raw.thesis, LIMITS.thesis);

  const titleOptions = [];
  for (const t of list(raw.titleOptions)) {
    const title = clean(t, LIMITS.title);
    if (title && !titleOptions.includes(title)) titleOptions.push(title);
    if (titleOptions.length >= LIMITS.titles) break;
  }

  const structure = [];
  if (!Array.isArray(raw.structure)) problems.push('"structure" must be a list of sections.');
  for (const s of list(raw.structure).slice(0, LIMITS.sections)) {
    const heading = clean(s?.heading, LIMITS.heading);
    if (!heading) continue;
    const sources = [];
    for (const n of list(s?.sources).slice(0, LIMITS.sourcesPerSection * 2)) {
      if (Number.isInteger(n) && n >= 1 && n <= sourceCount) { if (!sources.includes(n)) sources.push(n); } else dropped.sources += 1;
    }
    structure.push({
      heading,
      purpose: tidy(s?.purpose, LIMITS.purpose),
      contents: tidy(s?.contents, LIMITS.contents),
      sources: sources.slice(0, LIMITS.sourcesPerSection),
      writerInput: tidy(s?.writerInput, LIMITS.writerInput),
    });
  }
  if (Array.isArray(raw.structure) && structure.length < 2) problems.push('Recommend at least two sections, each with a heading.');

  const moves = [];
  for (const m of list(raw.moves).slice(0, LIMITS.moves)) {
    const action = ACTIONS.includes(m?.action) ? m.action : null;
    const detail = tidy(m?.detail, LIMITS.move);
    if (action && detail) moves.push({ action, detail });
  }
  const strings = (v, cap, n) => list(v).map((x) => tidy(x, cap)).filter(Boolean).slice(0, n);

  if (problems.length) return { value: null, dropped, problems };
  return {
    value: {
      verdict, thesis, titleOptions, structure, moves,
      missingEvidence: strings(raw.missingEvidence, LIMITS.evidenceText, LIMITS.evidence),
      risks: strings(raw.risks, LIMITS.risk, LIMITS.risks),
      // advice that comes from the model's own knowledge, not from the brief or the sources: shown apart and labelled, never as sourced
      fromOutside: strings(raw.fromOutside, LIMITS.outsideText, LIMITS.outside),
    },
    dropped, problems: [],
  };
}

/** Every piece of verdict text with a name for where it is (used to check nothing odd came back, e.g. in tests). */
function textFields(review) {
  const out = [{ field: 'verdict', text: review.verdict }, { field: 'thesis', text: review.thesis }];
  review.titleOptions.forEach((t, i) => out.push({ field: `title ${i + 1}`, text: t }));
  review.structure.forEach((s, i) => out.push({ field: `section ${i + 1}`, text: [s.heading, s.purpose, s.contents, s.writerInput].join(' ') }));
  (review.fromOutside || []).forEach((t, i) => out.push({ field: `outside ${i + 1}`, text: t }));
  return out.filter((x) => x.text);
}

module.exports = { validateReview, textFields, LIMITS, ACTIONS };
