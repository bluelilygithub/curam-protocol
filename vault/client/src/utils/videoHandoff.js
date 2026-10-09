// Hands a video File from one page to another without re-uploading (Video Tools -> Music).
// Held in memory only: it survives in-app navigation, not a reload, and is consumed once.

let pending = null;

export function setVideoHandoff(file) {
  pending = file || null;
}

export function takeVideoHandoff() {
  const file = pending;
  pending = null;
  return file;
}
