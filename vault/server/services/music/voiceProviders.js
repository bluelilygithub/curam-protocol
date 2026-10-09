'use strict';

// Text-to-speech backends for the Music page's voiceover, behind one interface:
//
//   provider.speak({ text, voice, speed }) -> Promise<Buffer>   (audio file bytes, WAV/MP3)
//   provider.describe()                    -> { name, model, configured, note? }
//
//   replicate (default) — Kokoro-82M via Replicate (same REPLICATE_API_TOKEN as music), billed per run.
//   fake                — tests / MUSIC_PROVIDER=fake: synthesised tone bursts via ffmpeg, no network.
//
// Kokoro's voices are American/British English; there is no Australian voice. Override the model
// with VOICE_REPLICATE_MODEL (it must take { text, voice, speed } and return an audio URL).

const { execFileAsync, FFMPEG } = require('../videoFfmpeg');
const { runReplicatePrediction } = require('./musicProviders');

const MAX_TEXT_CHARS = 1500;
const MIN_SPEED = 0.7;
const MAX_SPEED = 1.3;

const VOICES = [
  { id: 'af_nicole', label: 'Nicole · female, American' },
  { id: 'af_bella', label: 'Bella · female, American' },
  { id: 'bf_emma', label: 'Emma · female, British' },
  { id: 'am_adam', label: 'Adam · male, American' },
  { id: 'am_michael', label: 'Michael · male, American' },
  { id: 'bm_george', label: 'George · male, British' },
];
const DEFAULT_VOICE = VOICES[0].id;

/** Validate user input for a spoken script. Throws an Error with a plain message. */
function normalizeSpeech({ text, voice, speed } = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Type what the voice should say.');
  if (clean.length > MAX_TEXT_CHARS) throw new Error(`Keep the script under ${MAX_TEXT_CHARS} characters (yours is ${clean.length}).`);
  const voiceId = VOICES.some((v) => v.id === voice) ? voice : DEFAULT_VOICE;
  const n = Number(speed);
  const spd = Number.isFinite(n) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, n)) : 1;
  return { text: clean, voice: voiceId, speed: spd };
}

function createReplicateVoiceProvider() {
  const model = process.env.VOICE_REPLICATE_MODEL || 'jaaari/kokoro-82m';
  return {
    name: 'replicate',
    model,
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

// Roughly "speaking length" tones: ~14 characters a second. Not a voice — it exists so the whole
// voiceover pipeline (convert, delay, duck, mix, export) can be exercised without a token.
function createFakeVoiceProvider() {
  return {
    name: 'fake',
    model: 'ffmpeg-synth',
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

let cached = null;
function getVoiceProvider() {
  if (cached) return cached;
  const fake = process.env.VOICE_PROVIDER === 'fake' || (!process.env.VOICE_PROVIDER && process.env.MUSIC_PROVIDER === 'fake');
  cached = fake ? createFakeVoiceProvider() : createReplicateVoiceProvider();
  return cached;
}

module.exports = {
  VOICES, DEFAULT_VOICE, MAX_TEXT_CHARS, MIN_SPEED, MAX_SPEED,
  normalizeSpeech, getVoiceProvider, createReplicateVoiceProvider, createFakeVoiceProvider,
};
