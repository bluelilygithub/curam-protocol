import pixelmatch from 'pixelmatch';
import { openPdf } from '../readers/pdf';
import type { PageRef } from '../readers/types';
import { wordDice } from './textSim';

export const SCAN_SCALE = 1; // whole-document scan; the page viewer renders at VIEW_SCALE
export const VIEW_SCALE = 1.5;

export interface PagePair { a?: number; b?: number } // 1-based page numbers; one side missing = page only in that file
export interface LayoutPage extends PagePair { ratio: number; thumb?: string } // thumb: diff image (data URL) for the report

/** Pairs pages 1:1 when counts match, else by text similarity, keeping order. */
export function alignPages(pa: PageRef[], pb: PageRef[]): PagePair[] {
  if (pa.length === pb.length) return pa.map((p, i) => ({ a: p.number, b: pb[i].number }));
  const out: PagePair[] = [];
  let j0 = 0;
  for (const p of pa) {
    let best = -1, bestSim = 0.3;
    for (let j = j0; j < Math.min(pb.length, j0 + 10); j++) { const s = wordDice(p.text, pb[j].text); if (s > bestSim) { best = j; bestSim = s; } }
    if (best < 0) { out.push({ a: p.number }); continue; }
    for (let j = j0; j < best; j++) out.push({ b: pb[j].number });
    out.push({ a: p.number, b: pb[best].number });
    j0 = best + 1;
  }
  for (let j = j0; j < pb.length; j++) out.push({ b: pb[j].number });
  return out;
}

type Pdf = Awaited<ReturnType<typeof openPdf>>;

export async function renderPage(doc: Pdf, n: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  page.cleanup();
  return canvas;
}

/** Pixel diff of two rendered pages on a common canvas size. Returns the changed share and the diff image. */
export function diffCanvases(ca: HTMLCanvasElement, cb: HTMLCanvasElement, maskOnly = false): { ratio: number; diff: HTMLCanvasElement } {
  const w = Math.max(ca.width, cb.width), h = Math.max(ca.height, cb.height);
  const pad = (c: HTMLCanvasElement) => { const x = document.createElement('canvas'); x.width = w; x.height = h; const g = x.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(c, 0, 0); return g.getImageData(0, 0, w, h); };
  const ia = pad(ca), ib = pad(cb);
  const diff = document.createElement('canvas'); diff.width = w; diff.height = h;
  const dctx = diff.getContext('2d')!;
  const out = dctx.createImageData(w, h);
  const changed = pixelmatch(ia.data, ib.data, out.data, w, h, { threshold: 0.1, alpha: 0.2, diffMask: maskOnly });
  dctx.putImageData(out, 0, 0);
  return { ratio: changed / (w * h), diff };
}

export class PdfPair {
  private constructor(public a: Pdf, public b: Pdf) {}
  static async open(fa: File, fb: File) { const [a, b] = await Promise.all([openPdf(fa), openPdf(fb)]); return new PdfPair(a, b); }
  destroy() { void this.a.destroy(); void this.b.destroy(); }
}

/** Renders and compares every page pair, yielding between pages so the UI stays responsive. */
export async function compareLayout(pair: PdfPair, pages: PagePair[], threshold: number, onProgress: (done: number, total: number) => void, signal: { cancelled: boolean }): Promise<LayoutPage[]> {
  const out: LayoutPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (signal.cancelled) break;
    const p = pages[i];
    if (p.a === undefined || p.b === undefined) { out.push({ ...p, ratio: 1 }); continue; }
    const [ca, cb] = await Promise.all([renderPage(pair.a, p.a, SCAN_SCALE), renderPage(pair.b, p.b, SCAN_SCALE)]);
    const { ratio, diff } = diffCanvases(ca, cb);
    out.push({ ...p, ratio, thumb: ratio > threshold ? thumbnail(diff, 260) : undefined });
    onProgress(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

function thumbnail(c: HTMLCanvasElement, width: number): string {
  const t = document.createElement('canvas');
  t.width = width; t.height = Math.round((c.height / c.width) * width);
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.75);
}
