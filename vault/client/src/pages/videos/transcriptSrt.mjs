// Carries edits made to the readable transcript back into the timestamped SRT.
// The readable transcript is one line per subtitle (server `srtToPlainText`), so when the number of lines is
// unchanged each edited line replaces the matching subtitle's text and the timings stay as they were.
// If lines were added or removed there is no safe way to know which timing each belongs to, so the original SRT is kept.

function cuesOf(srt) {
  return String(srt || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean))
    .map((lines) => {
      const t = lines.findIndex((l) => l.includes('-->'));
      if (t < 0) return null;
      return { head: lines.slice(0, t + 1), text: lines.slice(t + 1).join(' ').replace(/\s+/g, ' ').trim() };
    })
    .filter((c) => c && c.text);
}

/** @returns {{ srt: string, applied: boolean }} applied=false when the line count changed and the original was kept */
export function applyEditedText(srt, editedText) {
  const cues = cuesOf(srt);
  const lines = String(editedText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const original = cues.map((c) => c.text);
  const unchanged = lines.length === original.length && lines.every((l, i) => l === original[i]);
  if (unchanged) return { srt, applied: true };
  if (lines.length !== cues.length) return { srt, applied: false };
  const out = cues.map((c, i) => `${c.head.join('\n')}\n${lines[i]}`).join('\n\n');
  return { srt: `${out}\n`, applied: true };
}
