'use strict';

// Isolate voice: take the spoken words out of a recording that has background music.
//
//   mode 'ai'    Demucs source separation on Replicate (REPLICATE_API_TOKEN, billed per run). Splits the recording into a
//                voice file and a music file. Best result; speech over instrumental music separates very well, singing or
//                lyrics leak into the voice because a model hears singing as a voice.
//   mode 'quick' ffmpeg only, free and instant: cuts the low rumble and high hiss and reduces steady noise. It REDUCES music
//                but cannot remove it. Honest about that in the UI.
//
// The Replicate model is replaceable (ISOLATE_REPLICATE_MODEL); its output shape is not documented, so the stem files are
// found by looking at the keys/URLs of whatever comes back (pickStems), not by assuming a layout.

const { runReplicateRaw, downloadAudio, isReplicateAudioUrl } = require('./music/musicProviders');
const { execFileAsync, FFMPEG } = require('./videoFfmpeg');

const DEFAULT_MODEL = 'iboostai/demucs-api';
const POLL_TIMEOUT_MS = 12 * 60 * 1000; // separation of a long recording can take several minutes
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ---- finding the stems in a model's output ----------------------------------------------------------------------------------

function collectUrls(value, key = '', out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    if (/^https:\/\//i.test(value)) out.push({ key, url: value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectUrls(v, `${key}[${i}]`, out));
  } else if (typeof value === 'object') {
    // { name: 'vocals', url: 'https://...' }: the name says what the file is.
    const nameOf = ['name', 'stem', 'label', 'type'].map((k) => value[k]).find((v) => typeof v === 'string');
    Object.entries(value).forEach(([k, v]) => collectUrls(v, key ? `${key}.${k}${nameOf && k === 'url' ? `(${nameOf})` : ''}` : k, out));
  }
  return out;
}

const NOT_VOICE = /no[_ -]?vocal|instrument|accompan|karaoke|other|drum|bass|music|backing/i;
const IS_VOICE = /vocal|voice|speech|singer/i;
const IS_MUSIC = /no[_ -]?vocal|instrument|accompan|karaoke|backing|music/i;

/**
 * Pick the voice file and (if the model gave one) the music file from a model's output of unknown shape.
 * @returns {{ voice: string|null, music: string|null }} URLs
 */
function pickStems(output) {
  const found = collectUrls(output).filter((f) => isReplicateAudioUrl(f.url));
  const label = (f) => `${f.key} ${f.url.split('?')[0].split('/').pop()}`;
  let voice = found.find((f) => IS_VOICE.test(label(f)) && !NOT_VOICE.test(label(f)));
  const music = found.find((f) => IS_MUSIC.test(label(f)) && f !== voice);
  // A model asked for one stem often returns a bare URL or a one-item list: that is the voice.
  if (!voice && found.length === 1) voice = found[0];
  return { voice: voice?.url || null, music: music?.url || null };
}

/** What kind of audio file are these bytes? (the model chooses wav/mp3/flac itself) */
function detectAudioType(buf) {
  const head = Buffer.from(buf || []).subarray(0, 12);
  const ascii = (a, b) => head.subarray(a, b).toString('latin1');
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { ext: '.wav', mime: 'audio/wav' };
  if (ascii(0, 4) === 'fLaC') return { ext: '.flac', mime: 'audio/flac' };
  if (ascii(0, 4) === 'OggS') return { ext: '.ogg', mime: 'audio/ogg' };
  if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return { ext: '.mp3', mime: 'audio/mpeg' };
  return { ext: '.mp3', mime: 'audio/mpeg' };
}

// ---- Replicate file upload ----------------------------------------------------------------------------------------------------

/** Give Replicate the recording. Uses its Files API (works for big files); falls back to an inline data URL for small ones. */
async function uploadForModel(buffer, token, mime = 'audio/mpeg') {
  try {
    const form = new FormData();
    form.append('content', new Blob([buffer], { type: mime }), 'recording');
    const res = await fetch('https://api.replicate.com/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const data = await res.json().catch(() => ({}));
    const url = data?.urls?.get;
    if (res.ok && url && String(url).startsWith('https://api.replicate.com/')) return url;
  } catch { /* fall through to the inline copy */ }
  if (buffer.length <= 8 * 1024 * 1024) return `data:${mime};base64,${buffer.toString('base64')}`;
  throw new Error('Could not hand the recording to the voice isolation service. Try a shorter file.');
}

// ---- the two modes ------------------------------------------------------------------------------------------------------------

/** Free, local: tidy the speech band and reduce steady noise. Does not remove music. */
function quickVoiceArgs(inputPath, outputPath) {
  return [
    '-y', '-i', inputPath, '-vn', '-map', '0:a:0',
    '-af', 'highpass=f=100,lowpass=f=7000,afftdn=nr=14:nf=-28,dynaudnorm=f=200:g=7',
    '-c:a', 'libmp3lame', '-b:a', '160k',
    outputPath,
  ];
}

async function isolateQuick(inputPath, outputPath) {
  await execFileAsync(FFMPEG, quickVoiceArgs(inputPath, outputPath), 600000);
}

/**
 * AI separation. `audio` is the recording's bytes; returns { voice: Buffer, music: Buffer|null, ...type }.
 * Throws plain-worded errors (the route shows them as they are).
 */
async function isolateWithModel({ audio, mime = 'audio/mpeg', token = process.env.REPLICATE_API_TOKEN, model = process.env.ISOLATE_REPLICATE_MODEL || DEFAULT_MODEL, deps = {} }) {
  if (!token) throw new Error('Voice isolation is not set up on this server (REPLICATE_API_TOKEN is missing). Use the quick option instead.');
  if (audio.length > MAX_UPLOAD_BYTES * 3) throw new Error('That recording is too big to separate in one go. Trim it or split it first.');
  const upload = deps.upload || uploadForModel;
  const run = deps.run || runReplicateRaw;
  const download = deps.download || downloadAudio;

  const audioUrl = await upload(audio, token, mime);
  let output;
  try {
    output = await run({
      model, token, label: 'Voice isolation', envName: 'ISOLATE_REPLICATE_MODEL',
      pinned: process.env.ISOLATE_REPLICATE_VERSION || '', timeoutMs: POLL_TIMEOUT_MS,
      input: { audio: audioUrl, stem: 'vocals' },
    });
  } catch (err) {
    throw new Error(`Voice isolation failed: ${String(err.message || err).slice(0, 200)}`);
  }
  const stems = pickStems(output);
  if (!stems.voice) throw new Error('The voice isolation service finished but did not return a voice file. Try again, or use the quick option.');
  const voice = await download(stems.voice);
  const music = stems.music ? await download(stems.music).catch(() => null) : null;
  return { voice, music, ...detectAudioType(voice) };
}

// ---- short-lived results (so the voice and music files can be downloaded separately without paying twice) --------------

const results = new Map();
const TTL_MS = 30 * 60 * 1000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

function prune(now = Date.now()) {
  for (const [id, r] of results) if (now - r.at > TTL_MS) results.delete(id);
}

function remember(id, userId, files) {
  prune();
  results.set(id, { userId, files, at: Date.now() });
  let total = 0;
  for (const r of results.values()) for (const f of Object.values(r.files)) total += f?.buffer?.length || 0;
  for (const [rid, r] of results) {
    if (total <= MAX_TOTAL_BYTES || rid === id) break;
    for (const f of Object.values(r.files)) total -= f?.buffer?.length || 0;
    results.delete(rid);
  }
}

function recall(id, userId) {
  const r = results.get(id);
  if (!r) return null;
  if (Date.now() - r.at > TTL_MS) { results.delete(id); return null; }
  return r.userId === userId ? r : null;
}

module.exports = {
  pickStems,
  detectAudioType,
  quickVoiceArgs,
  isolateQuick,
  isolateWithModel,
  remember,
  recall,
  DEFAULT_MODEL,
};
