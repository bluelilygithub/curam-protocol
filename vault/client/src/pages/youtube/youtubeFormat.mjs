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
