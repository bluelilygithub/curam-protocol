'use strict';

// Keep lines ("Keep: George established himself …"): text the client wants left exactly as it is. Code only, no model: the text (as
// compared: spaces and quotes evened out, case and dashes kept) must be on the page at the starting point and still there now.
//   kept              on the starting page and still on the page
//   changed           on the starting page, but no longer found word for word: changed or removed (a warning)
//   notRead           the page(s) that had it were not read in this round
//   notOnStartingPage not found on the starting page either: the wording in the request may differ from the page, so it cannot be checked
// A Keep line with a page is checked on that page; one with no page on every page of the job (kept if any page that had it still has it).

const { normalizeText } = require('./extract');

const pageText = (snapshot) => (snapshot ? normalizeText((snapshot.blocks || []).map((b) => b.text).join(' ')) : '');

/** `pages`: [{ pageId, baseline: snapshot | null, current: snapshot | null }]. Returns { status, pageIds } for one Keep line. */
function keepStatus(lineText, pageId, pages) {
  const want = normalizeText(lineText);
  const scope = pages.filter((p) => pageId == null || p.pageId === pageId);
  const had = scope.filter((p) => want && pageText(p.baseline).includes(want));
  if (!had.length) return { status: 'notOnStartingPage', pageIds: [] };
  const read = had.filter((p) => p.current); // a page not read in this round has nothing to say yet
  if (!read.length) return { status: 'notRead', pageIds: had.map((p) => p.pageId) };
  const gone = read.filter((p) => !pageText(p.current).includes(want));
  return gone.length ? { status: 'changed', pageIds: gone.map((p) => p.pageId) } : { status: 'kept', pageIds: read.map((p) => p.pageId) };
}

module.exports = { keepStatus };
