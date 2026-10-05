/**
 * Shared on-device OCR (Tesseract.js). Tesseract.js runs recognition inside its own Web Worker, so the
 * UI thread never freezes; callers process page by page and show progress.
 *
 *   const ocr = await createOcrEngine({ lang: 'eng' });
 *   const page = await ocr.recognize(canvas, { onProgress: (0..1) => … });   // { lines, meanConf }
 *   await ocr.terminate();
 *
 * `lines` use the same shape the measurement scanner reads: [{ text, segs: [{ start, end, bbox:{x,y,w,h}, conf }] }]
 * with word-level boxes and confidence (0–100) so low-confidence numbers can be flagged and shown cropped.
 * The language model downloads once on first use (cached by the browser); the image never leaves the device.
 */

export async function createOcrEngine({ lang = 'eng' } = {}) {
  const mod = await import('tesseract.js');
  const Tesseract = mod.default || mod;
  let progressCb = null;
  const worker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => { if (m.status === 'recognizing text' && progressCb) progressCb(m.progress); },
  });
  return {
    async recognize(image, { onProgress } = {}) {
      progressCb = onProgress || null;
      try {
        const { data } = await worker.recognize(image, {}, { blocks: true });
        return normalizeOcrPage(data);
      } finally {
        progressCb = null;
      }
    },
    terminate: () => worker.terminate(),
  };
}

/** Turn Tesseract blocks into scanner lines with word boxes and confidences. */
export function normalizeOcrPage(data) {
  const lines = [];
  let confSum = 0;
  let confN = 0;
  for (const block of data?.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const ln of para.lines || []) {
        const words = (ln.words || []).filter((w) => w.text && w.text.trim());
        if (!words.length) continue;
        const lineH = Math.max(1, ln.bbox.y1 - ln.bbox.y0);
        let text = '';
        const segs = [];
        let prevX1 = null;
        for (const w of words) {
          if (prevX1 !== null) text += w.bbox.x0 - prevX1 > lineH * 1.6 ? '   ' : ' '; // wide gap = table cell break
          const start = text.length;
          text += w.text;
          segs.push({ start, end: text.length, bbox: { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 }, conf: w.confidence });
          confSum += w.confidence; confN += 1;
          prevX1 = w.bbox.x1;
        }
        lines.push({ text, segs });
      }
    }
  }
  return { lines, meanConf: confN ? confSum / confN : 0 };
}
