'use strict';

/**
 * The local cloned-voice profile (reference recording + its transcript), kept per person.
 * Each user's profile lives under VOICE_DIR/users/<userId>/. The single shared profile that older
 * versions kept directly in VOICE_DIR is still readable by an administrator who has not saved one of
 * their own yet, and by nobody else; saving always writes to the caller's own folder.
 */

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const VOICE_DIR = process.env.LOCAL_VOICE_DIR || path.join(os.homedir(), '.local/share/vault/voice');
const LEGACY_PATHS = {
  dir: VOICE_DIR,
  refAudio: path.join(VOICE_DIR, 'reference.wav'),
  profile: path.join(VOICE_DIR, 'profile.json'),
};

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

// Where this person's own profile files are. A signed-in user is required: there is no "shared" profile.
function userVoicePaths(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('A signed-in user is required for a voice profile.');
  const dir = path.join(VOICE_DIR, 'users', String(id));
  return { dir, refAudio: path.join(dir, 'reference.wav'), profile: path.join(dir, 'profile.json') };
}

// The files to READ for this person: their own, or (administrators only, until they save their own)
// the old shared ones.
async function resolveVoicePaths(userId, isAdmin = false) {
  const own = userVoicePaths(userId);
  if (!isAdmin) return own;
  if ((await pathExists(own.profile)) || (await pathExists(own.refAudio))) return own;
  if ((await pathExists(LEGACY_PATHS.profile)) || (await pathExists(LEGACY_PATHS.refAudio))) return LEGACY_PATHS;
  return own;
}

async function ensureVoiceDir(userId) {
  await fs.mkdir(userVoicePaths(userId).dir, { recursive: true });
}

async function loadProfile(userId, isAdmin = false) {
  try {
    const { profile } = await resolveVoicePaths(userId, isAdmin);
    return JSON.parse(await fs.readFile(profile, 'utf8'));
  } catch (_) {
    return {};
  }
}

async function saveProfile(userId, profile) {
  await ensureVoiceDir(userId);
  await fs.writeFile(userVoicePaths(userId).profile, JSON.stringify(profile, null, 2), 'utf8');
}

async function getLocalVoiceStatus(userId, isAdmin = false) {
  const paths = await resolveVoicePaths(userId, isAdmin);
  const profile = await loadProfile(userId, isAdmin);
  const refText = String(profile.refText || '').trim();
  const refAudioExists = await pathExists(paths.refAudio);
  return {
    voiceDir: paths.dir,
    refAudioPath: paths.refAudio,
    refAudioExists,
    refTextSet: refText.length > 0,
    refText,
    refTextPreview: refText.slice(0, 120),
    configured: refAudioExists && refText.length > 0,
    updatedAt: profile.updatedAt || null,
  };
}

async function getReferencePaths(userId, isAdmin = false) {
  const status = await getLocalVoiceStatus(userId, isAdmin);
  if (!status.configured) return null;
  const profile = await loadProfile(userId, isAdmin);
  const { refAudio } = await resolveVoicePaths(userId, isAdmin);
  return {
    refAudioPath: refAudio,
    refText: String(profile.refText || '').trim(),
  };
}

module.exports = {
  VOICE_DIR,
  userVoicePaths,
  resolveVoicePaths,
  ensureVoiceDir,
  loadProfile,
  saveProfile,
  getLocalVoiceStatus,
  getReferencePaths,
  pathExists,
};
