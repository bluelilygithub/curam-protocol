// Plant tag scan, part 1: a photo of a nursery tag to the text on it. The reading is done on this device by the shared OCR engine
// (planner-core/ocr, Tesseract.js in a Web Worker): the photo is never uploaded. Only the reading model is downloaded, once, then cached
// by the browser. The photo is tidied first (turned upright, scaled to a size the reader likes, converted to grey and stretched to full
// contrast), because phone photos of shiny plastic tags are low-contrast and often huge.
import type { OcrEngine } from '@planner-core/ocr/ocrEngine';

export interface ScanResult { text: string; meanConf: number; lines: string[] }
/** Under this the reading is probably poor and the person should check it (Tesseract's 0-100 word confidence, averaged). */
export const LOW_CONFIDENCE = 60;

/** Scale to bring the long side near `target` px: shrink big phone photos, enlarge small ones (up to 2x). */
export function scaleFor(width: number, height: number, target = 1800): number {
  const long = Math.max(width, height, 1);
  if (long > target) return target / long;
  if (long < target / 2) return 2;
  return 1;
}

/** A 3x3 box blur of a grey image: takes the grain out of a noisy phone photo before it is stretched (stretching alone makes grain worse). */
export function boxBlur3(grey: Uint8ClampedArray, width: number): Uint8ClampedArray {
  const height = Math.floor(grey.length / width);
  const out = new Uint8ClampedArray(grey.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) { const xx = x + dx; if (xx >= 0 && xx < width) { sum += grey[yy * width + xx]; n += 1; } }
      }
      out[y * width + x] = Math.round(sum / n);
    }
  }
  return out;
}

/**
 * Grey, lightly blurred (when the image width is given), then stretched so the 2nd and 98th percentiles become black and white. Pure on the
 * pixel array so it is testable. In a trial on a very grainy synthetic tag the blur took the reading from gibberish (confidence 13) to correct (90).
 */
export function tidyPixels(rgba: Uint8ClampedArray, width?: number): void {
  const n = rgba.length / 4;
  let grey: Uint8ClampedArray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i += 1) {
    const g = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    grey[i] = g;
  }
  if (width && width > 2 && n >= width * 3) grey = boxBlur3(grey, width);
  for (let i = 0; i < n; i += 1) hist[grey[i]] += 1;
  const at = (frac: number): number => { let acc = 0; for (let v = 0; v < 256; v += 1) { acc += hist[v]; if (acc >= frac * n) return v; } return 255; };
  const lo = at(0.02), hi = at(0.98);
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i += 1) {
    const v = hi - lo < 24 ? grey[i] : Math.max(0, Math.min(255, Math.round(((grey[i] - lo) / span) * 255))); // a nearly flat image: do not blow up the noise
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
}

export interface TagScanner {
  /** Replaceable (tests, and anyone who wants a different reader). Creates the OCR engine the first time it is needed. */
  createEngine: () => Promise<OcrEngine>;
  /** Read the photo. `onStatus` says what is happening ("Loading the reader…", then "Reading the tag…" with progress 0-1). */
  scan(photo: Blob, onStatus?: (s: { stage: 'model' | 'prepare' | 'read'; progress?: number }) => void): Promise<ScanResult>;
  /** Free the reader (a few tens of MB). The next scan creates it again from the cached model. */
  dispose(): Promise<void>;
}

export function createTagScanner(): TagScanner {
  let engine: OcrEngine | null = null;
  const self: TagScanner = {
    createEngine: async () => {
      const mod = await import('@planner-core/ocr/ocrEngine');
      return mod.createOcrEngine({ lang: 'eng' });
    },
    async scan(photo, onStatus) {
      onStatus?.({ stage: 'prepare' });
      const canvas = await prepare(photo);
      if (!engine) { onStatus?.({ stage: 'model' }); engine = await self.createEngine(); }
      onStatus?.({ stage: 'read', progress: 0 });
      const page = await engine.recognize(canvas, { onProgress: (p) => onStatus?.({ stage: 'read', progress: p }) });
      const lines = page.lines.map((l) => l.text.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
      return { text: lines.join('\n'), meanConf: page.meanConf, lines };
    },
    async dispose() {
      const e = engine;
      engine = null;
      if (e) await e.terminate().catch(() => undefined);
    },
  };
  return self;
}

/** Decode (upright, as the phone meant it), scale, grey and stretch. Returns a canvas for the reader. */
async function prepare(photo: Blob): Promise<unknown> {
  const bmp = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const k = scaleFor(bmp.width, bmp.height);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read photos.');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  tidyPixels(img.data, w);
  ctx.putImageData(img, 0, 0);
  return canvas;
}
