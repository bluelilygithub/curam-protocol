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

const stripMd = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

function dateText(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

/**
 * A new note about a saved video, as Markdown: title, link, who and how long, its category and tags, then (only if they were already written
 * and saved, nothing is asked of any AI here) the Main points and the Insights summary, and an empty "My notes" section to write in.
 */
function buildVideoNote({ videoId, title, channel, duration, publishedAt, category, tags, points, overview }) {
  const name = stripMd(title) || 'YouTube video';
  const lines = [`# ${name}`, '', `[Watch on YouTube](https://www.youtube.com/watch?v=${encodeURIComponent(videoId)})`];
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
  lines.push('', '## My notes', '', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

module.exports = { MAX_CATEGORY_CHARS, normalizeCategory, readLabels, noteTagsFor, buildVideoNote };
