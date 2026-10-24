import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { formatDistance, type Units } from './geo';
import { MARGIN, pageSize, safeText, tint, wrapText } from './mapLayout';
import type { Cue } from './api';

/**
 * The directions as a PDF: a plain A4 list to print or keep, one numbered line per turn with how far to the next one and how far you have come.
 * Never touches the DOM, so it is tested in plain Node. The text goes through safeText because the standard PDF font has Latin characters only.
 */

export interface CuePdfInput {
  title: string;
  notes?: string | null;
  /** Shown under the title, already formatted (for example "12 Oct 2026"). */
  dateLabel: string;
  color: string;
  units: Units;
  totalM: number;
  cues: Cue[];
}

const SIZE = 10.5;
const LEAD = 14;
const NUM_W = 26;
const DIST_W = 96;
const MAX_PAGES = 12; // 400 directions never need more; this only stops a runaway

export async function buildCuePdf(input: CuePdfInput): Promise<Uint8Array> {
  const { units } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Directions: ${input.title}`.slice(0, 200));
  doc.setCreator('Route Tracer in Vault');
  doc.setProducer('Route Tracer in Vault');
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const has = new Set(reg.getCharacterSet());
  const hasBold = new Set(bold.getCharacterSet());
  const safe = (t: string, b = false): string => safeText(t, (cp) => (b ? hasBold : has).has(cp));
  const { w, h } = pageSize('portrait');
  const ink = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);
  const [cr, cg, cb] = tint(input.color, 0);
  const accent = rgb(cr, cg, cb);
  const km = (m: number): string => formatDistance(m / 1000, units);

  let page: PDFPage = doc.addPage([w, h]);
  let y = h - MARGIN;
  const textW = w - MARGIN * 2 - NUM_W - DIST_W;

  const header = (first: boolean): void => {
    if (first) {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: 6, height: 26, color: accent });
      page.drawText(safe(input.title, true).slice(0, 80), { x: MARGIN + 14, y: y + 6, size: 18, font: bold, color: ink });
      y -= 26;
      page.drawText(safe(`Directions · ${km(input.totalM)} · ${input.cues.length} steps · ${input.dateLabel}`), { x: MARGIN + 14, y, size: 10.5, font: reg, color: grey });
      y -= 20;
      if (input.notes) {
        for (const l of wrapText(safe(input.notes), w - MARGIN * 2, (s) => reg.widthOfTextAtSize(s, SIZE), 5)) { page.drawText(l, { x: MARGIN, y, size: SIZE, font: reg, color: ink }); y -= LEAD; }
        y -= 6;
      }
    } else {
      page.drawText(safe(`${input.title} (continued)`).slice(0, 90), { x: MARGIN, y, size: 10, font: reg, color: grey });
      y -= 20;
    }
    page.drawText('Step', { x: MARGIN, y, size: 9, font: bold, color: grey });
    page.drawText('What to do', { x: MARGIN + NUM_W, y, size: 9, font: bold, color: grey });
    page.drawText('Then / so far', { x: w - MARGIN - DIST_W + 8, y, size: 9, font: bold, color: grey });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: w - MARGIN, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) });
    y -= LEAD;
  };

  const footer = (p: PDFPage): void => {
    p.drawText('Directions © openrouteservice.org · © OpenStreetMap contributors. A guide only: follow signs and local rules.', { x: MARGIN, y: MARGIN - 10, size: 7.5, font: reg, color: grey });
  };

  header(true);
  let sofar = 0;
  let pages = 1;
  input.cues.forEach((c, i) => {
    const lines = wrapText(safe(c.text), textW - 8, (s) => reg.widthOfTextAtSize(s, SIZE), 4);
    const need = Math.max(1, lines.length) * LEAD + 5;
    if (y - need < MARGIN + 12 && pages < MAX_PAGES) {
      footer(page);
      page = doc.addPage([w, h]);
      pages += 1;
      y = h - MARGIN;
      header(false);
    }
    page.drawText(String(i + 1), { x: MARGIN, y, size: SIZE, font: bold, color: accent });
    lines.forEach((l, k) => page.drawText(l, { x: MARGIN + NUM_W, y: y - k * LEAD, size: SIZE, font: reg, color: ink }));
    page.drawText(safe(c.distanceM > 0 ? km(c.distanceM) : 'Arrive'), { x: w - MARGIN - DIST_W + 8, y, size: SIZE, font: reg, color: ink });
    page.drawText(safe(`${km(sofar)} done`), { x: w - MARGIN - DIST_W + 8, y: y - LEAD + 3, size: 8, font: reg, color: grey });
    sofar += c.distanceM;
    y -= need + 4;
  });
  footer(page);
  return doc.save();
}
