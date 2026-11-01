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
