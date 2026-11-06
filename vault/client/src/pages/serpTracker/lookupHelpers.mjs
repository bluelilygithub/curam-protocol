// SERP Tracker Lookup: small pure helpers for the page, so `node client/src/pages/serpTracker/lookupHelpers.test.mjs` can check them.

/** A link from a search result is only ever opened if it is a plain web address (never javascript: or data:). */
export function safeHref(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

/** "Not in the top 20" / "#3" for a saved lookup row. */
export function positionText(l) {
  if (!l || l.myStatus == null) return 'No site set';
  if (l.myStatus === 'ranked') return `#${l.myPosition}`;
  const n = /^not_in_top_(\d+)$/.exec(l.myStatus);
  return n ? `Not in top ${n[1]}` : 'Not ranked';
}

/** US dollars; four places under 10 cents, because one search costs a fraction of a cent to a few cents. */
export function costText(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return 'US$0.00';
  return v < 0.1 ? `US$${v.toFixed(4)}` : `US$${v.toFixed(2)}`;
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
