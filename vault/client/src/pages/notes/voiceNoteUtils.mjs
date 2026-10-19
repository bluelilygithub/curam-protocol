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
