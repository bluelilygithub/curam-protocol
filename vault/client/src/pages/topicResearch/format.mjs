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

/** True for a product or a list of products: not coverage of a topic, so it is not ticked to begin with and is badged "Shop page". */
export const isShopPage = (a) => a?.pageKind === 'product' || a?.pageKind === 'listing';

/** The articles ticked to begin with: the best ten that are not shop pages (the list arrives best first). */
export const defaultSelection = (articles, max = DEFAULT_TICKED) => new Set((articles || []).filter((a) => !isShopPage(a)).slice(0, max).map((a) => a.id));

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

/** The six things a result is ranked on, in the order they are shown in Settings. */
export const SIGNAL_FIELDS = [
  { id: 'rank', label: 'Search rank', tip: 'Where Google or Brave put it. Needs a results source switched on.' },
  { id: 'size', label: 'Story size', tip: 'How many different outlets covered the same story.' },
  { id: 'engagement', label: 'Engagement', tip: 'Points, votes and comments on Hacker News and Reddit.' },
  { id: 'recency', label: 'Recency', tip: 'How new it is. See "How fast news goes stale".' },
  { id: 'source', label: 'Outlet weight', tip: 'Your own opinion of the outlet, set in the list below.' },
  { id: 'match', label: 'Topic match', tip: 'How much the article is about your topic: your words in its title, and anywhere in its text.' },
];
export const DEFAULT_PERCENTS = { rank: 25, size: 20, engagement: 15, recency: 15, source: 5, match: 20 };
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
    else if (b.id === 'match') text = `${Math.round((Number(b.raw) || 0) * 100)}% about the topic`;
    else if (b.id === 'shop') text = `Looks like a shop page (${b.raw === 'listing' ? 'a list of products' : 'a product'}): the score is multiplied by ${b.value}`;
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

/**
 * The saved topics for one client and/or one project (both optional; none = all). A client matches a topic made for that client, or for one of
 * that client's projects (the server marks that as the topic's client too). A project matches only topics made for that project.
 */
export function filterTopicsByLink(topics, { clientId = null, projectId = null } = {}) {
  const list = Array.isArray(topics) ? topics : [];
  return list.filter((t) => {
    if (clientId != null && Number(t?.link?.client?.id) !== Number(clientId)) return false;
    if (projectId != null && Number(t?.link?.project?.id) !== Number(projectId)) return false;
    return true;
  });
}

/** Searches, briefs and drafts from /history as one list, newest first, each tagged with its kind and when. */
export function mergeHistory(runs, briefs, drafts) {
  const rows = [
    ...(runs || []).map((r) => ({ ...r, kind: 'run', when: r.startedAt })),
    ...(briefs || []).map((b) => ({ ...b, kind: 'brief', when: b.createdAt })),
    ...(drafts || []).map((d) => ({ ...d, kind: 'draft', when: d.createdAt })),
  ];
  const t = (r) => (r.when ? new Date(r.when).getTime() : 0);
  const rank = { draft: 0, brief: 1, run: 2 }; // at the same moment the newer kind of thing comes first
  return rows.sort((a, b) => t(b) - t(a) || (a.kind === b.kind ? b.id - a.id : rank[a.kind] - rank[b.kind]));
}

/** The draft length choices, in the order shown (the server accepts exactly these ids). */
export const DRAFT_LENGTHS = [
  { id: 'short', label: 'Short', tip: 'About 400 words' },
  { id: 'medium', label: 'Medium', tip: 'About 800 words' },
  { id: 'long', label: 'Long', tip: 'About 1,400 words' },
];

/** "820 words · 2 places to fill · 1 copy warning" for a draft's list line and header. */
export function draftLine(d) {
  const parts = [`${d.words || 0} words`];
  if (d.gapCount) parts.push(`${d.gapCount} place${d.gapCount === 1 ? '' : 's'} to fill`);
  if (d.overlapCount) parts.push(`${d.overlapCount} copy warning${d.overlapCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** The banner sentence when this month's limit has been reached; '' when it has not (or there is no limit). */
export function budgetBanner(usage) {
  if (!usage || !usage.over) return '';
  return `This month's estimated spend ($${usage.spentUsd.toFixed(2)}) has reached your limit of $${usage.limitUsd.toFixed(2)}. Paid searches, new briefs and new drafts are paused until you raise the limit or the month ends.`;
}

/** "$1.20 of $20.00 used this month", or "$1.20 used this month (no limit)". */
export function spendLine(usage) {
  if (!usage) return '';
  const spent = `$${usage.spentUsd.toFixed(2)}`;
  return usage.limitUsd > 0 ? `${spent} of $${usage.limitUsd.toFixed(2)} used this month` : `${spent} used this month (no limit)`;
}

// ---- progress steps and the "you are here" bar (milestone 7) ----

/** The steps shown while each long action runs, before the server has said anything (the server then fills in what really happened). */
export const SEARCH_STEP_LABELS = ['Asking your sources', 'Saving what they found', 'Reading the best pages', 'Grouping stories and ranking'];
export const BRIEF_STEP_LABELS = ['Getting the articles ready', 'Writing the brief', 'Checking sources and wording'];
export const DRAFT_STEP_LABELS = ['Getting the brief ready', 'Writing the draft', 'Checking sources and wording'];
/** Words that name a kind of section (an opening, a close) rather than a subject: a section made only of these needs no fact behind it. */
const GENERIC_WORDS = new Set(['introduction', 'intro', 'overview', 'summary', 'conclusion', 'final', 'thoughts', 'wrap', 'next', 'steps', 'takeaways', 'about', 'what', 'with', 'your', 'this', 'that', 'from', 'when', 'where', 'which', 'guide', 'checklist', 'why', 'how', 'start', 'before', 'after', 'read', 'more']);
const stems = (text) => [...new Set(String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)).map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))];

/**
 * Before a draft is written: does the brief have enough to write from? A rough, honest check from word overlap, not from understanding:
 * a section of the outline is "supported" when one of its subject words (from its heading and notes) appears in at least one key fact.
 * A section made only of opening/closing words is framing and needs no fact. Thin = fewer than 4 sourced facts, or half the sections or more
 * unsupported. Returns { level: 'ok' | 'thin', facts, sections, unsupported, singleShare, message }.
 */
export function draftReadiness(brief) {
  const objects = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []);
  const facts = objects(brief?.keyFacts);
  const outline = objects(brief?.outline);
  const main = outline.filter((o) => o.level !== 3);
  const sections = main.length ? main : outline;
  const factWords = facts.map((f) => stems(f.fact));
  let counted = 0;
  let unsupported = 0;
  for (const o of sections) {
    const subject = stems(`${o.heading || ''} ${(o.notes || []).join(' ')}`);
    if (!subject.length) continue; // an opening or a close
    counted += 1;
    const hit = subject.some((w) => factWords.some((fw) => fw.some((x) => x.startsWith(w) || w.startsWith(x))));
    if (!hit) unsupported += 1;
  }
  const singleShare = facts.length ? facts.filter((f) => f.singleSource).length / facts.length : 0;
  const thin = facts.length < 4 || (counted > 0 && unsupported / counted >= 0.5);
  const parts = [];
  if (counted > 0 && unsupported > 0) parts.push(`${unsupported} of ${counted} section${counted === 1 ? '' : 's'} of the outline ${unsupported === 1 ? 'has' : 'have'} no supporting fact in this brief.`);
  if (facts.length < 4) parts.push(`The brief has only ${facts.length} sourced fact${facts.length === 1 ? '' : 's'}.`);
  return {
    level: thin ? 'thin' : 'ok', facts: facts.length, sections: counted, unsupported, singleShare,
    message: thin ? `${parts.join(' ')} Those parts of the draft will be mostly "needs your input" markers. This is a rough check from word overlap.` : '',
  };
}

export const RELEVANCE_STEP_LABELS = ['Checking the articles are about your topic'];

/** The server's steps -> the list ProcessingModal shows: a note after the label once a step has something to say. */
export function stepsForModal(serverSteps) {
  return (Array.isArray(serverSteps) ? serverSteps : []).map((s, i) => ({
    id: String(s?.id ?? `step-${i}`),
    label: s?.detail && s.status !== 'pending' ? `${s.label} · ${s.detail}` : String(s?.label ?? ''),
    status: s?.status === 'error' ? 'error' : s?.status === 'active' ? 'active' : s?.status === 'pending' ? 'pending' : 'done', // done and skipped both read as finished
  }));
}

/**
 * The four stages of the work, with where you are: { id, label, state: 'done' | 'current' | 'later' | 'todo' }. `view` is topics | results | brief | draft.
 * `reached` lists the later stages that already exist (a brief while looking at the results): they read 'later' and can be clicked, the rest stay 'todo'.
 */
export function workflowSteps(view, reached = []) {
  const stages = [['search', 'Search'], ['sources', 'Results'], ['brief', 'Brief'], ['draft', 'Draft']];
  const at = { topics: 0, results: 1, brief: 2, draft: 3 }[view] ?? 0;
  const have = new Set(Array.isArray(reached) ? reached : []);
  return stages.map(([id, label], i) => ({ id, label, state: i < at ? 'done' : i === at ? 'current' : have.has(id) ? 'later' : 'todo' }));
}

/** The jump links at the top of a brief: [anchor id, label]; only the sections that exist. */
export function briefJumpLinks(content) {
  const c = content || {};
  return [
    ['tr-facts', 'Facts', Array.isArray(c.keyFacts) && c.keyFacts.length > 0],
    ['tr-gaps', 'Gaps', Array.isArray(c.gaps) && c.gaps.length > 0],
    ['tr-angles', 'Angles', Array.isArray(c.suggestedAngles) && c.suggestedAngles.length > 0],
    ['tr-outline', 'Outline', Array.isArray(c.outline) && c.outline.length > 0],
    ['tr-sources', 'Sources', true],
  ].filter((x) => x[2]).map(([id, label]) => [id, label]);
}

/** The label of a brief's tab: its angle and the day it was made, kept short. */
export function briefTabLabel(b) {
  const angle = String(b?.chosenAngle || b?.angle || 'Brief').replace(/\s+/g, ' ').trim();
  const short = angle.length > 34 ? `${angle.slice(0, 33)}…` : angle;
  return `${short} · ${formatDate(b?.createdAt)}`;
}

/**
 * The sentence for a failed request. Our own server always sends { error }, and that wins. A reply with no error (a gateway answering for the
 * app when it restarts or a request runs too long, or a page that is not JSON) gets a plain explanation instead of a generic "could not": it may
 * still have finished on the server, so the person is told to look before trying again.
 */
export function explainFailure(response, data, fallback) {
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  const status = Number(response?.status) || 0;
  const ours = data && typeof data === 'object' && Object.keys(data).length > 0 && status > 0 && status < 500;
  if (ours) return fallback;
  return `The server did not answer properly${status ? ` (HTTP ${status})` : ''}. It may have been restarting after an update, or the AI model took too long. It may still have finished: check the list below or History before you try again.`;
}

// ---- what was asked: the search words, what was not used, and the prompt of an AI call (milestone 8) ----

/** The whole prompt as one piece of text, for Copy: the model, the rules, the request with its material, and a second try's extra text if there was one. */
export function promptText(p) {
  if (!p || typeof p !== 'object') return '';
  const parts = [`MODEL: ${p.model || 'not recorded'}`, '', '=== SYSTEM (the rules the AI was given) ===', String(p.system || ''), '', '=== USER (the request and the material) ===', String(p.user || '')];
  if (p.retry) parts.push('', '=== SECOND TRY: this was added to the request ===', String(p.retry));
  return parts.join('\n');
}

/** "Searched for: “storm” · “hurricane”": the words every source was asked, the topic's own first. */
export function searchedForLine(queries, keyword) {
  const list = (Array.isArray(queries) && queries.length ? queries : [keyword]).filter(Boolean);
  return list.length ? `Searched for: ${list.map((q) => `\u201c${q}\u201d`).join(' \u00b7 ')}` : '';
}

/** "Not used this time: Reddit (needs ...) · Google results (...)": the sources that were switched off, each with its reason. Empty when all were asked. */
export function notUsedLine(notAsked) {
  const list = (Array.isArray(notAsked) ? notAsked : []).filter((s) => s && s.label);
  if (!list.length) return '';
  const cut = (t) => (String(t || '').length > 110 ? `${String(t).slice(0, 107)}...` : String(t || ''));
  return `Not used this time: ${list.map((s) => (s.reason ? `${s.label} (${cut(s.reason)})` : s.label)).join(' \u00b7 ')}`;
}
