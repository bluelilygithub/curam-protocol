// Small pure helpers for the voice-note recorder (VoiceNoteRecorder.jsx). No DOM, so they are unit-tested
// (node client/src/pages/notes/voiceNoteUtils.test.mjs).

/** The longest recording, in seconds. The server turns about an hour of speech into text in one go. */
export const MAX_RECORD_SEC = 60 * 60;
/** From here the recorder tells the person it is nearly full. */
export const WARN_RECORD_SEC = 55 * 60;

// Best first. Safari records MP4/AAC; Chrome and Firefox record WebM or Ogg with Opus.
const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

/** The first type in the preference list that `isSupported(type)` accepts, or '' to let the browser choose. */
export function pickMimeType(isSupported) {
  if (typeof isSupported !== 'function') return '';
  return MIME_PREFERENCE.find((t) => { try { return isSupported(t); } catch { return false; } }) || '';
}

/** File extension for a recorder MIME type (the server uses it to name the temporary file). */
export function extensionForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatTimer(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** A plain-words explanation for a failure to start the microphone. */
export function describeMicError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The microphone is blocked. Allow it for this site in your browser (the padlock next to the address), then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in or check your device settings, then try again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is being used by another app. Close it there and try again.';
  return 'The microphone could not be started. Check it is connected and allowed, then try again.';
}

/** True when this browser can record from a microphone at all (needs a secure page: https or localhost). */
export function canRecord(win) {
  return Boolean(win && 'MediaRecorder' in win && win.navigator?.mediaDevices?.getUserMedia);
}

// ---- what the person chooses before recording, remembered on this device ----

/** How the recording is written up. `value` is what the server's `style` field takes. */
export const STYLE_CHOICES = [
  { value: 'notes', label: 'Notes: summary, ideas, plan, to-dos', hint: 'Good for ideas and plans.' },
  { value: 'update', label: 'Update: what happened, decisions, next steps', hint: 'Good for a progress update.' },
  { value: 'todo', label: 'To-do list', hint: 'Just the things to do, in order.' },
  { value: 'meeting', label: 'Meeting notes: discussion, decisions, actions', hint: 'Good for a conversation between people.' },
  { value: 'words', label: 'Just my words, as spoken', hint: 'No rewriting at all.' },
];

/** What happens to the audio. `value` is the server's `keep` field. Nothing is kept unless this is changed. */
export const KEEP_CHOICES = [
  { value: 'no', label: "Don't keep the audio" },
  { value: '7d', label: 'Keep it for 7 days' },
  { value: 'forever', label: 'Keep it until I delete it' },
];

export const PREFS_KEY = 'vault:notes:voice-prefs';
export const DEFAULT_PREFS = { style: 'notes', keep: 'no' };

/** The remembered choices, checked: anything unknown or unreadable falls back to the defaults (write it up as notes, keep nothing). */
export function readPrefs(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) || '{}');
    return {
      style: STYLE_CHOICES.some((c) => c.value === saved.style) ? saved.style : DEFAULT_PREFS.style,
      keep: KEEP_CHOICES.some((c) => c.value === saved.keep) ? saved.keep : DEFAULT_PREFS.keep,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage, prefs) {
  try { storage?.setItem(PREFS_KEY, JSON.stringify({ style: prefs.style, keep: prefs.keep })); } catch { /* not remembered in a private window */ }
}

/** The line beside a kept recording: how long it stays. `expiresAt` null/undefined means until the person deletes it. */
export function describeKept(expiresAt, now = new Date()) {
  if (!expiresAt) return 'Kept until you delete it';
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return 'Kept until you delete it';
  const days = Math.max(0, Math.ceil(ms / 86400000));
  if (days <= 0) return 'Removed soon';
  return days === 1 ? 'Kept for 1 more day, then removed' : `Kept for ${days} more days, then removed`;
}

/** The wording for an unfinished recording found on this device: "3:12 recorded on 24 Oct at 2:35 pm". */
export function describeRecovered(meta, now = new Date()) {
  const start = new Date(meta?.startedAt);
  const length = formatTimer(meta?.elapsed || 0);
  if (Number.isNaN(start.getTime())) return `${length} recorded`;
  const day = start.toDateString() === now.toDateString() ? 'today' : `on ${start.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][start.getMonth()]}`;
  const h = start.getHours();
  const time = `${h % 12 || 12}:${String(start.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return `${length} recorded ${day} at ${time}`;
}
