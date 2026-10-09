'use strict';

// Music generation backends behind one interface:
//
//   provider.generate({ prompt, durationS, seed }) -> Promise<Buffer>   (a WAV file's bytes)
//   provider.maxClipS                                                    (longest single clip it makes)
//   provider.describe()                                                  -> { name, model, configured, note? }
//
// Backends:
//   replicate (default) — Meta MusicGen via Replicate's hosted API. Works on Railway, billed per run.
//   fake                — dev/test only (MUSIC_PROVIDER=fake): a synthesised pad via ffmpeg, no network.
//
// A local-Python MusicGen backend can be added here later without touching routes or the UI.

const dns = require('dns');
const http = require('http');
const https = require('https');
const { execFileAsync, FFMPEG } = require('../videoFfmpeg');

const REPLICATE_HOST_SUFFIXES = ['replicate.delivery', 'replicate.com'];
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReplicateAudioUrl(url) {
  try {
    const u = new URL(String(url));
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && REPLICATE_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

// Same IP-pinning download as the other fetchers: the URL comes from a third-party API response,
// so allow-list the host and connect to the address we resolved (no DNS rebinding).
function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    if (!isReplicateAudioUrl(url)) return reject(new Error('Music provider returned an unexpected download URL'));
    const parsed = new URL(url);
    dns.lookup(parsed.hostname, (err, address) => {
      if (err) return reject(new Error('Could not reach the music provider download host'));
      const req = https.request({
        hostname: address,
        servername: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { Host: parsed.host, 'User-Agent': 'CuramVault/1.0' },
        timeout: 60000,
      }, (res) => {
        if (res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`Music download failed (${res.statusCode})`));
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_AUDIO_BYTES) { req.destroy(new Error('Generated audio is unexpectedly large')); return; }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Music download timed out')));
      req.on('error', reject);
      req.end();
    });
  });
}

// Community models (like meta/musicgen) cannot be run through /v1/models/{owner}/{name}/predictions —
// that endpoint is for Replicate's "official" models only and answers 404 "The requested resource could
// not be found." Run them by version id instead. The latest version is looked up once per process
// (override with MUSIC_REPLICATE_VERSION to pin one).
const versionCache = new Map();

async function resolveModelVersion(model, token, { pinned = '', envName = 'MUSIC_REPLICATE_MODEL', label = 'Music' } = {}) {
  if (pinned) return pinned;
  if (versionCache.has(model)) return versionCache.get(model);
  const res = await fetch(`https://api.replicate.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404) {
    throw new Error(`${label} model "${model}" was not found on Replicate — check ${envName}.`);
  }
  if (!res.ok) throw new Error(data?.detail || `Could not look up the ${label.toLowerCase()} model (${res.status})`);
  const id = data?.latest_version?.id;
  if (!id) throw new Error(`${label} model "${model}" has no published version to run.`);
  versionCache.set(model, id);
  return id;
}

// Create a Replicate prediction for `model`, wait for it, and download the audio it returns.
// Shared by music generation and text-to-speech (`label` only shapes error messages).
async function runReplicatePrediction({ model, token, input, label, pinned = '', envName }) {
  const version = await resolveModelVersion(model, token, { pinned, envName, label });
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, input }),
  });
  let pred = await create.json().catch(() => ({}));
  if (!create.ok) {
    // A pinned/cached version can go stale — forget it so the next attempt looks it up again.
    if (create.status === 404 || create.status === 422) versionCache.delete(model);
    const detail = typeof pred?.detail === 'string' ? pred.detail : JSON.stringify(pred?.detail || pred?.error || '');
    throw new Error(detail || `Replicate request failed (${create.status})`);
  }
  const pollUrl = pred?.urls?.get || (pred?.id ? `https://api.replicate.com/v1/predictions/${pred.id}` : null);
  if (!pollUrl || !String(pollUrl).startsWith('https://api.replicate.com/')) {
    throw new Error('Replicate did not return a prediction to poll');
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (pred.status !== 'succeeded') {
    if (pred.status === 'failed' || pred.status === 'canceled') {
      throw new Error(String(pred.error || `${label} generation ${pred.status}`).slice(0, 300));
    }
    if (Date.now() > deadline) throw new Error(`${label} generation timed out — try again`);
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } });
    const next = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(next?.detail || `Replicate status failed (${res.status})`);
    pred = next;
  }
  const out = pred.output;
  const url = typeof out === 'string' ? out : (Array.isArray(out) ? out[0] : out?.url);
  if (!url) throw new Error('Replicate returned no audio');
  return downloadAudio(url);
}

function createReplicateProvider() {
  const model = process.env.MUSIC_REPLICATE_MODEL || 'meta/musicgen';
  const modelVersion = process.env.MUSIC_REPLICATE_MODEL_VERSION || 'stereo-large';
  // MusicGen is trained on clips of up to 30s; longer videos are covered by crossfaded looping
  // (see musicFit.js), not by asking the model for more than it handles well.
  const maxClipS = Math.min(30, Number(process.env.MUSIC_MAX_CLIP_SECONDS) || 30);

  return {
    name: 'replicate',
    model,
    maxClipS,
    describe() {
      return {
        name: 'replicate',
        model: `${model} (${modelVersion})`,
        configured: Boolean(process.env.REPLICATE_API_TOKEN),
        note: process.env.REPLICATE_API_TOKEN ? undefined : 'REPLICATE_API_TOKEN is not set on this server.',
      };
    },
    async generate({ prompt, durationS, seed }) {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) throw new Error('REPLICATE_API_TOKEN is not configured — music generation is unavailable');

      const input = {
        prompt,
        model_version: modelVersion,
        duration: Math.max(1, Math.min(maxClipS, Math.round(durationS))),
        output_format: 'wav',
        normalization_strategy: 'loudness',
        seed,
      };
      return runReplicatePrediction({
        model, token, input, label: 'Music',
        pinned: process.env.MUSIC_REPLICATE_VERSION, envName: 'MUSIC_REPLICATE_MODEL',
      });
    },
  };
}

// Deterministic-by-seed chord pad. Not music you would want to keep — it exists so the whole
// pipeline (fit, loop, duck, mix, export) can be exercised without a token or network.
function createFakeProvider() {
  return {
    name: 'fake',
    model: 'ffmpeg-synth',
    maxClipS: 10,
    describe() {
      return { name: 'fake', model: 'ffmpeg-synth', configured: true, note: 'Test backend — synthesised tones, not real music.' };
    },
    async generate({ durationS, seed }) {
      const fs = require('fs/promises');
      const os = require('os');
      const path = require('path');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-fakemusic-'));
      try {
        const root = 110 + (Math.abs(Number(seed) || 0) % 7) * 12;
        const d = Math.max(1, Math.min(10, durationS));
        const out = path.join(dir, 'fake.wav');
        const src = [root, root * 1.25, root * 1.5].map((f) => `sine=f=${f.toFixed(2)}:d=${d}`);
        await execFileAsync(FFMPEG, [
          '-y', ...src.flatMap((s) => ['-f', 'lavfi', '-i', s]),
          '-filter_complex', '[0][1][2]amix=inputs=3:normalize=0,volume=0.5,aformat=sample_rates=44100:channel_layouts=stereo',
          out,
        ], 60000);
        return await fs.readFile(out);
      } finally {
        fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}

let cached = null;
function getMusicProvider() {
  if (cached) return cached;
  cached = process.env.MUSIC_PROVIDER === 'fake' ? createFakeProvider() : createReplicateProvider();
  return cached;
}

module.exports = { runReplicatePrediction, getMusicProvider, createReplicateProvider, createFakeProvider, isReplicateAudioUrl, _clearVersionCache: () => versionCache.clear() };
