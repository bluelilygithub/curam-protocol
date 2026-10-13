// Times as people type them: "90", "90s", "1:30", "1:30.5", "1:02:03", "1m30", "1 min 30 s". Returns seconds, or null when it is not a time.
export function parseClock(input) {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+(?:\.\d+)?\s*s(?:ec(?:onds?)?)?$/.test(s)) return Number(s.replace(/[^\d.]/g, ''));
  if (/^\d+(?::\d{1,2}){1,2}(?:\.\d+)?$/.test(s)) {
    const parts = s.split(':').map(Number);
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/);
  if (m && (m[1] || m[2] || m[3])) return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  const ms = s.match(/^(\d+)\s*m(?:in)?\s*(\d+(?:\.\d+)?)$/); // "1m30"
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  return null;
}

/** Seconds -> "m:ss" (or "m:ss.s" when there is a fraction), the form parseClock reads back. */
export function formatClock(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 10);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return frac > 0 && frac < 10 ? `${base}.${frac}` : base;
}
