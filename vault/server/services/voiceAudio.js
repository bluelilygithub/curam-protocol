'use strict';

// Voice notes: the audio of a recording is thrown away unless the person chose to keep it, for a while or for good. Pure helpers here (no
// database, no files) so they are unit-tested; the route and server/utils/attachments.js do the storing. node server/services/voiceAudio.test.js

const KEEP_DAYS = Math.max(1, parseInt(process.env.VOICE_AUDIO_DAYS, 10) || 7);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HINT_NAMES = 80;
const MAX_HINT_CHARS = 60;

/** What the person chose, as the server understands it: 'no' (default), 'days' (kept KEEP_DAYS days) or 'forever'. Anything else is 'no'. */
function parseKeep(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'forever' || v === 'keep') return 'forever';
  if (v === '7d' || v === 'days' || v === 'week') return 'days';
  return 'no';
}

/** When the audio should be removed, for a choice made at `now`: a Date, or null for "never" (forever). Undefined for "no" (nothing is stored). */
function expiryFor(keep, now = new Date()) {
  const k = parseKeep(keep);
  if (k === 'no') return undefined;
  if (k === 'forever') return null;
  return new Date(now.getTime() + KEEP_DAYS * DAY_MS);
}

/** Whole days left until `expiresAt` (never negative), or null when it is kept for good. Used for the wording next to the player. */
function daysLeft(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

const EXT_BY_MIME = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

/** The mime type to store with the audio: the recorder's, without its codecs part, and only an audio one (else audio/webm). */
function audioMime(mime) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[m] ? m : 'audio/webm';
}

/** "Voice note 24 Oct 2.35 pm.webm": what the kept audio is called. */
function audioFilename(mime, now = new Date()) {
  const day = now.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' ').toLowerCase().replace(':', '.');
  return `Voice note ${day} ${time}.${EXT_BY_MIME[audioMime(mime)]}`;
}

/** Names (clients, projects, contacts) given to the speech-to-text and the write-up so they are spelled right: tidy, no repeats, bounded. */
function cleanNames(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_HINT_CHARS);
    const key = name.toLowerCase();
    if (name.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_HINT_NAMES) break;
  }
  return out;
}

/** One line for a model prompt, or '' when there are no names. */
function namesLine(list) {
  const names = cleanNames(list);
  return names.length ? `Names that may be spoken (spell them exactly like this if you hear them): ${names.join(', ')}.` : '';
}

module.exports = { KEEP_DAYS, parseKeep, expiryFor, daysLeft, audioMime, audioFilename, cleanNames, namesLine, MAX_HINT_NAMES };
