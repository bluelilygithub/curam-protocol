// The PDF: a to-scale plan sheet for each room (plan.ts), then the furniture schedule. Uses pdf-lib (MIT), loaded only when the PDF is asked for.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { col, drawPrims, fit, winAnsi } from '@planner-core/export/pdfDraw';
// text fitting and drawing primitives live in planner-core, shared with Garden Planner
export { winAnsi };
import type { Project, Room } from '../engine/types';
import { INK, MUTED, A4, numbersFor, planSheet, type Rgb } from './plan';
import { money, roomsText, sizeText, type Schedule, type ScheduleRow } from './schedule';

export interface PdfOptions {
  project: Project;
  rooms: Room[];
  schedule: Schedule;
  projectName: string;
  /** "yyyy-mm-dd". */
  date: string;
}


// ------------------------------------------------------------------ the schedule pages

const SM = { left: 40, right: 40, top: 46, bottom: 46 };
const ROW_H = 17;
const COLS = [
  { key: 'no', title: 'No.', x: 0, w: 28 },
  { key: 'item', title: 'Item', x: 28, w: 150 },
  { key: 'qty', title: 'Qty', x: 178, w: 28 },
  { key: 'size', title: 'Size', x: 214, w: 100 },
  { key: 'detail', title: 'Vendor / SKU / Finish', x: 314, w: 112 },
  { key: 'unit', title: 'Unit cost', x: 426, w: 44 },
  { key: 'total', title: 'Total', x: 470, w: 45 },
] as const;

interface Line { kind: 'heading' | 'row' | 'rule' | 'totals' | 'note'; row?: ScheduleRow; text?: string }

function scheduleLines(s: Schedule): Line[] {
  const lines: Line[] = [];
  if (s.furniture.length) { lines.push({ kind: 'heading', text: 'Furniture and decor' }); for (const r of s.furniture) lines.push({ kind: 'row', row: r }); }
  if (s.openings.length) { lines.push({ kind: 'heading', text: 'Doors and windows' }); for (const r of s.openings) lines.push({ kind: 'row', row: r }); }
  if (!s.furniture.length && !s.openings.length) lines.push({ kind: 'note', text: 'Nothing has been placed in this room yet.' });
  lines.push({ kind: 'rule' }, { kind: 'totals' });
  return lines;
}

/** How many schedule pages the lines need (so the sheet numbers on the plans are right). */
export function schedulePageCount(s: Schedule): number {
  const perPage = Math.floor((A4.h - SM.top - SM.bottom - 70) / ROW_H);
  const perFirst = perPage;
  const n = scheduleLines(s).length;
  return Math.max(1, Math.ceil(n / Math.max(1, perFirst)));
}

function drawSchedulePage(page: PDFPage, o: PdfOptions, lines: Line[], pageNo: number, pages: number, sheet: number, sheets: number, regular: PDFFont, bold: PDFFont): void {
  const W = A4.w, H = A4.h;
  const x0 = SM.left;
  const txt = (text: string, x: number, y: number, size = 8.5, f: PDFFont = regular, c: Rgb = INK, maxW?: number, right = false): void => {
    const t = maxW ? fit(f, text, size, maxW) : winAnsi(text);
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: right ? x - w : x, y, size, font: f, color: col(c) });
  };
  txt(o.projectName, x0, H - SM.top, 15, bold);
  txt(`Furniture schedule · ${o.schedule.scope === 'all' ? 'all rooms' : o.schedule.roomNames[0] ?? ''}`, x0, H - SM.top - 16, 9.5, regular, MUTED);
  txt(o.date, W - SM.right, H - SM.top, 9, regular, INK, undefined, true);
  txt(`Sheet ${sheet} of ${sheets}`, W - SM.right, H - SM.top - 16, 8, regular, MUTED, undefined, true);
  let y = H - SM.top - 46;
  // header
  page.drawRectangle({ x: x0 - 4, y: y - 5, width: W - SM.left - SM.right + 8, height: ROW_H, color: rgb(0.93, 0.92, 0.9) });
  for (const c of COLS) txt(c.title, x0 + c.x + (c.key === 'unit' || c.key === 'total' || c.key === 'qty' ? c.w - 4 : 0), y, 7.5, bold, MUTED, undefined, c.key === 'unit' || c.key === 'total' || c.key === 'qty');
  y -= ROW_H;
  for (const l of lines) {
    if (l.kind === 'heading') { txt(l.text ?? '', x0, y, 8, bold, MUTED); y -= ROW_H; continue; }
    if (l.kind === 'note') { txt(l.text ?? '', x0, y, 9, regular, MUTED); y -= ROW_H; continue; }
    if (l.kind === 'rule') { page.drawLine({ start: { x: x0 - 4, y: y + 10 }, end: { x: W - SM.right + 4, y: y + 10 }, thickness: 0.6, color: col(MUTED) }); continue; }
    if (l.kind === 'totals') {
      const t = o.schedule.totals;
      txt(`${t.pieces} piece${t.pieces === 1 ? '' : 's'} in ${t.kinds} kind${t.kinds === 1 ? '' : 's'}, ${t.openings} door/window opening${t.openings === 1 ? '' : 's'}`, x0, y, 9, bold);
      txt(`Total ${money(t.cost) || '0.00'}`, x0 + COLS[6].x + COLS[6].w - 4, y, 10, bold, INK, undefined, true);
      if (t.unpriced > 0) { y -= ROW_H - 3; txt(`${t.unpriced} piece${t.unpriced === 1 ? ' has' : 's have'} no unit cost, so the total is incomplete. Add costs in the Inspector (Metadata).`, x0, y, 7.5, regular, MUTED); }
      continue;
    }
    const r = l.row!;
    const detail = [r.vendor, r.sku, r.finishCode].filter(Boolean).join(' · ');
    const nameLine = fit(regular, r.name + (r.notes ? ` (${r.notes})` : ''), 8.5, COLS[1].w - 4);
    txt(r.no ? String(r.no) : '-', x0 + COLS[0].x, y);
    page.drawText(nameLine, { x: x0 + COLS[1].x, y, size: 8.5, font: regular, color: col(INK) });
    if (o.schedule.scope === 'all') txt(roomsText(r), x0 + COLS[1].x, y - 7.5, 6.3, regular, MUTED, COLS[1].w - 4);
    txt(String(r.qty), x0 + COLS[2].x + COLS[2].w - 4, y, 8.5, regular, INK, undefined, true);
    txt(sizeText(r), x0 + COLS[3].x, y, 8, regular, INK, COLS[3].w - 4);
    txt(detail, x0 + COLS[4].x, y, 7.5, regular, MUTED, COLS[4].w - 4);
    txt(r.unitCost === undefined ? '-' : money(r.unitCost), x0 + COLS[5].x + COLS[5].w - 4, y, 8, regular, INK, undefined, true);
    txt(r.total === undefined ? '-' : money(r.total), x0 + COLS[6].x + COLS[6].w - 4, y, 8.5, regular, INK, undefined, true);
    y -= ROW_H + (o.schedule.scope === 'all' ? 3 : 0);
  }
  txt(`Page ${pageNo} of ${pages} of the schedule · Made with Vault Room Planner`, W / 2, SM.bottom - 14, 7, regular, MUTED, undefined, false);
}

/** The finished PDF as bytes. */
export async function makePdf(o: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${o.projectName} - plan and furniture schedule`);
  doc.setCreator('Vault Room Planner');
  doc.setProducer('pdf-lib');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const lines = scheduleLines(o.schedule);
  const perPage = Math.floor((A4.h - SM.top - SM.bottom - 70) / ROW_H);
  const pages: Line[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const sheets = o.rooms.length + pages.length;
  const numbers = numbersFor(o.schedule);

  o.rooms.forEach((room, i) => {
    const sheet = planSheet(o.project, room, { projectName: o.projectName, date: o.date, sheet: i + 1, sheets, numbers });
    const page = doc.addPage([sheet.width, sheet.height]);
    drawPrims(page, sheet, regular, bold);
  });
  pages.forEach((chunk, i) => {
    const page = doc.addPage([A4.w, A4.h]);
    drawSchedulePage(page, o, chunk, i + 1, pages.length, o.rooms.length + i + 1, sheets, regular, bold);
  });
  return doc.save();
}
