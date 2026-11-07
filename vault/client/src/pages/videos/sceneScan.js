// Video Tools: looks through a video IN THE BROWSER (a hidden copy of the video, seeked frame by frame into a tiny canvas) to find shot changes and good
// thumbnail frames. Nothing is uploaded and nothing is paid for. The decisions are made by the pure code in sceneCuts.mjs.

import { lumaFrom, sampleTimes, detectCuts, bisectCut, frameDiff, pickThumbnails, THUMB_W, THUMB_H } from './sceneCuts.mjs';

const SEEK_TIMEOUT_MS = 4000;

/** A hidden copy of the video, ready to seek. Always call close(). */
async function openVideo(src, width, height) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = src;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 10000);
    video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('the browser could not read this video')); }, { once: true });
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    video, canvas, ctx,
    close() { video.removeAttribute('src'); video.load(); },
  };
}

function seekTo(video, t) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(guard); video.removeEventListener('seeked', finish); resolve(); };
    const guard = setTimeout(finish, SEEK_TIMEOUT_MS); // some browsers do not fire "seeked" for the time they are already at
    video.addEventListener('seeked', finish);
    video.currentTime = t;
  });
}

function grab(v) {
  v.ctx.drawImage(v.video, 0, 0, v.canvas.width, v.canvas.height);
  return lumaFrom(v.ctx.getImageData(0, 0, v.canvas.width, v.canvas.height).data);
}

/**
 * Shot changes in a video, in seconds, sorted. Looks at up to 90 evenly spaced frames, then narrows each change down to a fraction of a second.
 * `onProgress(done, total)` is called as it goes; `isCancelled()` stops it (it then throws 'cancelled'). Throws when the browser cannot read the video.
 */
export async function findShotChanges(src, { onProgress, isCancelled } = {}) {
  const v = await openVideo(src, THUMB_W, THUMB_H);
  try {
    const times = sampleTimes(v.video.duration);
    if (times.length < 3) return [];
    const lumas = [];
    for (let i = 0; i < times.length; i += 1) {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      await seekTo(v.video, times[i]);
      lumas.push(grab(v));
      if (onProgress) onProgress(i + 1, times.length);
    }
    const raw = detectCuts(times, lumas);
    const out = [];
    for (const c of raw) {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      const i = times.indexOf(c.t);
      const before = lumas[i - 1];
      const after = lumas[i];
      // is the picture at t already the new shot (closer to the frame after the change than to the one before it)?
      const exact = await bisectCut(c.before, c.t, async (t) => {
        await seekTo(v.video, t);
        const f = grab(v);
        return frameDiff(f, after) < frameDiff(f, before);
      }, 5);
      out.push(exact);
    }
    return [...new Set(out)].sort((a, b) => a - b);
  } finally {
    v.close();
  }
}

/**
 * Up to `count` good, different frames to use as a thumbnail: { t, dataUrl }, best first. Looks at `samples` frames between 3% and 97% of the video (the
 * very start and end are often black or a fade), skips dark, blown-out and flat ones, and removes near-duplicates.
 */
export async function suggestFrames(src, { count = 4, samples = 24, previewWidth = 240, isCancelled } = {}) {
  const AW = 96;
  const AH = 54;
  const v = await openVideo(src, AW, AH);
  try {
    const d = v.video.duration;
    if (!(d > 0)) return [];
    const cands = [];
    for (let i = 0; i < samples; i += 1) {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      const t = Math.round(d * (0.03 + (0.94 * i) / Math.max(1, samples - 1)) * 100) / 100;
      await seekTo(v.video, t);
      cands.push({ t, luma: grab(v) });
    }
    const best = pickThumbnails(cands, AW, { count, minGap: Math.max(1, d * 0.05) });
    const ratio = (v.video.videoHeight || 9) / (v.video.videoWidth || 16);
    const out = [];
    for (const p of best) {
      await seekTo(v.video, p.t);
      const c = document.createElement('canvas');
      c.width = previewWidth;
      c.height = Math.max(24, Math.round(previewWidth * ratio));
      c.getContext('2d').drawImage(v.video, 0, 0, c.width, c.height);
      out.push({ t: p.t, dataUrl: c.toDataURL('image/jpeg', 0.7) });
    }
    return out;
  } finally {
    v.close();
  }
}
