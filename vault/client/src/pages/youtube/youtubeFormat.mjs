// YouTube page: small pure helpers (tested in youtubeFormat.test.mjs).

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** The embed address, starting at a moment (and playing at once when a moment is given). */
export function embedSrc(videoId, startAt) {
  const t = Math.floor(Number(startAt));
  const base = `https://www.youtube.com/embed/${videoId}?rel=0`;
  return Number.isFinite(t) && t > 0 ? `${base}&start=${t}&autoplay=1` : base;
}

/** "Covers the first 42 minutes" when the AI only saw part of a long video; '' when it saw it all. */
export function coverageNote(truncated, coveredSec) {
  if (!truncated) return '';
  const mins = Math.max(1, Math.round((Number(coveredSec) || 0) / 60));
  return `These notes cover the first ${mins} minute${mins === 1 ? '' : 's'} of a longer video.`;
}

/** Questions worth offering before the person has typed anything. */
export const ASK_STARTERS = [
  'What are the main takeaways?',
  'What does the speaker recommend I do?',
  'Is there anything I should be careful about?',
];

/** Where a saved note lives, for the "Open note" link. */
export const noteHref = (id) => `/notes?note=${encodeURIComponent(id)}`;

// ── "Generate a transcript with AI": the words the confirmation window uses (the same wording as the server's estimate) ──

/** 0.0312 -> "US$0.03", 0.004 -> "under US$0.01". */
export function formatUsd(n) {
  const v = Number(n) || 0;
  if (v < 0.01) return 'under US$0.01';
  return 'US$' + v.toFixed(2);
}

/** A waiting-time range: "under 2 minutes", "about 3 minutes", "1 to 4 minutes". */
export function formatWait(lowSec, highSec) {
  const min = (s) => Math.max(1, Math.round(s / 60));
  const a = min(lowSec);
  const b = min(highSec);
  if (highSec < 90) return 'under 2 minutes';
  return a === b ? `about ${a} minute${a === 1 ? '' : 's'}` : `${a} to ${b} minutes`;
}

/** A video's length: "10 minutes", "1 hour 5 minutes". */
export function formatLength(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`;
  return m < 1 ? 'under a minute' : `${m} minute${m === 1 ? '' : 's'}`;
}

/** Time spent so far on a running job: 83000 -> "1:23". */
export function elapsedText(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Event the page listens for so the "Transcript saved" labels refresh after a transcript is made or deleted. */
export const TRANSCRIPTS_CHANGED = 'vault:youtube-transcripts-changed';

// ── Reading and copying a transcript ──

/**
 * Timed lines gathered into paragraphs a person can read: [{ start, text }]. A paragraph closes at the end of a sentence once it has run about
 * 40 seconds (or 6 lines), and always by 75 seconds, so a transcript with no full stops still breaks up.
 */
export function transcriptParagraphs(segments) {
  const out = [];
  let cur = null;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const text = String(seg && seg.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = Math.max(0, Math.floor(Number(seg.start) || 0));
    if (!cur) cur = { start, text, lines: 1 };
    else { cur.text += ' ' + text; cur.lines += 1; }
    const span = start - cur.start;
    const endsSentence = /[.!?…]["')\]]*$/.test(text);
    if ((endsSentence && (span >= 40 || cur.lines >= 6)) || span >= 75) { out.push({ start: cur.start, text: cur.text }); cur = null; }
  }
  if (cur) out.push({ start: cur.start, text: cur.text });
  return out;
}

/**
 * The text that goes on the clipboard. `times: false` = paragraphs separated by a blank line; `times: true` = one "[m:ss] line" per timed line.
 * With no timed lines it falls back to the plain text it was given.
 */
export function transcriptCopyText(segments, plain, { times = false } = {}) {
  const segs = Array.isArray(segments) ? segments.filter((s) => s && String(s.text || '').trim()) : [];
  if (!segs.length) return String(plain || '');
  if (times) return segs.map((s) => `[${formatTime(s.start)}] ${String(s.text).replace(/\s+/g, ' ').trim()}`).join('\n');
  return transcriptParagraphs(segs).map((p) => p.text).join('\n\n');
}

// ── Main points (the bullet list Gemini writes from a transcript) ──

/** "Budget: set it first." -> { lead: 'Budget', rest: 'set it first.' }; a point with no short lead-in has lead ''. */
export function splitPoint(point) {
  const m = /^([^:]{2,40}):\s+(\S.*)$/.exec(String(point || ''));
  return m ? { lead: m[1].trim(), rest: m[2].trim() } : { lead: '', rest: String(point || '') };
}

/** The list as Markdown for the clipboard: "- **Lead:** rest". */
export function pointsCopyText(points) {
  return (Array.isArray(points) ? points : []).map((p) => {
    const { lead, rest } = splitPoint(p);
    return lead ? `- **${lead}:** ${rest}` : `- ${rest}`;
  }).join('\n');
}

// ── Categories and tags on saved videos: finding, filtering and grouping the Favourites ──

export const UNCATEGORISED = 'Uncategorised';

/** A tag the way the server keeps it (the same rule as note tags): no leading #, single spaces, lowercase, at most 30 characters. */
export function cleanTag(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f,;]/g, ' ')
    .replace(/^[#\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 30)
    .trim();
}

const catOf = (f) => String((f && f.category) || '').trim();
const tagsOf = (f) => (Array.isArray(f && f.tags) ? f.tags : []);

/** Every category and tag in use, with how many videos carry it, most used first: { categories: [{ name, count }], tags: [{ name, count }] }. */
export function collectLabels(favs) {
  const cats = new Map();
  const tags = new Map();
  for (const f of Array.isArray(favs) ? favs : []) {
    const c = catOf(f);
    if (c) { const k = c.toLowerCase(); cats.set(k, { name: cats.get(k)?.name || c, count: (cats.get(k)?.count || 0) + 1 }); }
    for (const t of tagsOf(f)) tags.set(t, { name: t, count: (tags.get(t)?.count || 0) + 1 });
  }
  const order = (m) => [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { categories: order(cats), tags: order(tags) };
}

/**
 * The saved videos that match: every word typed must appear in the title, channel, category or a tag; `category` is '' (any), UNCATEGORISED
 * (none set) or a category name; `tags` are all required.
 */
export function filterFavourites(favs, { search = '', category = '', tags = [] } = {}) {
  const words = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  const want = (Array.isArray(tags) ? tags : []).map(cleanTag).filter(Boolean);
  const cat = String(category || '').toLowerCase();
  return (Array.isArray(favs) ? favs : []).filter((f) => {
    const c = catOf(f);
    if (cat === UNCATEGORISED.toLowerCase()) { if (c) return false; }
    else if (cat && c.toLowerCase() !== cat) return false;
    const have = tagsOf(f);
    if (!want.every((t) => have.includes(t))) return false;
    if (!words.length) return true;
    const hay = [f.title, f.channel, c, ...have].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Saved videos in groups: by 'category' (A to Z, Uncategorised last), by 'channel' (A to Z), or one group for 'none'. [{ key, label, items }] */
export function groupFavourites(favs, by) {
  const list = Array.isArray(favs) ? favs : [];
  if (by !== 'category' && by !== 'channel') return [{ key: 'all', label: '', items: list }];
  const groups = new Map();
  for (const f of list) {
    const label = by === 'category' ? (catOf(f) || UNCATEGORISED) : (String(f.channel || '').trim() || 'Unknown channel');
    const key = label.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, label, items: [] });
    groups.get(key).items.push(f);
  }
  return [...groups.values()].sort((a, b) => {
    const au = a.label === UNCATEGORISED ? 1 : 0;
    const bu = b.label === UNCATEGORISED ? 1 : 0;
    return au - bu || a.label.localeCompare(b.label);
  });
}

/**
 * The Favourites list for what is typed and chosen. `hits` is { [videoId]: {...} } for videos whose kept transcript mentions the words: they
 * are shown too, even when the title does not match, as long as the category and tag choices still fit.
 */
export function searchFavourites(favs, { search = '', category = '', tags = [] } = {}, hits = {}) {
  const base = filterFavourites(favs, { search: '', category, tags });
  if (!String(search).trim()) return base;
  const byMeta = new Set(filterFavourites(favs, { search, category, tags }).map((f) => f.videoId || f.video_id));
  return base.filter((f) => { const id = f.videoId || f.video_id; return byMeta.has(id) || !!(hits && hits[id]); });
}
