'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const VOICE_DIR = process.env.LOCAL_VOICE_DIR || path.join(os.homedir(), '.local/share/vault/voice');
const REF_AUDIO_PATH = path.join(VOICE_DIR, 'reference.wav');
const PROFILE_PATH = path.join(VOICE_DIR, 'profile.json');

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureVoiceDir() {
  await fs.mkdir(VOICE_DIR, { recursive: true });
}

async function loadProfile() {
  try {
    const raw = await fs.readFile(PROFILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function saveProfile(profile) {
  await ensureVoiceDir();
  await fs.writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
}

async function getLocalVoiceStatus() {
  const profile = await loadProfile();
  const refText = String(profile.refText || '').trim();
  const refAudioExists = await pathExists(REF_AUDIO_PATH);
  return {
    voiceDir: VOICE_DIR,
    refAudioPath: REF_AUDIO_PATH,
    refAudioExists,
    refTextSet: refText.length > 0,
    refText,
    refTextPreview: refText.slice(0, 120),
    configured: refAudioExists && refText.length > 0,
    updatedAt: profile.updatedAt || null,
  };
}

async function getReferencePaths() {
  const status = await getLocalVoiceStatus();
  if (!status.configured) return null;
  const profile = await loadProfile();
  return {
    refAudioPath: REF_AUDIO_PATH,
    refText: String(profile.refText || '').trim(),
  };
}

module.exports = {
  VOICE_DIR,
  REF_AUDIO_PATH,
  PROFILE_PATH,
  ensureVoiceDir,
  loadProfile,
  saveProfile,
  getLocalVoiceStatus,
  getReferencePaths,
  pathExists,
};
