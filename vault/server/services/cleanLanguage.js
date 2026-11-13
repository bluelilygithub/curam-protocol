'use strict';

// "Remove swearing" (Video Tools): bleep or silence swear words in a video or an audio file, and mask them in a transcript.
//
// - Media: the speech is transcribed WORD BY WORD by a Whisper model on Replicate (REPLICATE_API_TOKEN, billed per run), so
//   each swear word has its own start and end time. ffmpeg then silences each word (a short margin either side) and, for
//   "bleep", lays a 1 kHz tone over exactly those moments. The picture is copied untouched.
// - Transcript (text or SRT): each swear word is masked (f***), or replaced by [bleep], or removed. No AI, no cost.
//
// Which models: community Whisper wrappers come and go, so several are tried in order (CLEAN_LANGUAGE_REPLICATE_MODEL can
// list your own, comma separated, tried first). Their output shapes differ and are not all documented, so the word list is
// read from whatever comes back (wordsFromOutput), not assumed.

const { runReplicateRaw } = require('./music/musicProviders');
const voiceIsolation = require('./voiceIsolation');

const DEFAULT_MODELS = ['vaibhavs10/incredibly-fast-whisper', 'victor-upmeyer/whisperx', 'thomasmol/whisper-diarization'];
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

// ---- which words ---------------------------------------------------------------------------------------------------------------

// Strong words and slurs: always on. Each pattern must match a WHOLE word (lower case, apostrophes removed), so "class",
// "assess", "Scunthorpe" or "cocktail" are never touched.
const STRONG = [
  /^(mother)?f+u+c+k+\w*$/, /^\w*fuck\w*$/, /^fk+$/, /^effing$/,
  /^\w*shit\w*$/, /^\w*cunts?$/, /^cunt\w*$/,
  /^bitch(es|y|ing)?$/, /^sonofabitch$/, /^bastards?$/,
  /^(ass|arse)holes?$/, /^dick(head|heads|s)?$/, /^cocksuck\w*$/, /^pricks?$/,
  /^wank\w*$/, /^twats?$/, /^sluts?$/, /^whores?$/, /^bollocks$/, /^tits$/, /^pussy$/,
  /^nigg(er|ers|a|as|az)$/, /^fag(s|got|gots)?$/, /^retard(s|ed)?$/, /^spastic$/,
];
// Milder words: only when "Also mild words" is ticked.
const MILD = [
  /^damn(ed|it)?$/, /^goddamn\w*$/, /^hell$/, /^crap(py)?$/, /^piss(ed|ing)?$/, /^bloody$/, /^bugger(ed)?$/,
  /^(ass|arse)$/, /^arses?$/,
];

/** Lower case, apostrophes and surrounding punctuation removed: "F*ck!" stays "f*ck", "Damn," -> "damn", "don't" -> "dont". */
function normalizeWord(w) {
  return String(w || '').toLowerCase().replace(/[’']/g, '').replace(/^[^a-z0-9*]+|[^a-z0-9*]+$/g, '');
}

/** "word" matches the word; "word*" matches anything starting with it. Commas or new lines between entries. */
function parseWordList(text) {
  return String(text || '').split(/[\n,;]+/).map((w) => w.trim().toLowerCase().replace(/[’']/g, '')).filter((w) => /^[a-z0-9]+\*?$/.test(w)).slice(0, 200);
}

/**
 * Build the test for one word. opts: { mild: boolean, extra: string (your own words), allow: string (never treat as swearing) }.
 */
function makeMatcher({ mild = false, extra = '', allow = '' } = {}) {
  const patterns = [...STRONG, ...(mild ? MILD : [])];
  const own = parseWordList(extra);
  const allowed = new Set(parseWordList(allow).map((w) => w.replace(/\*$/, '')));
  return (raw) => {
    const w = normalizeWord(raw);
    if (!w || allowed.has(w)) return false;
    if (/^[a-z]\*+[a-z]*$/.test(w) && w.includes('**')) return false; // already masked ("f***")
    if (own.some((o) => (o.endsWith('*') ? w.startsWith(o.slice(0, -1)) : w === o))) return true;
    return patterns.some((p) => p.test(w));
  };
}

/** How a swear word is written in the cleaned transcript. */
function replacementFor(word, style) {
  if (style === 'remove') return '';
  if (style === 'bleep') return '[bleep]';
  const letters = word.replace(/[^A-Za-z]/g, '');
  return letters ? letters[0] + '*'.repeat(Math.max(letters.length - 1, 2)) : '***';
}

/** Clean free text. Returns { text, found: [the words as written] }. */
function cleanText(text, opts = {}) {
  const isSwear = makeMatcher(opts);
  const found = [];
  const out = String(text || '').replace(/[A-Za-z][A-Za-z’'*]*/g, (w) => {
    if (!isSwear(w)) return w;
    found.push(w);
    return replacementFor(w, opts.style);
  });
  // "remove" leaves double spaces and spaces before punctuation behind
  const tidy = opts.style === 'remove' ? out.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:])/g, '$1').replace(/^ +| +$/gm, '') : out;
  return { text: tidy, found };
}

const SRT_TIME = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/;

/** Clean an SRT: only the caption lines are changed; numbers and times stay as they are. */
function cleanSrt(srt, opts = {}) {
  const found = [];
  const lines = String(srt || '').replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (!line.trim() || /^\s*\d+\s*$/.test(line) || SRT_TIME.test(line)) return line;
    const r = cleanText(line, opts);
    found.push(...r.found);
    return r.text;
  });
  return { text: lines.join('\n'), found };
}

const looksLikeSrt = (text) => String(text || '').split(/\r?\n/).some((l) => SRT_TIME.test(l));

/** Text or SRT, whichever it is. */
function cleanTranscript(text, opts = {}) {
  const srt = looksLikeSrt(text);
  return { ...(srt ? cleanSrt(text, opts) : cleanText(text, opts)), format: srt ? 'srt' : 'text' };
}

// ---- word times from a Whisper model ---------------------------------------------------------------------------------------

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/**
 * Words with times from a Whisper model's output, whatever its shape:
 *  - { chunks: [{ text, timestamp: [start, end] }] }                        (incredibly-fast-whisper with timestamp "word")
 *  - { segments: [{ words: [{ word, start, end }] }] }                      (whisperx, whisper-diarization, openai/whisper)
 *  - { word_segments: [{ word, start, end }] }                              (whisperx)
 * Words with a missing time (whisperx leaves some numbers untimed) take their neighbours' times.
 * @returns {{ word: string, start: number, end: number }[]}
 */
function wordsFromOutput(output) {
  let out = output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { return []; } }
  if (!out || typeof out !== 'object') return [];
  let words = [];
  if (Array.isArray(out.chunks) && out.chunks.some((c) => Array.isArray(c?.timestamp))) {
    words = out.chunks.map((c) => ({ word: String(c.text || '').trim(), start: num(c.timestamp?.[0]), end: num(c.timestamp?.[1]) }));
  } else if (Array.isArray(out.word_segments) && out.word_segments.length) {
    words = out.word_segments.map((w) => ({ word: String(w.word || w.text || '').trim(), start: num(w.start), end: num(w.end) }));
  } else if (Array.isArray(out.segments) && out.segments.some((s) => Array.isArray(s?.words))) {
    words = out.segments.flatMap((s) => (s.words || []).map((w) => ({ word: String(w.word || w.text || '').trim(), start: num(w.start), end: num(w.end) })));
  } else if (Array.isArray(out.output) || out.output) {
    return wordsFromOutput(out.output);
  }
  words = words.filter((w) => w.word);
  // fill missing times from the neighbours, so every word can still be bleeped
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!Number.isFinite(w.start)) w.start = i > 0 && Number.isFinite(words[i - 1].end) ? words[i - 1].end : 0;
    if (!Number.isFinite(w.end) || w.end < w.start) {
      const next = words.slice(i + 1).find((x) => Number.isFinite(x.start));
      w.end = next ? Math.max(next.start, w.start) : w.start + 0.4;
    }
  }
  return words;
}

/** Build the model's input from the input schema Replicate publishes for it (each wrapper names things differently). */
function buildWhisperInput(props, audioUrl) {
  const has = (k) => props && Object.prototype.hasOwnProperty.call(props, k);
  const options = (k) => props?.[k]?.enum || props?.[k]?.allOf?.find((x) => x?.enum)?.enum || null;
  const key = ['audio', 'audio_file', 'file', 'file_url', 'audio_url'].find(has) || 'audio';
  const input = { [key]: audioUrl };
  if (has('timestamp')) { const o = options('timestamp'); if (!o || o.includes('word')) input.timestamp = 'word'; }
  if (has('align_output')) input.align_output = true;
  if (has('word_timestamps')) input.word_timestamps = true;
  if (has('task')) { const o = options('task'); if (!o || o.includes('transcribe')) input.task = 'transcribe'; }
  return input;
}

function modelList() {
  const own = String(process.env.CLEAN_LANGUAGE_REPLICATE_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([...own, ...DEFAULT_MODELS])];
}

/**
 * Every word in the recording with its time. `audio` is a small speech MP3 (videoFfmpeg.toSpeechMp3).
 * Throws plain-worded errors. `deps` replaces the network calls in tests.
 */
async function transcribeWords({ audio, mime = 'audio/mpeg', token = process.env.REPLICATE_API_TOKEN, models = modelList(), deps = {}, log = () => {} }) {
  if (!token) throw new Error('Remove swearing is not set up on this server (REPLICATE_API_TOKEN is missing).');
  const upload = deps.upload || voiceIsolation.uploadForModel;
  const run = deps.run || runReplicateRaw;
  const inputProps = deps.inputProps || voiceIsolation.fetchInputProps;
  const audioUrl = await upload(audio, token, mime);
  const failures = [];
  for (const model of models) {
    try {
      const props = await inputProps(model, token).catch(() => ({}));
      const output = await run({
        model, token, label: 'Transcription', envName: 'CLEAN_LANGUAGE_REPLICATE_MODEL',
        pinned: models.length === 1 ? (process.env.CLEAN_LANGUAGE_REPLICATE_VERSION || '') : '', timeoutMs: POLL_TIMEOUT_MS,
        input: buildWhisperInput(props, audioUrl),
      });
      const words = wordsFromOutput(output);
      if (!words.length) throw new Error('it finished but returned no timed words');
      log(`${model}: ${words.length} words`);
      return { words, model };
    } catch (err) {
      failures.push(`${model}: ${String(err.message || err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  const e = new Error('The speech-to-text service is not working right now (every model we tried failed). Try again later. The details are in the server log.');
  e.failures = failures;
  throw e;
}

// ---- bleeping -----------------------------------------------------------------------------------------------------------------

/** The swear words among timed words. */
function findSwearWords(words, opts = {}) {
  const isSwear = makeMatcher(opts);
  return words.filter((w) => isSwear(w.word));
}

/** Time windows to bleep: each word plus a small margin, overlapping ones merged, never before 0 or past the end. */
function bleepWindows(hits, { padSec = 0.06, durationSec = Infinity } = {}) {
  const spans = hits
    .map((h) => [Math.max(0, h.start - padSec), Math.min(durationSec, h.end + padSec)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 0.02) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

/**
 * The ffmpeg filter graph (input [0:a], output [aout]). 'mute' silences each window; 'bleep' silences it and plays a tone
 * over it. With no windows the sound is passed through unchanged.
 */
function audioFilter(windows, mode = 'bleep') {
  if (!windows.length) return '[0:a]anull[aout]';
  const inside = windows.map(([a, b]) => `between(t,${a},${b})`).join('+');
  const quiet = `[0:a]volume=volume='if(${inside},0,1)':eval=frame`;
  if (mode === 'mute') return `${quiet}[aout]`;
  return `${quiet}[speech];sine=frequency=1000:sample_rate=48000,volume=volume='if(${inside},0.25,0)':eval=frame[tone];`
    + '[speech][tone]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]';
}

/** ffmpeg arguments: video keeps its picture (copied), audio becomes an MP3. */
function cleanArgs({ inputPath, outputPath, windows, mode, hasVideo }) {
  const args = ['-y', '-i', inputPath, '-filter_complex', audioFilter(windows, mode)];
  if (hasVideo) return [...args, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath];
  return [...args, '-map', '[aout]', '-c:a', 'libmp3lame', '-b:a', '192k', outputPath];
}

/** A simple SRT from timed words: up to 7 words or 3 seconds per caption, ending early after a full stop. */
function wordsToSrt(words) {
  const stamp = (s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const cues = [];
  let cur = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 7 || w.end - cur[0].start >= 3 || /[.!?]$/.test(w.word)) { cues.push(cur); cur = []; }
  }
  if (cur.length) cues.push(cur);
  return cues.map((c, i) => `${i + 1}\n${stamp(c[0].start)} --> ${stamp(c[c.length - 1].end)}\n${c.map((w) => w.word).join(' ').replace(/\s+([,.!?;:])/g, '$1')}\n`).join('\n');
}

module.exports = {
  STRONG, MILD, DEFAULT_MODELS,
  normalizeWord, parseWordList, makeMatcher, cleanText, cleanSrt, cleanTranscript, looksLikeSrt,
  wordsFromOutput, buildWhisperInput, modelList, transcribeWords,
  findSwearWords, bleepWindows, audioFilter, cleanArgs, wordsToSrt,
};
