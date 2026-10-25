// Topic Research: small display helpers, kept apart from the page so they can be tested without a browser.

/** "25 Oct 2026", or "No date" when a feed did not say. */
export function formatDate(iso, locale = 'en-AU') {
  if (!iso) return 'No date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'No date';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", or a date after two weeks. */
export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 14) return `${days} days ago`;
  return formatDate(iso);
}

/** Words for a run's status, and whether to draw attention to it. */
export function statusLabel(status) {
  if (status === 'ok') return { text: 'All sources answered', level: 'good' };
  if (status === 'partial') return { text: 'Some sources failed', level: 'warn' };
  if (status === 'failed') return { text: 'Nothing could be searched', level: 'bad' };
  if (status === 'running') return { text: 'Searching', level: 'info' };
  return { text: 'No search yet', level: 'info' };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One line for a source's chip on the Results page: "Hacker News 5", "GDELT news 30 (saved from earlier)", "Reddit: nothing". */
export function sourceChip(s) {
  if (!s) return '';
  if (s.answered === 0) return `${s.label}: did not answer`;
  return `${s.label} ${s.count}${s.cached ? ' (saved from earlier)' : ''}`;
}

/** The small facts to show beside an article, from the numbers its sources gave: [{ id, text }]. */
export function signalBadges(signals, sourceLabels = {}) {
  const s = signals && typeof signals === 'object' ? signals : {};
  const out = [];
  if (Number.isFinite(s.hn_points) && (s.hn_points > 0 || s.hn_comments > 0)) out.push({ id: 'hn', text: `Hacker News: ${plural(s.hn_points, 'point', 'points')}, ${plural(s.hn_comments || 0, 'comment', 'comments')}` });
  if (Number.isFinite(s.reddit_score)) out.push({ id: 'reddit', text: `Reddit: score ${s.reddit_score}, ${plural(s.reddit_comments || 0, 'comment', 'comments')}` });
  if (Number.isFinite(s.serp_rank)) out.push({ id: 'rank', text: `${s.serp_provider === 'brave' ? 'Brave' : 'Google'} #${s.serp_rank}` });
  if (s.serp_top_story) out.push({ id: 'top', text: 'In Google Top stories' });
  const others = (Array.isArray(s.seenIn) ? s.seenIn : []).map((id) => sourceLabels[id]).filter(Boolean);
  if (others.length > 1) out.push({ id: 'seen', text: `Found by ${others.join(', ')}` });
  return out;
}

export const MAX_BRIEF_ARTICLES = 12;
export const DEFAULT_TICKED = 10;

/** The articles ticked to begin with: the best ten (the list arrives best first). */
export const defaultSelection = (articles, max = DEFAULT_TICKED) => new Set((articles || []).slice(0, max).map((a) => a.id));

/** Tick or untick one article; ticking a thirteenth is refused (the same Set comes back). */
export function toggleSelection(selected, id, max = MAX_BRIEF_ARTICLES) {
  const next = new Set(selected);
  if (next.has(id)) { next.delete(id); return next; }
  if (next.size >= max) return selected;
  next.add(id);
  return next;
}

/** What to say under the ticked articles: { text, ok } (ok = a brief can be made). */
export function selectionNote(count) {
  if (count <= 0) return { text: 'Tick at least one article to write a brief from.', ok: false };
  if (count > MAX_BRIEF_ARTICLES) return { text: `Tick at most ${MAX_BRIEF_ARTICLES} articles.`, ok: false };
  if (count < 3) return { text: `${count} ticked. A brief from one or two articles will mostly restate them.`, ok: true };
  return { text: `${count} articles ticked.`, ok: true };
}

/** "Single source" or "3 outlets" for a fact. */
export const factLabel = (fact) => (fact?.singleSource ? 'Single source' : `${fact?.outletCount ?? 0} outlets`);

/** One sentence for the warning box when the brief repeats a source; '' when it does not. */
export function overlapWarning(overlap) {
  const n = Array.isArray(overlap) ? overlap.length : 0;
  if (!n) return '';
  return `${n === 1 ? 'One place in this brief repeats' : `${n} places in this brief repeat`} wording from a source. Rewrite ${n === 1 ? 'it' : 'them'} in your own words before you use ${n === 1 ? 'it' : 'them'}.`;
}

/** What a brief cost, roughly, for a small note. */
export function costText(usd) {
  const n = Number(usd) || 0;
  if (n <= 0) return '';
  if (n < 0.01) return 'under 1 cent';
  return `about $${n.toFixed(2)}`;
}

/** The five things a result is ranked on, in the order they are shown in Settings. */
export const SIGNAL_FIELDS = [
  { id: 'rank', label: 'Search rank', tip: 'Where Google or Brave put it. Needs a results source switched on.' },
  { id: 'size', label: 'Story size', tip: 'How many different outlets covered the same story.' },
  { id: 'engagement', label: 'Engagement', tip: 'Points, votes and comments on Hacker News and Reddit.' },
  { id: 'recency', label: 'Recency', tip: 'How new it is. See "How fast news goes stale".' },
  { id: 'source', label: 'Outlet weight', tip: 'Your own opinion of the outlet, set in the list below.' },
];
export const DEFAULT_PERCENTS = { rank: 30, size: 25, engagement: 20, recency: 15, source: 10 };
export const DEFAULT_HALF_LIFE = 48;

/** The server's weights (0-1 each) -> whole percentages as text, for the boxes. */
export const toPercents = (w) => Object.fromEntries(SIGNAL_FIELDS.map((f) => [f.id, String(Math.round((Number(w?.[f.id]) || 0) * 100))]));
/** Percentages typed in the boxes -> the weights the server wants. A blank or nonsense box is 0. */
export const fromPercents = (p) => Object.fromEntries(SIGNAL_FIELDS.map((f) => [f.id, Math.max(0, Number(p?.[f.id]) || 0) / 100]));
export const percentTotal = (p) => SIGNAL_FIELDS.reduce((s, f) => s + Math.max(0, Number(p?.[f.id]) || 0), 0);

/** What a search's ranking could not use this time, in one sentence for the Results page. Empty when it all counted. */
export function rankingNote(ranking) {
  const dropped = ranking?.dropped;
  if (!Array.isArray(dropped) || !dropped.length) return '';
  return `Left out of the ranking this time: ${dropped.map((d) => `${d.label.toLowerCase()} (${d.why})`).join('; ')}. The other signals count for more instead.`;
}

/** The topic's liveliness for a small badge: { text, tip } or null. Plain words and arrows, no alarm colours. */
export function heatBadge(heat) {
  if (!heat || !heat.label) return null;
  const arrow = { Rising: '▲', Falling: '▼', Steady: '●', New: '○' }[heat.label] || '●';
  const stories = Number.isFinite(heat.clusters48h) ? `${heat.clusters48h} ${heat.clusters48h === 1 ? 'story has' : 'stories have'} an article from the last two days` : '';
  const compared = heat.label === 'New' ? 'First search of this topic, so nothing to compare with yet.' : 'Compared with the previous search of this topic.';
  return { text: `${arrow} ${heat.label}`, tip: [stories, compared].filter(Boolean).join('. ') };
}

/** Whether (and how) an article's page was read, in words. */
export function readNote(pageRead) {
  return ({
    ok: 'Page read',
    thin: 'Page had too little text to use',
    robots: 'The site asks not to be read',
    blocked: 'The site would not let the page be read',
    'not-html': 'Not a web page',
    error: 'Page could not be fetched',
  })[pageRead] || 'Headline and snippet only';
}

/** The score's parts for the hover box: [{ id, label, text, points|null, off }], from an article's breakdown. */
export function breakdownRows(breakdown) {
  if (!Array.isArray(breakdown)) return [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return breakdown.map((b) => {
    if (!b.available) return { id: b.id, label: b.label, text: `Left out: ${b.why}`, points: null, off: true };
    let text = '';
    if (b.id === 'rank') text = b.raw ? `Position ${b.raw}` : 'Not in the results';
    else if (b.id === 'size') text = plural(b.raw, 'outlet', 'outlets');
    else if (b.id === 'engagement') text = b.raw > 0 ? `${b.raw} points, votes and comments` : 'None';
    else if (b.id === 'recency') text = b.raw ? formatDate(b.raw) : 'No date (counted as middling)';
    else if (b.id === 'source') text = `Your weight ${b.raw}`;
    return { id: b.id, label: b.label, text, points: Number(b.points) || 0, off: false };
  });
}

/** One feed address per line (a blank line or a "#" comment is skipped) -> the list the server wants. */
export function parseFeedLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((url) => ({ url }));
}

/** The server's feed list -> one address per line. */
export function feedLines(feeds) {
  return (feeds || []).map((f) => f.url).join('\n');
}

// ---- watchlist, history and spending (milestone 5) ----

/** The refresh choices for a watched topic, in hours (the server accepts exactly these). */
export const REFRESH_CHOICES = [
  { hours: 6, label: 'Every 6 hours' }, { hours: 12, label: 'Every 12 hours' }, { hours: 24, label: 'Every day' },
  { hours: 48, label: 'Every 2 days' }, { hours: 168, label: 'Every week' },
];
export const refreshLabel = (hours) => (REFRESH_CHOICES.find((c) => c.hours === Number(hours)) || REFRESH_CHOICES[2]).label;

/** Watched topics first (most recently refreshed first), then the rest in the order given. Does not change the list passed in. */
export function orderTopics(topics) {
  const when = (t) => (t.lastRun?.finishedAt ? new Date(t.lastRun.finishedAt).getTime() : 0);
  const watched = (topics || []).filter((t) => t.onWatchlist).sort((a, b) => when(b) - when(a));
  return [...watched, ...(topics || []).filter((t) => !t.onWatchlist)];
}

/** Searches and briefs from /history as one list, newest first, each tagged with its kind and when. */
export function mergeHistory(runs, briefs) {
  const rows = [
    ...(runs || []).map((r) => ({ ...r, kind: 'run', when: r.startedAt })),
    ...(briefs || []).map((b) => ({ ...b, kind: 'brief', when: b.createdAt })),
  ];
  const t = (r) => (r.when ? new Date(r.when).getTime() : 0);
  return rows.sort((a, b) => t(b) - t(a) || (a.kind === b.kind ? b.id - a.id : a.kind === 'brief' ? -1 : 1));
}

/** The banner sentence when this month's limit has been reached; '' when it has not (or there is no limit). */
export function budgetBanner(usage) {
  if (!usage || !usage.over) return '';
  return `This month's estimated spend ($${usage.spentUsd.toFixed(2)}) has reached your limit of $${usage.limitUsd.toFixed(2)}. Paid searches and new briefs are paused until you raise the limit or the month ends.`;
}

/** "$1.20 of $20.00 used this month", or "$1.20 used this month (no limit)". */
export function spendLine(usage) {
  if (!usage) return '';
  const spent = `$${usage.spentUsd.toFixed(2)}`;
  return usage.limitUsd > 0 ? `${spent} of $${usage.limitUsd.toFixed(2)} used this month` : `${spent} used this month (no limit)`;
}
