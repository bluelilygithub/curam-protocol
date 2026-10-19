'use strict';

// Text-to-speech backends, shared by the Music page's voiceover and Video Tools' Mix audio, behind one interface:
//
//   provider.speak({ text, voice, speed }) -> Promise<Buffer>   (audio file bytes, WAV/MP3)
//   provider.describe()                    -> { name, model, configured, note? }
//
//   gemini (default when GEMINI_API_KEY is set) — Gemini speech, steered to an Australian accent
//                         by the prompt. Chosen 2026-10-19 after listening to samples (Kore).
//   replicate           — Kokoro-82M via Replicate (same REPLICATE_API_TOKEN as music), billed per run.
//                         American/British English only; used when there is no Gemini key.
//   fake                — tests / MUSIC_PROVIDER=fake: synthesised tone bursts via ffmpeg, no network.
//
// Each provider carries its own `voices` list ({ id, label }). Force one with VOICE_PROVIDER.
// Override Kokoro with VOICE_REPLICATE_MODEL (it must take { text, voice, speed } and return an audio URL),
// the Gemini speech model with GEMINI_TTS_MODEL.

const { execFileAsync, FFMPEG } = require('./videoFfmpeg');
const { runReplicatePrediction } = require('./music/musicProviders');

const MAX_TEXT_CHARS = 1500;
const MIN_SPEED = 0.7;
const MAX_SPEED = 1.3;

// Kokoro voices.
const VOICES = [
  { id: 'af_nicole', label: 'Nicole · female, American' },
  { id: 'af_bella', label: 'Bella · female, American' },
  { id: 'bf_emma', label: 'Emma · female, British' },
  { id: 'am_adam', label: 'Adam · male, American' },
  { id: 'am_michael', label: 'Michael · male, American' },
  { id: 'bm_george', label: 'George · male, British' },
];
const DEFAULT_VOICE = VOICES[0].id;

// Kore was heard and approved as Australian-sounding on a 20 s sample (2026-10-19). Charon was rendered in the same
// test but not signed off; the accent comes from the prompt, so check it by ear before relying on it.
const GEMINI_VOICES = [
  { id: 'Kore', label: 'Kore · female, Australian accent' },
  { id: 'Charon', label: 'Charon · male' },
];

/**
 * Validate user input for a spoken script. Throws an Error with a plain message.
 * `voices` is the chosen provider's list; an unknown voice falls back to that list's first.
 */
function normalizeSpeech({ text, voice, speed } = {}, voices = VOICES) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Type what the voice should say.');
  if (clean.length > MAX_TEXT_CHARS) throw new Error(`Keep the script under ${MAX_TEXT_CHARS} characters (yours is ${clean.length}).`);
  const voiceId = voices.some((v) => v.id === voice) ? voice : voices[0].id;
  const n = Number(speed);
  const spd = Number.isFinite(n) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, n)) : 1;
  return { text: clean, voice: voiceId, speed: spd };
}

function createReplicateVoiceProvider() {
  const model = process.env.VOICE_REPLICATE_MODEL || 'jaaari/kokoro-82m';
  return {
    name: 'replicate',
    model,
    voices: VOICES,
    describe() {
      return {
        name: 'replicate',
        model,
        configured: Boolean(process.env.REPLICATE_API_TOKEN),
        note: process.env.REPLICATE_API_TOKEN ? undefined : 'REPLICATE_API_TOKEN is not set on this server.',
      };
    },
    async speak({ text, voice, speed }) {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) throw new Error('REPLICATE_API_TOKEN is not configured — AI voices are unavailable');
      return runReplicatePrediction({
        model, token, input: { text, voice, speed }, label: 'Voice',
        pinned: process.env.VOICE_REPLICATE_VERSION || '', envName: 'VOICE_REPLICATE_MODEL',
      });
    },
  };
}

// Gemini returns raw 16-bit mono PCM at 24 kHz; wrap it in a WAV header so ffmpeg and browsers read it.
function pcmToWav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Gemini has no speed setting, so the pace is changed afterwards (pitch is kept). 1x is left untouched.
async function changeTempo(wav, speed) {
  if (Math.abs(speed - 1) < 0.02) return wav;
  const fs = require('fs/promises');
  const os = require('os');
  const path = require('path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-voicetempo-'));
  try {
    const inp = path.join(dir, 'in.wav');
    const out = path.join(dir, 'out.wav');
    await fs.writeFile(inp, wav);
    await execFileAsync(FFMPEG, ['-y', '-i', inp, '-filter:a', `atempo=${speed.toFixed(3)}`, out], 60000);
    return await fs.readFile(out);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function createGeminiVoiceProvider() {
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  return {
    name: 'gemini',
    model,
    voices: GEMINI_VOICES,
    describe() {
      return {
        name: 'gemini',
        model,
        configured: Boolean(process.env.GEMINI_API_KEY),
        note: process.env.GEMINI_API_KEY ? undefined : 'GEMINI_API_KEY is not set on this server.',
      };
    },
    async speak({ text, voice, speed }) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY is not configured — AI voices are unavailable');
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Read this in a natural, friendly Australian accent, at an even pace: ${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) throw new Error('The voice service is busy or over its limit right now. Try again in a minute.');
        throw new Error(`Voice generation failed (${res.status}): ${String(body?.error?.message || 'unknown error').slice(0, 200)}`);
      }
      const data = await res.json();
      const b64 = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error('The voice service returned no audio. Try again, or shorten the script.');
      return changeTempo(pcmToWav(Buffer.from(b64, 'base64')), speed);
    },
  };
}

// Roughly "speaking length" tones: ~14 characters a second. Not a voice — it exists so the whole
// voiceover pipeline (convert, delay, duck, mix, export) can be exercised without a token.
function createFakeVoiceProvider() {
  return {
    name: 'fake',
    model: 'ffmpeg-synth',
    voices: VOICES,
    describe() {
      return { name: 'fake', model: 'ffmpeg-synth', configured: true, note: 'Test backend — a tone, not speech.' };
    },
    async speak({ text }) {
      const fs = require('fs/promises');
      const os = require('os');
      const path = require('path');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-fakevoice-'));
      try {
        const d = Math.max(1, Math.min(60, String(text).length / 14));
        const out = path.join(dir, 'fake.wav');
        await execFileAsync(FFMPEG, [
          '-y', '-f', 'lavfi', '-i', `sine=f=300:d=${d.toFixed(2)}`,
          '-af', 'volume=0.5,aformat=sample_rates=44100:channel_layouts=stereo', out,
        ], 60000);
        return await fs.readFile(out);
      } finally {
        fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

/** Which backend to use: VOICE_PROVIDER if set, else fake under MUSIC_PROVIDER=fake, else Gemini when it has a key, else Kokoro. */
function pickVoiceProviderName(env = process.env) {
  const forced = env.VOICE_PROVIDER;
  if (forced === 'fake' || forced === 'gemini' || forced === 'replicate') return forced;
  if (!forced && env.MUSIC_PROVIDER === 'fake') return 'fake';
  return env.GEMINI_API_KEY ? 'gemini' : 'replicate';
}

let cached = null;
function getVoiceProvider() {
  if (cached) return cached;
  const name = pickVoiceProviderName();
  cached = name === 'fake' ? createFakeVoiceProvider()
    : name === 'gemini' ? createGeminiVoiceProvider()
      : createReplicateVoiceProvider();
  return cached;
}

module.exports = {
  VOICES, GEMINI_VOICES, DEFAULT_VOICE, MAX_TEXT_CHARS, MIN_SPEED, MAX_SPEED,
  normalizeSpeech, pickVoiceProviderName, getVoiceProvider,
  createReplicateVoiceProvider, createGeminiVoiceProvider, createFakeVoiceProvider,
};
