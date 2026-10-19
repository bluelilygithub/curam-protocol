'use strict';

// Turn a script into a speech WAV (44.1 kHz stereo) with the configured voice provider. Used by Video Tools' Mix audio
// ("write a script" instead of uploading a recording); the Music page does the same inside its own job directory.

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { prepareVoiceover } = require('./music/musicFit');

/**
 * @param {{ speak: Function }} provider  a voice provider (voiceProviders.getVoiceProvider())
 * @param {{ text: string, voice: string, speed: number }} speech  already checked by normalizeSpeech()
 * @returns {Promise<Buffer>} WAV bytes
 */
async function speakToWav(provider, speech, deps = {}) {
  const prepare = deps.prepare || prepareVoiceover;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-speak-'));
  try {
    const raw = await provider.speak(speech);
    const src = path.join(dir, 'speech.audio');
    const out = path.join(dir, 'speech.wav');
    await fs.writeFile(src, raw);
    await prepare(src, out);
    return await fs.readFile(out);
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { speakToWav };
