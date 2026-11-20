import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { finalize, type RawBlock } from './finalize';
import { GateError, type PageRef, type Reader, type Run } from './types';

/** Opens a PDF. The caller (main.tsx in the browser) sets pdfjs.GlobalWorkerOptions.workerPort to the bundled worker. */
export async function openPdf(file: File) {
  const data = new Uint8Array(await file.arrayBuffer()); // pdf.js takes ownership of the buffer
  try {
    return await pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'PasswordException') throw new GateError('password', `${file.name} is password-protected. Remove the password and try again.`);
    throw new GateError('corrupt', `${file.name} could not be opened: the PDF looks damaged (${(e as Error)?.message ?? 'unknown error'}).`);
  }
}

const cleanFont = (name: string) => name.replace(/^[A-Z]{6}\+/, '');
const pdfDate = (s: unknown): Date | undefined => {
  if (typeof s !== 'string') return undefined;
  const d = pdfjs.PDFDateString.toDateObject(s);
  return d ?? undefined;
};

interface Line { y: number; x: number; size: number; runs: Run[]; page: number }

export const pdfReader: Reader = {
  id: 'pdf',
  label: 'PDF',
  extensions: ['.pdf'],
  sniff(bytes) {
    // %PDF, allowed a little leading junk as viewers do
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    return head.includes('%PDF-');
  },
  async read(file) {
    const doc = await openPdf(file);
    try {
      const lines: Line[] = [];
      const pages: PageRef[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        // loads the page's fonts, so commonObjs can give the real font name ("Arial-BoldMT") for bold/italic
        await page.getOperatorList();
        const fontName = (id: string) => {
          try { return cleanFont((page.commonObjs.get(id) as { name?: string })?.name ?? content.styles[id]?.fontFamily ?? id); }
          catch { return content.styles[id]?.fontFamily ?? id; }
        };
        let cur: Line | undefined;
        let pageText = '';
        for (const it of content.items as TextItem[]) {
          if (!('str' in it)) continue;
          const [, , c, d, x, y] = it.transform;
          const size = Math.round(Math.hypot(c, d) * 10) / 10 || it.height;
          if (!it.str && !it.hasEOL) continue;
          if (!cur || Math.abs(y - cur.y) > Math.max(size, cur.size) * 0.5) {
            cur = { y, x, size, runs: [], page: p };
            lines.push(cur);
          } else if (it.str && cur.runs.length && !/\s$/.test(cur.runs[cur.runs.length - 1].text) && !/^\s/.test(it.str)) {
            // items on one line with a visible gap between them get a space
            const prev = cur.runs[cur.runs.length - 1] as Run & { endX?: number };
            if (prev.endX !== undefined && x - prev.endX > size * 0.2) prev.text += ' ';
          }
          if (it.str) {
            const font = fontName(it.fontName);
            const run: Run & { endX?: number } = { text: it.str, font, sizePt: size };
            if (/bold|black|heavy|semibold|demi/i.test(font)) run.bold = true;
            if (/italic|oblique/i.test(font)) run.italic = true;
            run.endX = x + it.width;
            cur.size = Math.max(cur.size, size);
            cur.runs.push(run);
            pageText += it.str + ' ';
          }
        }
        pages.push({ number: p, text: pageText });
        page.cleanup();
      }

      if (doc.numPages > 0 && !lines.some((l) => l.runs.some((r) => r.text.trim()))) {
        throw new GateError('no-text', `${file.name} has no text layer; OCR isn't supported in v1.`);
      }

      // body size = the size carrying the most characters; bigger lines are headings, ranked by size into levels
      const bySize = new Map<number, number>();
      for (const l of lines) for (const r of l.runs) bySize.set(r.sizePt!, (bySize.get(r.sizePt!) ?? 0) + r.text.length);
      const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
      const headingSizes = [...new Set(lines.map((l) => l.size).filter((s) => s > body * 1.15))].sort((a, b) => b - a);

      const blocks: (RawBlock & { lastPage: number })[] = [];
      let prev: Line | undefined;
      let block: (RawBlock & { lastPage: number }) | undefined;
      for (const l of lines) {
        const text = l.runs.map((r) => r.text).join('');
        if (!text.trim()) { prev = l; continue; }
        const level = headingSizes.indexOf(l.size) + 1;
        const type = level > 0 ? 'heading' : 'paragraph';
        const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
        // same paragraph: same kind and normal line spacing, or carried over a page break mid-sentence
        const samePage = block?.lastPage === l.page && gap > 0 && gap < l.size * 1.6;
        const carried = !!block && block.lastPage === l.page - 1 && prev?.page === l.page - 1 && !/[.!?:;]["”’')]?\s*$/.test(block.text);
        const continues = block && block.type === type && type === 'paragraph' && (samePage || carried);
        if (continues && block) {
          const last = block.runs[block.runs.length - 1];
          if (last && !/\s$/.test(last.text)) last.text += ' ';
          block.runs.push(...l.runs.map(stripEnd));
          block.text = block.runs.map((r) => r.text).join('');
          block.lastPage = l.page;
        } else {
          block = { type, level: level || undefined, text, runs: l.runs.map(stripEnd), location: { page: l.page }, lastPage: l.page };
          blocks.push(block);
        }
        prev = l;
      }

      const info = (await doc.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
      const str = (k: string) => (typeof info?.[k] === 'string' && (info[k] as string).trim()) || undefined;
      return finalize(file, 'pdf', blocks.map(({ lastPage: _lastPage, ...b }) => b), {
        created: pdfDate(info?.CreationDate),
        modified: pdfDate(info?.ModDate),
        author: str('Author'),
        title: str('Title'),
        producer: str('Producer'),
        application: str('Creator'),
        pageCount: doc.numPages,
      }, pages);
    } finally {
      await doc.destroy();
    }
  },
};

function stripEnd(r: Run & { endX?: number }): Run {
  const { endX: _endX, ...rest } = r;
  return rest;
}
