'use strict';

// Mood presets → MusicGen prompt text. Pure, no I/O. The backend only ever sees the final prompt
// string, so presets can be tuned here without touching providers.

const INSTRUMENTAL_SUFFIX = 'instrumental only, no vocals, no singing, no lyrics, no spoken words';

const MOOD_PRESETS = [
  { id: 'upbeat-vlog', label: 'Upbeat vlog', prompt: 'upbeat, bright and cheerful vlog background music, light acoustic guitar, claps and soft drums, positive modern pop feel', defaultBpm: 118 },
  { id: 'cinematic-tension', label: 'Cinematic tension', prompt: 'cinematic tension underscore, low string ostinato, deep pulsing synth bass, rising dread, sparse percussion hits', defaultBpm: 90 },
  { id: 'calm-corporate', label: 'Calm corporate', prompt: 'calm, clean corporate background music, soft piano and warm pads, gentle light percussion, confident and optimistic, unobtrusive', defaultBpm: 100 },
  { id: 'travel-montage', label: 'Travel montage', prompt: 'uplifting travel montage music, adventurous acoustic guitar, hand percussion, warm synth swells, sense of discovery and open horizons', defaultBpm: 112 },
  { id: 'suspense', label: 'Suspense', prompt: 'suspenseful ambient soundscape, sparse dissonant strings, soft low drones, ticking pulse, quiet and uneasy', defaultBpm: 80 },
  { id: 'documentary', label: 'Documentary', prompt: 'thoughtful documentary background score, warm piano and soft strings, gentle slow build, reflective and human', defaultBpm: 84 },
  { id: 'lofi-chill', label: 'Lo-fi chill', prompt: 'lo-fi chill hip hop beat, mellow electric piano chords, dusty vinyl crackle, soft boom-bap drums, smooth and relaxed', defaultBpm: 76 },
];

const CUSTOM_ID = 'custom';
const MAX_CUSTOM_CHARS = 400;

function getMood(id) {
  return MOOD_PRESETS.find((m) => m.id === id) || null;
}

function cleanText(value, max) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Valid BPM or null (outside 40-220 is ignored rather than guessed at). */
function parseBpm(value) {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 40 && n <= 220 ? n : null;
}

/**
 * @param {{ mood?: string, custom?: string, bpm?: number|string }} input
 * @returns {{ prompt: string, mood: string, bpm: number|null }}
 * Throws a user-facing Error when neither a known preset nor a custom prompt is given.
 */
function buildMusicPrompt({ mood, custom, bpm } = {}) {
  const customText = cleanText(custom, MAX_CUSTOM_CHARS);
  const preset = getMood(mood);
  if (!preset && !customText) throw new Error('Pick a mood or describe the music you want');

  const bpmValue = parseBpm(bpm);
  const parts = [];
  if (mood === CUSTOM_ID || !preset) parts.push(customText);
  else {
    parts.push(preset.prompt);
    if (customText) parts.push(customText);
  }
  if (bpmValue) parts.push(`${bpmValue} BPM`);
  parts.push(INSTRUMENTAL_SUFFIX);
  return { prompt: parts.join(', '), mood: preset && mood !== CUSTOM_ID ? preset.id : CUSTOM_ID, bpm: bpmValue };
}

module.exports = { MOOD_PRESETS, CUSTOM_ID, INSTRUMENTAL_SUFFIX, buildMusicPrompt, parseBpm, getMood };
