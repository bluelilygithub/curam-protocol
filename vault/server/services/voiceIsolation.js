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

// Community Demucs wrappers come and go (one of them broke on its own server: "Could not load libtorchcodec"), so several are
// tried in order and the first that works is used. ISOLATE_REPLICATE_MODEL can list your own, comma separated, tried first.
const DEFAULT_MODELS = ['ryan5453/demucs', 'cjwbw/demucs', 'iboostai/demucs-api'];
const DEFAULT_MODEL = DEFAULT_MODELS[0];
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

// ---- building the input from the model's own schema -----------------------------------------------------------------------

/**
 * Different Demucs wrappers name their inputs differently (`stem`, `two_stems`, `model` vs `model_name`, ...). Instead of
 * guessing, read the input schema Replicate publishes for the model and fill in only what that model actually has.
 * `props` is the schema's `properties` object ({ name: { type, enum, default, ... } }).
 */
function buildModelInput(props, audioUrl) {
  const input = { audio: audioUrl };
  const has = (k) => props && Object.prototype.hasOwnProperty.call(props, k);
  const options = (k) => {
    const p = props[k] || {};
    return p.enum || p.allOf?.find((x) => x?.enum)?.enum || null;
  };
  const voiceChoice = (k) => {
    const opts = options(k);
    if (!opts) return 'vocals';
    return opts.find((o) => String(o).toLowerCase() === 'vocals') || opts.find((o) => /vocal/i.test(String(o))) || null;
  };
  for (const key of ['stem', 'two_stems', 'stems', 'target']) {
    if (has(key)) {
      const choice = voiceChoice(key);
      if (choice) { input[key] = choice; break; }
    }
  }
  // Prefer a small, widely playable file when the model lets us choose.
  if (has('output_format')) {
    const opts = options('output_format');
    input.output_format = opts ? (opts.includes('mp3') ? 'mp3' : opts[0]) : 'mp3';
  }
  return input;
}

const schemaCache = new Map();

async function fetchInputProps(model, token) {
  if (schemaCache.has(model)) return schemaCache.get(model);
  const res = await fetch(`https://api.replicate.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error(`Model "${model}" was not found on Replicate.`);
  if (!res.ok) throw new Error(data?.detail || `Could not look up "${model}" (${res.status})`);
  const props = data?.latest_version?.openapi_schema?.components?.schemas?.Input?.properties || {};
  schemaCache.set(model, props);
  return props;
}

function modelList() {
  const own = String(process.env.ISOLATE_REPLICATE_MODEL || '').split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set([...own, ...DEFAULT_MODELS])];
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
async function isolateWithModel({ audio, mime = 'audio/mpeg', token = process.env.REPLICATE_API_TOKEN, models = modelList(), deps = {} }) {
  if (!token) throw new Error('Voice isolation is not set up on this server (REPLICATE_API_TOKEN is missing). Use the quick option instead.');
  if (audio.length > MAX_UPLOAD_BYTES * 3) throw new Error('That recording is too big to separate in one go. Trim it or split it first.');
  const upload = deps.upload || uploadForModel;
  const run = deps.run || runReplicateRaw;
  const download = deps.download || downloadAudio;

  const inputProps = deps.inputProps || fetchInputProps;

  const audioUrl = await upload(audio, token, mime);
  const failures = [];
  for (const model of models) {
    try {
      const props = await inputProps(model, token).catch(() => ({})); // no schema -> just { audio }, the model's defaults do the rest
      const output = await run({
        model, token, label: 'Voice isolation', envName: 'ISOLATE_REPLICATE_MODEL',
        pinned: models.length === 1 ? (process.env.ISOLATE_REPLICATE_VERSION || '') : '', timeoutMs: POLL_TIMEOUT_MS,
        input: buildModelInput(props, audioUrl),
      });
      const stems = pickStems(output);
      if (!stems.voice) throw new Error('it finished but returned no voice file');
      const voice = await download(stems.voice);
      const music = stems.music ? await download(stems.music).catch(() => null) : null;
      return { voice, music, model, ...detectAudioType(voice) };
    } catch (err) {
      failures.push(`${model}: ${String(err.message || err).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
  const e = new Error('The voice separation service is not working right now (every model we tried failed). Try again later, or use the Quick filter. The details are in the server log.');
  e.failures = failures;
  throw e;
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
  buildModelInput,
  modelList,
  isolateQuick,
  isolateWithModel,
  remember,
  recall,
  DEFAULT_MODEL,
  DEFAULT_MODELS,
};
