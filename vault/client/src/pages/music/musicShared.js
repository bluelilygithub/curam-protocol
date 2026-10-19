// Small pieces shared by the Music page and its tool components.

export const POLL_MS = 2000;
export const DEFAULT_SETTINGS = { volume: 70, ducking: 'light' };
export const DUCKING_OPTIONS = [['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']];

export const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
export const field = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
export const muted = { color: 'var(--color-muted)' };

export function formatDuration(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${s.toFixed(1)}s`;
}

// `voice` = job.voice; its level/start only travel with the request when there is a voiceover.
export const qs = (s, voice) => `volume=${(s.volume / 100).toFixed(2)}&ducking=${s.ducking}`
  + (voice ? `&voiceVolume=${(s.voiceVolume / 100).toFixed(2)}&voiceStart=${s.voiceStart}` : '');
