// Hands a File from one tool to another, across pages, without re-uploading (Music <-> Video Tools).
// Held in memory only: it survives in-app navigation, not a reload. Each file is meant for ONE tool and is
// consumed once, so opening a tool by hand never picks up a stale file. (utils/videoHandoff.js is the older
// "a video for the Music page" version of the same idea.)

const pending = new Map();

/** Leave `file` for the tool `toolId` to pick up. A newer file for the same tool replaces the older one. */
export function setToolHandoff(toolId, file) {
  if (!toolId) return;
  if (file) pending.set(toolId, file);
  else pending.delete(toolId);
}

/** The file left for `toolId` (or null), and forget it. */
export function takeToolHandoff(toolId) {
  const file = pending.get(toolId) || null;
  pending.delete(toolId);
  return file;
}

/** Forget everything (tests). */
export function clearToolHandoffs() {
  pending.clear();
}
