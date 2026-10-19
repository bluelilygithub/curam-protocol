'use strict';

// Renders the same short script through each text-to-speech option that has a key set, so the
// Australian accents can be compared by ear before one is wired into Music (docs/music-plan.md, stage 5).
// Nothing in Vault imports this file.
//
//   node scripts/voiceSamplesAu.js [outputDir]
//
// Keys (read from vault/.env; a provider with no key is skipped):
//   GEMINI_API_KEY            Gemini speech (model override: GEMINI_TTS_MODEL)
//   GOOGLE_TTS_API_KEY        Google Cloud Text-to-Speech (enable the Cloud Text-to-Speech API on that key)
//   AZURE_TTS_KEY + AZURE_TTS_REGION   Azure speech, e.g. AZURE_TTS_REGION=australiaeast
//
// Each call is billed by its provider (a few cents at most for this script). Voice names are
// taken from vendor pages and may have changed: a 4xx error message prints the provider's reply.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const SCRIPT = 'G\'day, and welcome. Whether you are planning a weekend away or just heading down to the shops, '
  + 'we have got you covered. Our new range is available at every store across Australia, from Brisbane to Perth, '
  + 'and you can order online any time. Pop in this Saturday, say hello, and grab a coffee on us. We would love to see you.';

const GEMINI_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const GEMINI_VOICES = ['Kore', 'Charon'];
const GOOGLE_VOICES = ['en-AU-Neural2-A', 'en-AU-Neural2-B', 'en-AU-Wavenet-C', 'en-AU-Wavenet-D'];
const AZURE_VOICES = ['en-AU-NatashaNeural', 'en-AU-WilliamNeural'];

// Gemini returns raw 16-bit mono PCM at 24 kHz; wrap it so it plays anywhere.
function pcmToWav(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function check(res, label) {
  if (res.ok) return res;
  const body = (await res.text().catch(() => '')).slice(0, 400);
  throw new Error(`${label} ${res.status}: ${body}`);
}

async function gemini(voice) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await check(await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Read this in a natural, friendly Australian accent, at an even pace: ${SCRIPT}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  }), 'Gemini');
  const data = await res.json();
  const b64 = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error('Gemini returned no audio');
  return { ext: 'wav', bytes: pcmToWav(Buffer.from(b64, 'base64')) };
}

async function googleCloud(voice) {
  const res = await check(await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_TTS_API_KEY },
    body: JSON.stringify({
      input: { text: SCRIPT },
      voice: { languageCode: 'en-AU', name: voice },
      audioConfig: { audioEncoding: 'MP3' },
    }),
  }), 'Google Cloud TTS');
  const data = await res.json();
  if (!data.audioContent) throw new Error('Google Cloud TTS returned no audio');
  return { ext: 'mp3', bytes: Buffer.from(data.audioContent, 'base64') };
}

async function azure(voice) {
  const region = process.env.AZURE_TTS_REGION;
  const ssml = `<speak version="1.0" xml:lang="en-AU"><voice name="${voice}">${SCRIPT.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</voice></speak>`;
  const res = await check(await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': process.env.AZURE_TTS_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'vault-voice-samples',
    },
    body: ssml,
  }), 'Azure');
  return { ext: 'mp3', bytes: Buffer.from(await res.arrayBuffer()) };
}

const PROVIDERS = [
  { name: 'gemini', ready: Boolean(process.env.GEMINI_API_KEY), voices: GEMINI_VOICES, run: gemini, missing: 'GEMINI_API_KEY' },
  { name: 'google', ready: Boolean(process.env.GOOGLE_TTS_API_KEY), voices: GOOGLE_VOICES, run: googleCloud, missing: 'GOOGLE_TTS_API_KEY' },
  { name: 'azure', ready: Boolean(process.env.AZURE_TTS_KEY && process.env.AZURE_TTS_REGION), voices: AZURE_VOICES, run: azure, missing: 'AZURE_TTS_KEY and AZURE_TTS_REGION' },
];

async function main() {
  const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'vault-voice-samples'));
  await fs.mkdir(outDir, { recursive: true });
  console.log(`Script (${SCRIPT.length} characters):\n${SCRIPT}\n`);
  let made = 0;
  for (const p of PROVIDERS) {
    if (!p.ready) { console.log(`skip ${p.name}: ${p.missing} not set`); continue; }
    for (const voice of p.voices) {
      const started = Date.now();
      try {
        const { ext, bytes } = await p.run(voice);
        const file = path.join(outDir, `${p.name}-${voice}.${ext}`);
        await fs.writeFile(file, bytes);
        made += 1;
        console.log(`ok   ${p.name} ${voice} (${((Date.now() - started) / 1000).toFixed(1)}s) -> ${file}`);
      } catch (err) {
        console.log(`FAIL ${p.name} ${voice}: ${err.message}`);
      }
    }
  }
  console.log(made ? `\n${made} sample(s) in ${outDir}` : '\nNo samples made: set at least one key (see the top of this file).');
}

main().catch((err) => { console.error(err); process.exit(1); });
