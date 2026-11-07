// SERP Tracker Lookup: small pure helpers for the page, so `node client/src/pages/serpTracker/lookupHelpers.test.mjs` can check them.

/** A link from a search result is only ever opened if it is a plain web address (never javascript: or data:). */
export function safeHref(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

/** "Not in the top 20" / "#3" / "#118 (page 12)" for a saved lookup row. Page 1 is not worth saying. */
export function positionText(l) {
  if (!l || l.myStatus == null) return 'No site set';
  if (l.myStatus === 'ranked') return l.myPage > 1 ? `#${l.myPosition} (page ${l.myPage})` : `#${l.myPosition}`;
  const n = /^not_in_top_(\d+)$/.exec(l.myStatus);
  if (n && l.complete === false && Number.isInteger(l.checked)) return `Not in first ${l.checked}`; // a short answer: say how many were really checked
  return n ? `Not in top ${n[1]}` : 'Not ranked';
}

/** US dollars; four places under 10 cents, because one search costs a fraction of a cent to a few cents. */
export function costText(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return 'US$0.00';
  return v < 0.1 ? `US$${v.toFixed(4)}` : `US$${v.toFixed(2)}`;
}

/** What a search is expected to cost before it is made: US$ per 10 results plus the AI summary, from the server's price list (`status.pricing`). */
export function estimateCost(depth, aiOverview, pricing) {
  if (!pricing || pricing.perTenResultsUsd == null || pricing.aiOverviewUsd == null) return null; // no price list: "unknown", never "free"
  const per = Number(pricing.perTenResultsUsd);
  const ai = Number(pricing.aiOverviewUsd);
  if (!Number.isFinite(per) || !Number.isFinite(ai)) return null;
  return Math.ceil(Number(depth) / 10) * per + (aiOverview ? ai : 0);
}

/** "about page 12": 10 organic results a page, so position 118 is page 12. */
export function pageText(position) {
  return Number.isInteger(position) && position > 0 ? `page ${Math.ceil(position / 10)}` : '';
}

/** Selection state for the saved list: toggling one, and "select all" that selects all or, when all are already picked, none. */
export function toggleOne(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export function toggleAll(selected, ids) {
  return ids.length > 0 && ids.every((id) => selected.has(id)) ? new Set() : new Set(ids);
}
/** Keep only ids that still exist (after a delete or a reload). */
export function pruneSelection(selected, ids) {
  const keep = new Set(ids);
  return new Set([...selected].filter((id) => keep.has(id)));
}

/** The sentence for the message after a delete. */
export function deletedMessage(n, days = 30) {
  return `${n} lookup${n === 1 ? '' : 's'} deleted. Kept ${days} days.`;
}

/** What an item in the page layout is called. */
const LAYOUT_NAMES = {
  organic: 'Results', paid: 'Ads', ai_overview: 'AI summary', people_also_ask: 'People also ask', local_pack: 'Map results',
  featured_snippet: 'Featured answer', knowledge_graph: 'Knowledge panel', images: 'Images', video: 'Videos', related_searches: 'Related searches',
  top_stories: 'Top stories', shopping: 'Shopping', carousel: 'Carousel', answer_box: 'Answer box',
};
export function layoutName(type) {
  return LAYOUT_NAMES[type] || String(type || '').replace(/_/g, ' ');
}
/** The page layout as an ordered list of [name, count] where neighbouring items of one kind are grouped (ten results in a row = "Results x10"). */
export function groupLayout(layout) {
  const out = [];
  for (const it of layout || []) {
    const name = layoutName(it.type);
    const last = out[out.length - 1];
    if (last && last.name === name) last.count += 1; else out.push({ name, count: 1 });
  }
  return out;
}

/**
 * The line saying how many times a search was read when the site was looked for more than once (a miss is read again, up to three times: see
 * server/services/serpTracker/reads.js). `reads` is [{ position, organic }]; nothing is said for a single read or an older saved lookup.
 */
export function readsText(reads) {
  const list = Array.isArray(reads) ? reads : [];
  if (list.length < 2) return '';
  const found = list.filter((r) => r && r.position != null);
  if (!found.length) return `Read ${list.length} times and the site was not found on any of them, so this "not found" is more reliable than a single read.`;
  const best = Math.min(...found.map((r) => r.position));
  return `Read ${list.length} times: the site was found on ${found.length} of them, and the best position (#${best}) is the one shown. Google sometimes serves a page that leaves a site out.`;
}
