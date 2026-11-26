'use strict';

// One round, all its pages: where each request line stands. Pure. Since milestone 4b a line may belong to a page (only that page's
// changes count for it) or to none (every page's changes count); matching runs per page with that page's lines and the lines with no page.
//   held                 Held over: shown, never checked
//   kept | keepChanged | keepNotOnStartingPage | keepNotRead     a Keep line (keeps.js)
//   linked               at least one change, on a page in its scope, is linked to it (links: [{ pageId, changeId }])
//   noChange             matched, and no change on any page in its scope answers it
//   unreadable           the AI's answer for it could not be read on every page it was sent with
//   notMatched           Match to request has not been run on a page in its scope yet
// Only request_line lines are sent to the model (scopedItems).

const KEEP_STATUS = { kept: 'kept', changed: 'keepChanged', notOnStartingPage: 'keepNotOnStartingPage', notRead: 'keepNotRead' };

/** The lines a page is matched with: its own request lines and the request lines with no page. */
const scopedItems = (items, pageId) => items.filter((it) => (it.kind || 'request_line') === 'request_line' && (it.pageId == null || it.pageId === pageId));

/**
 * `items`: the job's lines; `pages`: [{ pageId, matches }] for the round's ready pages; `keepOf(item)` -> { status, pageIds } (keeps.js).
 * Returns [{ ref, kind, status, links?, pageIds? }] in the lines' order.
 */
function lineStatuses(items, pages, keepOf) {
  return items.map((it) => {
    const kind = it.kind || 'request_line';
    if (kind === 'held_over') return { ref: it.ref, kind, status: 'held' };
    if (kind === 'keep') { const k = keepOf(it); return { ref: it.ref, kind, status: KEEP_STATUS[k.status], pageIds: k.pageIds }; }
    const scope = pages.filter((p) => it.pageId == null || p.pageId === it.pageId);
    const answers = scope.map((p) => ({ pageId: p.pageId, a: p.matches?.items?.[it.ref] })).filter((x) => x.a);
    if (!answers.length) return { ref: it.ref, kind, status: 'notMatched' };
    const links = answers.flatMap((x) => (x.a.changeIds || []).map((changeId) => ({ pageId: x.pageId, changeId })));
    if (links.length) return { ref: it.ref, kind, status: 'linked', links };
    return { ref: it.ref, kind, status: answers.every((x) => x.a.unreadable) ? 'unreadable' : 'noChange' };
  });
}

module.exports = { lineStatuses, scopedItems };
