// Shared on-device OCR (Tesseract.js), moved here from Vault's `client/src/utils/ocrEngine.js` so the planner apps can use the same
// module (Garden Planner's plant-tag scan). Tesseract.js runs recognition inside its own Web Worker, so the UI thread never freezes.
//
//   const ocr = await createOcrEngine({ lang: 'eng' });
//   const page = await ocr.recognize(canvas, { onProgress: (p) => ... });   // { lines, meanConf }
//   await ocr.terminate();
//
// `lines` have word-level boxes and confidence (0-100): [{ text, segs: [{ start, end, bbox:{x,y,w,h}, conf }] }].
// The language model downloads once on first use (cached by the browser); the image never leaves the device.

export interface OcrSeg { start: number; end: number; bbox: { x: number; y: number; w: number; h: number }; conf: number }
export interface OcrLine { text: string; segs: OcrSeg[] }
export interface OcrPage { lines: OcrLine[]; meanConf: number }
export interface OcrEngine {
  recognize(image: unknown, opts?: { onProgress?: (p: number) => void }): Promise<OcrPage>;
  terminate(): Promise<unknown>;
}

interface TesseractWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TesseractData {
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ bbox: { y0: number; y1: number }; words?: TesseractWord[] }> }> }>;
}

export async function createOcrEngine({ lang = 'eng' }: { lang?: string } = {}): Promise<OcrEngine> {
  const mod = (await import('tesseract.js')) as unknown as { default?: unknown } & Record<string, unknown>;
  const Tesseract = (mod.default ?? mod) as {
    createWorker(lang: string, oem: number, opts: { workerPath?: string; corePath?: string; langPath?: string; gzip?: boolean; logger: (m: { status: string; progress: number }) => void }): Promise<{
      recognize(image: unknown, a: object, b: object): Promise<{ data: TesseractData }>;
      terminate(): Promise<unknown>;
    }>;
  };
  let progressCb: ((p: number) => void) | null = null;
  // The worker, wasm core and English data come from our own origin (`<base>ocr/`, put there by planner-core/vite/ocrAssets.mjs), never a CDN:
  // Vault's Content Security Policy only allows 'self' for scripts and fetches. Other languages fall back to tesseract.js's default source.
  const siteBase = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const base = new URL(`${siteBase}ocr/`, globalThis.location?.href ?? 'http://localhost/').href;
  const own = lang === 'eng' ? { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true } : {};
  const worker = await Tesseract.createWorker(lang, 1, {
    ...own,
    logger: (m) => { if (m.status === 'recognizing text' && progressCb) progressCb(m.progress); },
  });
  return {
    async recognize(image, { onProgress } = {}) {
      progressCb = onProgress ?? null;
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

/** Turn Tesseract blocks into lines with word boxes and confidences. */
export function normalizeOcrPage(data: TesseractData | null | undefined): OcrPage {
  const lines: OcrLine[] = [];
  let confSum = 0;
  let confN = 0;
  for (const block of data?.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const ln of para.lines ?? []) {
        const words = (ln.words ?? []).filter((w) => w.text && w.text.trim());
        if (!words.length) continue;
        const lineH = Math.max(1, ln.bbox.y1 - ln.bbox.y0);
        let text = '';
        const segs: OcrSeg[] = [];
        let prevX1: number | null = null;
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
