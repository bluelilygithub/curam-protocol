// "Let the AI look": makes the small JPEG copies IN THE BROWSER (nothing is uploaded to make them). The original pictures and videos never leave the
// person's computer; only these copies are sent, and only when the box is ticked. The pure parts (sizes, times, texts) are in visionFrames.mjs.

import { fitWithin, frameTimes, MAX_PX } from './visionFrames.mjs';

const QUALITY = 0.72;
const STEP_TIMEOUT_MS = 10000; // a clip the browser cannot read must not hang the page

function toBase64(canvas) {
  const url = canvas.toDataURL('image/jpeg', QUALITY);
  return url.slice(url.indexOf(',') + 1);
}

function drawScaled(source, sw, sh, maxPx) {
  const { w, h } = fitWithin(sw, sh, maxPx);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h); // a transparent picture (PNG) would turn black in a JPEG anyway: say so, do not leave it to chance
  ctx.drawImage(source, 0, 0, w, h);
  return toBase64(canvas);
}

/** One picture file -> one small base64 JPEG (no "data:" prefix). Throws when the browser cannot read the file. */
export async function captureImage(file, maxPx = MAX_PX) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return drawScaled(bitmap, bitmap.width, bitmap.height, maxPx);
  } finally {
    if (bitmap.close) bitmap.close();
  }
}

function once(target, ok, bad = 'error') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timed out')); }, STEP_TIMEOUT_MS);
    const onOk = () => { cleanup(); resolve(); };
    const onBad = () => { cleanup(); reject(new Error('the browser could not read this video')); };
    function cleanup() { clearTimeout(timer); target.removeEventListener(ok, onOk); target.removeEventListener(bad, onBad); }
    target.addEventListener(ok, onOk);
    target.addEventListener(bad, onBad);
  });
}

/** One video file -> `count` small base64 JPEG frames. Throws when the browser cannot read the video. */
export async function captureVideoFrames(file, count, maxPx = MAX_PX) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  try {
    video.src = url;
    await once(video, 'loadedmetadata');
    const frames = [];
    for (const t of frameTimes(video.duration, count)) {
      const seeked = once(video, 'seeked');
      video.currentTime = t;
      await seeked;
      frames.push(drawScaled(video, video.videoWidth, video.videoHeight, maxPx));
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Small copies for a whole plan. `makeOne(file)` returns the frames for one file (an array). A file the browser cannot read gets no frames (the plan then
 * relies on its name alone) and is counted in `failed`. @returns {{ items: Array<{ name, frames }>, failed: number, taken: number }}
 */
export async function captureAll(files, makeOne, onProgress) {
  const items = [];
  let failed = 0;
  let taken = 0;
  for (let i = 0; i < files.length; i += 1) {
    if (onProgress) onProgress(i + 1, files.length);
    try {
      const frames = await makeOne(files[i]);
      taken += frames.length;
      items.push({ name: files[i].name, frames });
    } catch {
      failed += 1;
      items.push({ name: files[i].name, frames: [] });
    }
  }
  return { items, failed, taken };
}
