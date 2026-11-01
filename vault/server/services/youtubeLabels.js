'use strict';

// Categories and tags on saved (favourite) videos, and the note made from a saved video: the pure parts (no database), tested in youtubeLabels.test.js.
// A video has at most one category and up to 20 tags. Tags follow the SAME rule as note tags (noteTags.js), so a tag on a video and on a note is the
// same tag and one search finds both. A category is free text kept as typed (two words, "Home Cooking"), compared without regard to capitals.

const { normalizeTags } = require('./noteTags');
const { parseIsoDuration, formatLength } = require('./youtubeAiTranscript');

const MAX_CATEGORY_CHARS = 40;

/** The category as stored: no markup or control characters, single spaces, at most 40 characters. '' = none. */
function normalizeCategory(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f\u007f,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CATEGORY_CHARS)
    .trim();
}

/**
 * What a change to a saved video's labels says, made safe. Only the fields present are returned; null when a field has the wrong shape.
 * @returns {{ category?: string, tags?: string[] } | null}
 */
function readLabels(body) {
  const out = {};
  const b = body || {};
  if (b.category !== undefined) {
    if (b.category !== null && typeof b.category !== 'string') return null;
    out.category = normalizeCategory(b.category);
  }
  if (b.tags !== undefined) {
    const tags = normalizeTags(b.tags);
    if (!tags) return null;
    out.tags = tags;
  }
  return out;
}

/** The tags a note made from this video carries: the video's tags, then its category as one more tag (normalised the same way). */
function noteTagsFor({ category, tags }) {
  const all = normalizeTags([...(Array.isArray(tags) ? tags : []), ...(category ? [category] : [])]);
  return all || [];
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
function clock(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const r = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * Timed lines gathered into paragraphs: [{ start, text }]. A paragraph closes at the end of a sentence once it has run about 40 seconds (or 6
 * lines), and always by 75 seconds. Same rule as the Transcript panel (client/src/pages/youtube/youtubeFormat.mjs).
 */
function transcriptParagraphs(segments) {
  const out = [];
  let cur = null;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const text = String((seg && seg.text) || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const start = Math.max(0, Math.floor(Number(seg.start) || 0));
    if (!cur) cur = { start, text, lines: 1 };
    else { cur.text += ' ' + text; cur.lines += 1; }
    const span = start - cur.start;
    const endsSentence = /[.!?\u2026]["')\]]*$/.test(text);
    if ((endsSentence && (span >= 40 || cur.lines >= 6)) || span >= 75) { out.push({ start: cur.start, text: cur.text }); cur = null; }
  }
  if (cur) out.push({ start: cur.start, text: cur.text });
  return out;
}

const likeEscape = (w) => String(w).replace(/[\\%_]/g, (c) => '\\' + c);

/** What was typed in the Favourites search box as LIKE patterns, one per word (at most 6, each at least 2 characters), or [] when too short to search. */
function searchPatterns(q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length || words.join('').length < 3) return [];
  return words.map((w) => `%${likeEscape(w)}%`);
}

/** The first line of a transcript that mentions the first word typed: { at, text } or null. */
function snippetFor(segments, q) {
  const word = String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2)[0];
  if (!word) return null;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const text = String((seg && seg.text) || '').replace(/\s+/g, ' ').trim();
    if (text.toLowerCase().includes(word)) return { at: Math.max(0, Math.floor(Number(seg.start) || 0)), text: text.slice(0, 200) };
  }
  return null;
}

const stripMd = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

function dateText(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

/**
 * A new note about a video, as Markdown (the title is the note's own title, so the text starts with the link): link, who and how long, its category and tags, then (only if they were already written
 * and saved, nothing is asked of any AI here) the Main points and the Insights summary, and an empty "My notes" section to write in.
 */
function buildVideoNote({ videoId, title, channel, duration, publishedAt, category, tags, points, overview, paragraphs, transcriptMissing }) {
  const name = stripMd(title) || 'YouTube video';
  const lines = [`[Watch on YouTube](https://www.youtube.com/watch?v=${encodeURIComponent(videoId)})`];
  const facts = [];
  if (channel) facts.push(stripMd(channel));
  const secs = parseIsoDuration(duration);
  if (secs > 0) facts.push(formatLength(secs));
  const when = dateText(publishedAt);
  if (when) facts.push(`published ${when}`);
  if (facts.length) lines.push('', facts.join(' · '));
  const cat = normalizeCategory(category);
  const tg = Array.isArray(tags) ? tags : [];
  if (cat) lines.push('', `**Category:** ${cat}`);
  if (tg.length) lines.push('', '**Tags:** ' + tg.map((t) => '#' + t.replace(/\s+/g, '-')).join(' '));
  const pts = (Array.isArray(points) ? points : []).map(stripMd).filter(Boolean);
  if (pts.length) { lines.push('', '## Main points', ''); for (const p of pts) lines.push(`- ${p}`); }
  const ov = stripMd(overview);
  if (ov) lines.push('', '## Summary', '', ov);
  const paras = Array.isArray(paragraphs) ? paragraphs : [];
  if (paras.length) {
    lines.push('', '## Transcript', '');
    for (const para of paras) lines.push(`[${clock(para.start)}](https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(para.start))}s) ${stripMd(para.text)}`, '');
  } else if (transcriptMissing) {
    lines.push('', '## Transcript', '', '*No transcript could be read for this video when this note was made.*');
  }
  lines.push('', '## My notes', '', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

module.exports = { MAX_CATEGORY_CHARS, normalizeCategory, readLabels, noteTagsFor, buildVideoNote, transcriptParagraphs, searchPatterns, snippetFor };
