'use strict';

// Captions from a written script that has no timestamps.
//
//  1. splitScriptIntoCaptions: the script becomes caption-sized lines (the writer's own line breaks are respected).
//  2. alignChunksToTranscript: the media's actual speech is transcribed (with times) and the script's words are matched to what
//     was said, so each caption appears when its first word is spoken. This copes with a few misheard words and with
//     the speaker ad-libbing a little.
//  3. weightedTiming: fallback with no speech to listen to (or too little matched): the video's length is shared out
//     in proportion to how much text each caption has. Rough, but never wildly wrong.
//
// Pure: no ffmpeg, no network. The route does the listening (see routes/videos.js /time-script).

const { cuesToSrt } = require('./srtUtils');

const MIN_CAPTION_SEC = 0.8;

const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Script -> caption lines. Each non-empty line/sentence of the script becomes one or more captions of at most `maxWords`
 * words, breaking after commas and similar where it can so a caption reads naturally.
 */
function splitScriptIntoCaptions(script, { maxWords = 10 } = {}) {
  const out = [];
  const paragraphs = String(script || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const para of paragraphs) {
    const sentences = para.split(/(?<=[.!?…])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      const ws = words(sentence);
      let i = 0;
      while (i < ws.length) {
        const remaining = ws.length - i;
        if (remaining <= maxWords) { out.push(ws.slice(i).join(' ')); break; }
        // Prefer breaking after punctuation between 60% and 100% of the way through a full caption.
        let cut = -1;
        for (let k = Math.min(i + maxWords, ws.length) - 1; k >= i + Math.ceil(maxWords * 0.6) - 1; k -= 1) {
          if (/[,;:—-]$/.test(ws[k])) { cut = k + 1; break; }
        }
        if (cut < 0) {
          // Even split of what is left so we never leave a one-word orphan caption.
          const parts = Math.ceil(remaining / maxWords);
          cut = i + Math.ceil(remaining / parts);
        }
        out.push(ws.slice(i, cut).join(' '));
        i = cut;
      }
    }
  }
  return out;
}

// ---- times written in the script itself: "[00:00 – 00:12] words…" ------------------------------------------------------
// People often write their script in timed blocks. When it has them those times are used exactly as written; nothing needs
// listening to. Accepted: [00:12], [00:12 - 00:30], [00:12 – 00:30], [1:14 to 1:30], [0:01:14 – 0:01:30] (mm:ss or hh:mm:ss).
const T = String.raw`\d{1,2}(?::\d{2}){1,2}`;
const MARKER_SRC = String.raw`\[\s*(${T})\s*(?:(?:[-–—]+|to|until)\s*(${T})\s*)?\]`;

function clockToMs(t) {
  const parts = String(t).split(':').map(Number);
  const sec = parts.reduce((acc, p) => acc * 60 + p, 0);
  return Math.round(sec * 1000);
}

function hasTimeMarkers(script) {
  return new RegExp(MARKER_SRC, 'i').test(String(script || ''));
}

/** @returns {Array<{startMs:number, endMs:number|null, text:string}>} blocks in the order written (empty if none) */
function parseTimedScript(script) {
  const src = String(script || '');
  const re = new RegExp(MARKER_SRC, 'gi');
  const marks = [];
  let m;
  while ((m = re.exec(src))) {
    marks.push({ index: m.index, after: re.lastIndex, startMs: clockToMs(m[1]), endMs: m[2] ? clockToMs(m[2]) : null });
  }
  if (!marks.length) return [];
  const blocks = [];
  const lead = src.slice(0, marks[0].index).trim();
  if (lead && marks[0].startMs > 0) blocks.push({ startMs: 0, endMs: marks[0].startMs, text: lead });
  marks.forEach((mk, i) => {
    const text = src.slice(mk.after, i + 1 < marks.length ? marks[i + 1].index : src.length).trim();
    if (text) blocks.push({ startMs: mk.startMs, endMs: mk.endMs, text });
  });
  return blocks;
}

/** Captions from time-marked blocks: each block's words are shared out over that block's own time span. */
function timeFromMarkers(blocks, { durationSec = 0, maxWords = 10 } = {}) {
  const mediaMs = Math.round((Number(durationSec) || 0) * 1000);
  const cues = [];
  let lastEnd = 0;
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    let end = b.endMs ?? (next ? next.startMs : (mediaMs || b.startMs + 8000));
    if (mediaMs && end > mediaMs) end = mediaMs;
    if (end <= b.startMs) return; // outside the recording or back-to-front: skip rather than invent a time
    const chunks = splitScriptIntoCaptions(b.text, { maxWords });
    if (!chunks.length) return;
    const span = (end - b.startMs) / 1000;
    weightedTiming(chunks, span, { leadInSec: 0 }).forEach((c) => {
      cues.push({ text: c.text, startMs: c.startMs + b.startMs, endMs: c.endMs + b.startMs });
    });
    lastEnd = Math.max(lastEnd, end);
  });
  return { cues: tidyCues(cues, Math.max(mediaMs, lastEnd) / 1000), lastEndMs: lastEnd, mediaMs };
}

/** Share `durationSec` between captions in proportion to their text length. */
function weightedTiming(chunks, durationSec, { leadInSec = 0.2 } = {}) {
  const dur = Math.max(1, Number(durationSec) || 1);
  const usable = Math.max(0.5, dur - leadInSec);
  const weights = chunks.map((c) => Math.max(8, c.length) + 6); // + a beat for the pause between captions
  const total = weights.reduce((a, b) => a + b, 0);
  const cues = [];
  let t = leadInSec;
  chunks.forEach((text, i) => {
    const span = (weights[i] / total) * usable;
    cues.push({ startMs: Math.round(t * 1000), endMs: Math.round((t + span) * 1000), text });
    t += span;
  });
  return tidyCues(cues, dur);
}

/** Words of the transcript with an estimated time for each (interpolated by letter count inside each cue). */
function transcriptWords(cues) {
  const out = [];
  for (const cue of cues) {
    const ws = words(cue.text).map((raw) => ({ raw, n: norm(raw) })).filter((w) => w.n);
    if (!ws.length) continue;
    const totalLen = ws.reduce((a, w) => a + w.n.length, 0) || 1;
    let at = cue.startMs;
    const span = Math.max(1, cue.endMs - cue.startMs);
    for (const w of ws) {
      const share = (w.n.length / totalLen) * span;
      out.push({ n: w.n, startMs: Math.round(at), endMs: Math.round(at + share) });
      at += share;
    }
  }
  return out;
}

/**
 * Match script words to spoken words in order. For each script word, look a short way ahead in the transcript for the same
 * word; if found, take it and move on; if not, leave that script word unmatched and carry on (a misheard or ad-libbed word
 * never derails the rest).
 */
function alignChunksToTranscript(chunks, transcriptCues, durationSec, { window = 40 } = {}) {
  const spoken = transcriptWords(transcriptCues);
  const dur = Math.max(1, Number(durationSec) || 1);
  if (!spoken.length || !chunks.length) return { cues: null, matched: 0, total: 0, coverage: 0 };

  let ptr = 0;
  let matchedWords = 0;
  let totalWords = 0;
  const found = chunks.map((text) => {
    let first = null;
    let last = null;
    for (const raw of words(text)) {
      const n = norm(raw);
      if (!n) continue;
      totalWords += 1;
      const limit = Math.min(spoken.length, ptr + window);
      for (let j = ptr; j < limit; j += 1) {
        if (spoken[j].n === n) {
          if (!first) first = spoken[j];
          last = spoken[j];
          ptr = j + 1;
          matchedWords += 1;
          break;
        }
      }
    }
    return first ? { startMs: first.startMs, endMs: last.endMs } : null;
  });

  const coverage = totalWords ? matchedWords / totalWords : 0;

  // Captions with no matched word: spread between their timed neighbours.
  const cues = chunks.map((text, i) => ({ text, ...(found[i] || { startMs: null, endMs: null }) }));
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i].startMs !== null) continue;
    let a = i - 1; while (a >= 0 && cues[a].startMs === null) a -= 1;
    let b = i + 1; while (b < cues.length && cues[b].startMs === null) b += 1;
    const from = a >= 0 ? cues[a].endMs : 0;
    const to = b < cues.length ? cues[b].startMs : Math.round(dur * 1000);
    const run = b - a - 1;
    const slot = Math.max(0, to - from) / run;
    const idx = i - a - 1;
    cues[i].startMs = Math.round(from + slot * idx);
    cues[i].endMs = Math.round(from + slot * (idx + 1));
  }
  return { cues: tidyCues(cues, dur), matched: matchedWords, total: totalWords, coverage };
}

/** Sorted, non-overlapping, each at least MIN_CAPTION_SEC long where there is room, all inside the media length. */
function tidyCues(cues, durationSec) {
  const durMs = Math.round(durationSec * 1000);
  const out = cues.map((c) => ({ ...c })).sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < out.length; i += 1) {
    const c = out[i];
    c.startMs = Math.min(Math.max(0, c.startMs), Math.max(0, durMs - 300));
    const nextStart = i + 1 < out.length ? out[i + 1].startMs : durMs;
    // Hold a caption until the next one starts if the gap is short (no flicker between lines); this also stops overlaps.
    let end = Math.max(c.endMs, c.startMs + MIN_CAPTION_SEC * 1000);
    if (nextStart - end < 1200) end = nextStart - 40;
    end = Math.min(end, durMs);
    if (end < c.startMs + 300) end = Math.min(durMs, c.startMs + 300);
    c.endMs = end;
  }
  return out;
}

/**
 * @param {string} script
 * @param {{ durationSec: number, transcriptCues?: Array<{startMs:number,endMs:number,text:string}>|null, maxWords?: number }} opts
 * @returns {{ srt: string, method: 'speech'|'even', note: string, captions: number }}
 */
function timeScript(script, { durationSec, transcriptCues = null, maxWords = 10 } = {}) {
  const blocks = parseTimedScript(script);
  if (blocks.length) {
    const t = timeFromMarkers(blocks, { durationSec, maxWords });
    if (!t.cues.length) {
      const err = new Error('The times in your script are all outside the recording, or back to front. Check them and try again.');
      err.code = 'SCRIPT_TIMES_INVALID';
      throw err;
    }
    const over = t.mediaMs && blocks.some((b) => (b.endMs ?? b.startMs) > t.mediaMs + 1500);
    return {
      srt: cuesToSrt(t.cues),
      method: 'markers',
      captions: t.cues.length,
      note: over
        ? 'Used the times written in your script. Some of them run past the end of the recording, so those lines were cut short or left out.'
        : 'Used the times written in your script. Within each timed block the lines are spread by length, so check the middle of long blocks.',
    };
  }
  const chunks = splitScriptIntoCaptions(script, { maxWords });
  if (!chunks.length) {
    const err = new Error('Write or paste your script first.');
    err.code = 'SCRIPT_EMPTY';
    throw err;
  }
  if (transcriptCues && transcriptCues.length) {
    const aligned = alignChunksToTranscript(chunks, transcriptCues, durationSec);
    if (aligned.cues && aligned.coverage >= 0.4) {
      const pct = Math.round(aligned.coverage * 100);
      return {
        srt: cuesToSrt(aligned.cues),
        method: 'speech',
        captions: aligned.cues.length,
        note: pct >= 85
          ? 'Timed to the speech. Check the first and last few captions.'
          : `Timed to the speech, but only ${pct}% of your words matched what was said, so some timings are estimates. Check them.`,
      };
    }
  }
  return {
    srt: cuesToSrt(weightedTiming(chunks, durationSec)),
    method: 'even',
    captions: chunks.length,
    note: transcriptCues && transcriptCues.length
      ? 'Your script did not match the speech closely enough to follow it, so the captions are spread evenly over the length. Expect them to drift from the speaker.'
      : 'No speech could be listened to, so the captions are spread evenly over the length. Expect them to drift if the speaker pauses or speeds up.',
  };
}

module.exports = {
  hasTimeMarkers,
  parseTimedScript,
  timeFromMarkers,
  splitScriptIntoCaptions,
  weightedTiming,
  transcriptWords,
  alignChunksToTranscript,
  tidyCues,
  timeScript,
};
