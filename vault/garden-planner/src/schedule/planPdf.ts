// The planting plan as a PDF: the to-scale plan sheet (planSheet.ts), then the plant schedule as a table with wrapped text and a repeated header.
// Uses pdf-lib (MIT), loaded only when the PDF is asked for (this module is imported on demand).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { A4, col, drawPrims, winAnsi, wrapText } from '@planner-core/export/pdfDraw';
import { slug } from '@planner-core/export/csv';
import type { GardenProject } from '../domain/types';
import { buildPlantSchedule, DRAFT_NOTE, WEED_NOTE, type PlantSchedule, type ScheduleRow } from './plantSchedule';
import { INK, MUTED, planSheet, refsFor, SAFETY_NOTE, type PlanOptions, type Paper } from './planSheet';
import type { GrowthStage } from '../plants/growth';

export interface PlanPdfOptions {
  paper: Paper;
  stage: GrowthStage;
  dimensions: boolean;
  /** Add the plant schedule pages after the plan. */
  includeSchedule: boolean;
  /** "yyyy-mm-dd". */
  date: string;
}

const M = { left: 40, right: 40, top: 46, bottom: 52 };
const LINE = 9.2;
const PAD = 5;
const COLS = [
  { key: 'ref', title: 'No.', x: 0, w: 28 },
  { key: 'plant', title: 'Plant', x: 28, w: 150 },
  { key: 'qty', title: 'Qty', x: 178, w: 26 },
  { key: 'size', title: 'Mature size', x: 206, w: 78 },
  { key: 'spacing', title: 'Spacing', x: 286, w: 38 },
  { key: 'where', title: 'Where planted', x: 326, w: 80 },
  { key: 'notes', title: 'Cautions and notes', x: 408, w: 107 },
] as const;

const range = (r: [number, number]): string => (r[0] === r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`);
export const sizeText = (r: ScheduleRow): string => (r.height[1] ? `${range(r.height)} m high, ${range(r.spread)} m wide` : '');
export const notesText = (r: ScheduleRow): string => [r.cautions, r.weed && !r.weed.startsWith('Not listed') ? r.weed : '', r.notes].filter(Boolean).join('. ');

interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }

/** The lines of text in each cell of a row, and the row's height. */
function layoutRow(r: ScheduleRow, f: Fonts): { cells: Record<string, string[]>; height: number } {
  const cells: Record<string, string[]> = {
    ref: [r.ref],
    plant: [...wrapText(f.bold, r.common, 8.5, COLS[1].w - 4), ...wrapText(f.italic, r.botanical, 7.5, COLS[1].w - 4)],
    qty: [String(r.qty)],
    size: wrapText(f.regular, sizeText(r), 7.5, COLS[3].w - 3),
    spacing: [r.spacing ? `${r.spacing} m` : ''],
    where: wrapText(f.regular, r.where, 7.5, COLS[5].w - 3),
    notes: wrapText(f.regular, notesText(r), 7, COLS[6].w - 2),
  };
  const lines = Math.max(...Object.values(cells).map((c) => c.length), 1);
  return { cells, height: lines * LINE + PAD * 2 - 2 };
}

/** Rows split into pages (each page keeps room for the header, the notes and the footer). */
export function paginate(heights: number[], pageHeight: number, headerH: number, totalH: number): number[][] {
  const usable = pageHeight - M.top - M.bottom - headerH - 18;
  const pages: number[][] = [[]];
  let used = 0;
  heights.forEach((h, i) => {
    if (used + h > usable && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(i);
    used += h;
  });
  // the totals and the notes need room after the last row
  if (used + totalH > usable && pages[pages.length - 1].length) pages.push([]);
  return pages;
}

function drawSchedulePage(page: PDFPage, p: GardenProject, s: PlantSchedule, rows: ScheduleRow[], last: boolean, sheet: number, sheets: number, date: string, f: Fonts): void {
  const W = A4.w, H = A4.h, x0 = M.left;
  const txt = (t: string, x: number, y: number, size = 8.5, font: PDFFont = f.regular, c = INK, right = false): void => {
    const w = font.widthOfTextAtSize(winAnsi(t), size);
    page.drawText(winAnsi(t), { x: right ? x - w : x, y, size, font, color: col(c) });
  };
  txt(p.name, x0, H - M.top, 15, f.bold);
  txt('Plant schedule', x0, H - M.top - 16, 9.5, f.regular, MUTED);
  txt(date, W - M.right, H - M.top, 9, f.regular, INK, true);
  txt(`Sheet ${sheet} of ${sheets}`, W - M.right, H - M.top - 16, 8, f.regular, MUTED, true);
  let y = H - M.top - 44;
  page.drawRectangle({ x: x0 - 4, y: y - 5, width: W - M.left - M.right + 8, height: 16, color: rgb(0.93, 0.92, 0.9) });
  for (const c of COLS) txt(c.title, x0 + c.x + (c.key === 'qty' ? c.w - 4 : 0), y, 7.5, f.bold, MUTED, c.key === 'qty');
  y -= 22;
  for (const r of rows) {
    const { cells, height } = layoutRow(r, f);
    let yy = y;
    for (const c of COLS) {
      const lines = cells[c.key];
      lines.forEach((line, i) => {
        const isBotanical = c.key === 'plant' && i >= wrapText(f.bold, r.common, 8.5, COLS[1].w - 4).length;
        const font = c.key === 'plant' ? (isBotanical ? f.italic : f.bold) : f.regular;
        const size = c.key === 'plant' ? (isBotanical ? 7.5 : 8.5) : c.key === 'notes' ? 7 : 7.5;
        const color = isBotanical || c.key === 'notes' ? MUTED : INK;
        txt(line, x0 + c.x + (c.key === 'qty' ? c.w - 4 : 0), yy - i * LINE, size, font, color, c.key === 'qty');
      });
    }
    page.drawLine({ start: { x: x0 - 4, y: y - height + PAD + 6 }, end: { x: W - M.right + 4, y: y - height + PAD + 6 }, thickness: 0.3, color: rgb(0.8, 0.8, 0.78) });
    y -= height;
  }
  if (last) {
    y -= 4;
    txt(`${s.total} plant${s.total === 1 ? '' : 's'} in ${s.species} kind${s.species === 1 ? '' : 's'}${s.missing ? `; ${s.missing} no longer in the plant library` : ''}`, x0, y, 9.5, f.bold);
    y -= 16;
    for (const line of wrapText(f.regular, `${DRAFT_NOTE} ${WEED_NOTE}`, 7.5, W - M.left - M.right)) { txt(line, x0, y, 7.5, f.regular, MUTED); y -= 9.5; }
    for (const line of wrapText(f.regular, SAFETY_NOTE, 7.5, W - M.left - M.right)) { txt(line, x0, y, 7.5, f.regular, MUTED); y -= 9.5; }
  }
  txt('Made with Vault Garden Planner', W / 2, M.bottom - 24, 7, f.regular, MUTED);
}

/** The finished PDF as bytes: the planting plan, then the plant schedule. */
export async function makePlanPdf(project: GardenProject, o: PlanPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${project.name} - planting plan`);
  doc.setCreator('Vault Garden Planner');
  doc.setProducer('pdf-lib');
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const schedule = buildPlantSchedule(project);
  const pages: number[][] = o.includeSchedule && schedule.rows.length > 0 ? paginate(schedule.rows.map((r) => layoutRow(r, fonts).height), A4.h, 22, 58) : [];
  const sheets = 1 + pages.length;
  const planOpts: PlanOptions = { gardenName: project.name, place: project.location.address ?? project.location.label, date: o.date, paper: o.paper, stage: o.stage, dimensions: o.dimensions, sheet: 1, sheets, refs: refsFor(schedule) };
  const sheet = planSheet(project, planOpts);
  const planPage = doc.addPage([sheet.width, sheet.height]);
  drawPrims(planPage, sheet, fonts.regular, fonts.bold, fonts.italic);
  pages.forEach((idx, i) => {
    const page = doc.addPage([A4.w, A4.h]);
    drawSchedulePage(page, project, schedule, idx.map((n) => schedule.rows[n]), i === pages.length - 1, i + 2, sheets, o.date, fonts);
  });
  return doc.save();
}

export const planFileName = (garden: string): string => `${slug(garden) || 'garden'}-planting-plan.pdf`;
