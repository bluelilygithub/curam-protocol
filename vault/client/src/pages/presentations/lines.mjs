// One-item-per-line text boxes (bullets, column points). The box keeps exactly what is typed, so a space or an Enter at the end of a
// line stays put; the deck only gets the cleaned list. Before this, the box showed the cleaned list, which ate spaces and new lines.
//
//   node client/src/pages/presentations/lines.test.mjs

/** The deck's list from a box's text: one item per line, trimmed, empty lines dropped. */
export const parseLines = (text) => String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/**
 * What the box should show after the deck's list changed. Our own typing parses to the same list, so the draft stays (with its trailing
 * spaces and blank lines); a change from elsewhere (a deck opened, a slide reordered or generated) replaces it.
 */
export function syncDraft(draft, lines) {
  const joined = (Array.isArray(lines) ? lines : []).join('\n');
  return parseLines(draft).join('\n') === joined ? draft : joined;
}
