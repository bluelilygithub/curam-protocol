'use strict';

// Runs the per-pixel Graphics jobs (Recolor, Extract Element, Image Diff, Print Ready's CMYK conversion, Vectorize) in a
// worker thread. They are plain JavaScript loops over millions of pixels, and on the main thread each one froze the whole server,
// every other person's requests included, for seconds at a time.
//
//   const { runPixelTask } = require('./graphicsWorker');
//   const { out, matched } = await runPixelTask('recolor', { data, channels, source, target, maxDist, mode });
//
// At most `MAX_WORKERS` run at once; the rest wait their turn. Pixel buffers are copied in (the callers keep their own) and the
// result buffer is transferred back, not copied. Each task is a pure function of its input, so it is also unit-testable on its own.

const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// ---- the tasks (these run inside the worker; exported for tests) ---------------------------------------------------------

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

const tasks = {
  // Swap one colour for another wherever it appears (within a tolerance, with a soft edge).
  recolor({ data, channels, source, target, maxDist, mode }) {
    const px = new Uint8Array(data);
    const targetHsl = rgbToHsl(target.r, target.g, target.b);
    const sourceHsl = rgbToHsl(source.r, source.g, source.b);
    const lShift = targetHsl.l - sourceHsl.l;
    let matched = 0;
    for (let i = 0; i < px.length; i += channels) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const dist = Math.sqrt((r - source.r) ** 2 + (g - source.g) ** 2 + (b - source.b) ** 2);
      if (dist > maxDist) continue;
      const weight = maxDist > 0 ? Math.min(1, 1 - dist / maxDist + 0.15) : 1; // soft falloff at the edge of the band
      const p = rgbToHsl(r, g, b);
      const newL = mode === 'preserve' ? p.l : Math.min(1, Math.max(0, p.l + lShift));
      const recol = hslToRgb(targetHsl.h, targetHsl.s, newL);
      px[i] = Math.round(r + (recol.r - r) * weight);
      px[i + 1] = Math.round(g + (recol.g - g) * weight);
      px[i + 2] = Math.round(b + (recol.b - b) * weight);
      matched += 1;
    }
    return { result: { matched }, buffers: { out: px } };
  },

  // Multiply an RGBA image's alpha by a one-channel mask (255 = keep).
  extract({ rgba, mask }) {
    const src = new Uint8Array(rgba);
    const m = new Uint8Array(mask);
    const n = m.length;
    for (let i = 0; i < n; i += 1) src[i * 4 + 3] = Math.round(src[i * 4 + 3] * (m[i] / 255));
    return { result: {}, buffers: { out: src } };
  },

  // Red where two RGBA images differ by more than `threshold`, a washed-out copy of the first elsewhere.
  diff({ a, b, threshold }) {
    const da = new Uint8Array(a);
    const db = new Uint8Array(b);
    const out = new Uint8Array(da.length);
    let diffCount = 0;
    for (let i = 0; i < da.length; i += 4) {
      const maxd = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (maxd > threshold) {
        out[i] = 255; out[i + 1] = 16; out[i + 2] = 64; out[i + 3] = 255;
        diffCount += 1;
      } else {
        const gray = (da[i] + da[i + 1] + da[i + 2]) / 3;
        const dim = Math.round(gray * 0.45 + 130); // washed-out context
        out[i] = dim; out[i + 1] = dim; out[i + 2] = dim; out[i + 3] = 255;
      }
    }
    return { result: { diffCount }, buffers: { out } };
  },

  // Interleaved RGB bytes to interleaved CMYK bytes (standard device-independent formula).
  cmyk({ rgb, pixelCount }) {
    const src = new Uint8Array(rgb);
    const out = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i += 1) {
      const r = src[i * 3] / 255;
      const g = src[i * 3 + 1] / 255;
      const b = src[i * 3 + 2] / 255;
      const k = 1 - Math.max(r, g, b);
      if (k >= 1) {
        out[i * 4 + 3] = 255;
      } else {
        const d = 1 - k;
        out[i * 4] = Math.round(((1 - r - k) / d) * 255);
        out[i * 4 + 1] = Math.round(((1 - g - k) / d) * 255);
        out[i * 4 + 2] = Math.round(((1 - b - k) / d) * 255);
        out[i * 4 + 3] = Math.round(k * 255);
      }
    }
    return { result: {}, buffers: { out } };
  },

  // Trace RGBA pixels into an SVG string.
  vectorize({ data, width, height, options }) {
    // eslint-disable-next-line global-require
    const ImageTracer = require('imagetracerjs');
    const svg = ImageTracer.imagedataToSVG({ width, height, data: new Uint8ClampedArray(data) }, options);
    return { result: { svg }, buffers: {} };
  },
};

// ---- worker side ---------------------------------------------------------------------------------------------------------

if (!isMainThread && workerData && workerData.__graphicsTask) {
  try {
    const { task, payload } = workerData;
    const { result, buffers } = tasks[task](payload);
    const transfer = Object.values(buffers).map((u8) => u8.buffer);
    parentPort.postMessage({ ok: true, result, buffers }, transfer);
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message || 'Image task failed' });
  }
}

// ---- main-thread side ----------------------------------------------------------------------------------------------------

const MAX_WORKERS = Math.max(1, Number(process.env.GRAPHICS_MAX_WORKERS) || 2);
const MAX_QUEUED = 12;
const TASK_TIMEOUT_MS = 120000;
let running = 0;
const waiting = [];

function startWorker(task, payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { __graphicsTask: true, task, payload } });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('That image took too long to process')); }, TASK_TIMEOUT_MS);
    worker.once('message', (msg) => {
      clearTimeout(timer);
      if (!msg.ok) return reject(new Error(msg.error));
      const out = {};
      Object.entries(msg.buffers || {}).forEach(([k, u8]) => { out[k] = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength); });
      return resolve({ ...msg.result, ...out });
    });
    worker.once('error', (err) => { clearTimeout(timer); reject(err); });
    worker.once('exit', (code) => { clearTimeout(timer); if (code !== 0) reject(new Error('Image worker stopped unexpectedly')); });
  });
}

/** Run one pixel task off the main thread. Resolves the task's result fields plus its output buffers (as Buffers). */
function runPixelTask(task, payload) {
  if (!tasks[task]) return Promise.reject(new Error(`Unknown image task ${task}`));
  return new Promise((resolve, reject) => {
    const go = () => {
      running += 1;
      startWorker(task, payload)
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (running < MAX_WORKERS) return go();
    if (waiting.length >= MAX_QUEUED) return reject(Object.assign(new Error('The image processor is busy. Try again in a moment.'), { status: 503 }));
    waiting.push(go);
    return undefined;
  });
}

module.exports = { runPixelTask, tasks, rgbToHsl, hslToRgb };
