'use strict';

// Small SRT parse/normalize helper. Caption Studio's burn-captions path just
// writes SRT text straight to a file and lets ffmpeg's `subtitles` filter
// parse it — there was no existing server-side SRT parser to reuse, so this
// is a minimal one, used only to clean up Gemini's raw SRT-ish output
// (fenced code blocks, missing blank lines, non-sequential numbering) before
// it's handed to the client / burn-captions.

function pad2(n) {
  return String(n).padStart(2, '0');
}
function pad3(n) {
  return String(n).padStart(3, '0');
}

function parseTimestamp(ts) {
  const m = String(ts || '').trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return null;
  const [, h, mnt, s, ms] = m;
  return (Number(h) * 3600 + Number(mnt) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, '0'));
}

function formatTimestamp(msIn) {
  let ms = Math.max(0, Math.round(msIn));
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

/**
 * Tolerant SRT parser — handles missing/duplicate numbering, `.` instead of
 * `,` in timestamps, stray markdown code fences, and extra blank lines.
 */
function parseSrtLoose(raw) {
  const cleaned = String(raw || '')
    .replace(/```srt/gi, '')
    .replace(/```/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  const blocks = cleaned.split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let idx = 0;
    if (/^\d+$/.test(lines[0])) idx = 1;
    const timeLine = lines[idx];
    const m = timeLine && timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/);
    if (!m) continue;
    const startMs = parseTimestamp(m[1]);
    const endMs = parseTimestamp(m[2]);
    const text = lines.slice(idx + 1).join('\n').trim();
    if (startMs == null || endMs == null || !text) continue;
    cues.push({ startMs, endMs: Math.max(endMs, startMs + 300), text });
  }
  return cues;
}

function cuesToSrt(cues) {
  return `${cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.startMs)} --> ${formatTimestamp(c.endMs)}\n${c.text}`).join('\n\n')}\n`;
}

/** Parse + re-emit clean, sequentially-numbered SRT. Throws if nothing parses. */
function normalizeSrt(raw) {
  const cues = parseSrtLoose(raw);
  if (!cues.length) {
    throw new Error('Could not parse a valid SRT transcript from the model output — try again or paste captions manually');
  }
  return cuesToSrt(cues);
}

module.exports = {
  parseTimestamp,
  formatTimestamp,
  parseSrtLoose,
  cuesToSrt,
  normalizeSrt,
};
