// The small pure helpers of the Drawings page (no React, no Excalidraw), so they can be tested with `node sceneLogic.test.mjs`.

/** A short fingerprint of what is drawn: changes whenever a piece is added, edited, moved or deleted, or a picture is added. */
export function sceneSignature(elements, files) {
  let h = 5381;
  const mix = (str) => { for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0; };
  for (const e of elements || []) mix(`${e.id}:${e.version}:${e.versionNonce};`);
  mix(`|${Object.keys(files || {}).sort().join(',')}`);
  return `${(elements || []).length}.${(h >>> 0).toString(36)}`;
}

/** A safe file name from a drawing's title: letters, digits, spaces, dashes; never empty. */
export function fileNameFor(title, ext) {
  const base = String(title || '').replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'drawing';
  return `${base}.${ext}`;
}

/** The title for a drawing made from a file name: "Floor plan.excalidraw" becomes "Floor plan". */
export function titleFromFileName(name) {
  return String(name || '').replace(/\.(excalidraw|json)$/i, '').replace(/[_]+/g, ' ').trim() || 'Imported drawing';
}

/** Is a CSS colour (hex or rgb()) dark? Used to give the editor the matching light or dark look. */
export function isDarkColour(css) {
  const s = String(css || '').trim();
  let r; let g; let b;
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else {
    m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (!m) return false;
    [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}

/**
 * Checks the text of a file a person chose to open: is it a drawing from Excalidraw? Returns { ok: true, scene } or { ok: false, error }.
 * (The server checks again; this gives the answer without a round trip.)
 */
export function readSceneFile(text) {
  let scene;
  try { scene = JSON.parse(text); } catch { return { ok: false, error: 'That file is not a drawing (it is not readable).' }; }
  if (scene && scene.type === 'excalidrawlib') return { ok: false, error: 'That is a shape library, not a drawing. Open it from the Library button inside a drawing.' };
  if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) return { ok: false, error: 'That file is not an Excalidraw drawing.' };
  return { ok: true, scene };
}

/** The words next to the save indicator. status: 'saved' | 'saving' | 'dirty' | 'error' | 'changed' | 'idle'. */
export function saveLabel(status, savedAt, detail = '') {
  const t = savedAt instanceof Date && !Number.isNaN(savedAt.getTime()) ? savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  if (status === 'saving') return 'Saving…';
  if (status === 'dirty') return 'Changes not saved yet…';
  if (status === 'saved') return t ? `Saved at ${t}` : 'Saved';
  if (status === 'changed') return 'Changed in another tab. Reload to see it.';
  if (status === 'error') return detail || 'Could not save. Your drawing is still here; it will try again.';
  return '';
}

/** "3 pieces", "1 piece", "Empty". */
export function pieceCount(n) {
  const k = Number(n) || 0;
  return k === 0 ? 'Empty' : `${k} piece${k === 1 ? '' : 's'}`;
}

/** Drawings whose title contains the search words (all of them), newest first as given. */
export function filterDrawings(list, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((d) => words.every((w) => String(d.title || '').toLowerCase().includes(w)));
}
