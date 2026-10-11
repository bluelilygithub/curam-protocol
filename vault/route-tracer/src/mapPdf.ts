import { PDFDocument, StandardFonts, rgb, closePath, endPath, fill, lineTo, moveTo, popGraphicsState, pushGraphicsState, setFillingRgbColor, setLineCap, setLineJoin, setLineWidth, setStrokingRgbColor, stroke, LineCapStyle, LineJoinStyle, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatDistance, markersAlong, metersPerPixel, stepKmFor, totalKm, type Lines, type Pos, type Units } from './geo';
import { CAPTURE_PX_PER_PT, GAP, MARGIN, captureSize, makeProjector, mapArea, niceScale, pageSize, safeText, tint, wrapText, type Orientation } from './mapLayout';

export * from './mapLayout';

const rgbOf = (hex: string): [number, number, number] => tint(hex, 0);

/**
 * The map as a PDF: one A4 page with the route on a map picture, the start and finish, distance markers, a scale bar and north arrow, the
 * numbers (distance, climb), the notes, and the elevation profile. The map PICTURE is made by the browser (mapCapture.ts: only the browser has
 * the tiles); everything drawn on top of it here (the route, markers, scale, chart) is vector, so it stays sharp when printed or zoomed.
 * This file never touches the DOM, so it is tested in plain Node.
 */

export interface PdfProfile { km: number[]; ele: number[]; totalKm: number; ascent: number; descent: number; min: number; max: number }

export interface MapPdfInput {
  title: string;
  notes?: string | null;
  /** Shown beside the distance, already formatted (for example "12 Oct 2026"). */
  dateLabel: string;
  lines: Lines;
  color: string;
  units: Units;
  orientation: Orientation;
  /** The map picture, as made by mapCapture.ts for `captureSize(orientation)`. */
  image: { bytes: Uint8Array; type: 'jpg' | 'png' };
  center: Pos;
  zoom: number;
  profile?: PdfProfile | null;
  /** Why there is no elevation profile, if there is not one; printed in its place. */
  profileNote?: string | null;
}

const FT = 3.28084;
const height = (m: number, units: Units): string => (units === 'mi' ? `${Math.round(m * FT).toLocaleString('en-AU')} ft` : `${Math.round(m).toLocaleString('en-AU')} m`);
const MAX_MARKERS = 40;

function strokePath(page: PDFPage, pts: { x: number; y: number }[], width: number, color: [number, number, number]): void {
  if (pts.length < 2) return;
  page.pushOperators(
    pushGraphicsState(), setStrokingRgbColor(...color), setLineWidth(width), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round),
    moveTo(pts[0].x, pts[0].y), ...pts.slice(1).map((p) => lineTo(p.x, p.y)), stroke(), popGraphicsState(),
  );
}

function centred(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color = rgb(1, 1, 1)): void {
  page.drawText(text, { x: x - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });
}

export async function buildMapPdf(input: MapPdfInput): Promise<Uint8Array> {
  const { lines, units, orientation } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(input.title.slice(0, 200));
  doc.setCreator('Route Tracer in Vault');
  doc.setProducer('Route Tracer in Vault');
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const allowed = new Set(reg.getCharacterSet());
  const safe = (t: string): string => safeText(t, (cp) => allowed.has(cp));
  const { w: PW, h: PH } = pageSize(orientation);
  const page = doc.addPage([PW, PH]);
  const ink = rgb(0.1, 0.1, 0.1); const grey = rgb(0.4, 0.4, 0.4);
  const color = rgbOf(input.color);

  // ---- header
  const km = totalKm(lines);
  let title = safe(input.title.trim() || 'Route');
  if (bold.widthOfTextAtSize(title, 20) > PW - 2 * MARGIN) {
    let head = title;
    while (head.length > 1 && bold.widthOfTextAtSize(`${head}...`, 20) > PW - 2 * MARGIN) head = head.slice(0, -1);
    title = `${head.trimEnd()}...`;
  }
  page.drawText(title, { x: MARGIN, y: PH - MARGIN - 18, size: 20, font: bold, color: ink });
  page.drawText(safe(`${formatDistance(km, units)}  -  ${input.dateLabel}`), { x: MARGIN, y: PH - MARGIN - 36, size: 11, font: reg, color: grey });

  // ---- map picture
  const area = mapArea(orientation);
  const img = input.image.type === 'jpg' ? await doc.embedJpg(input.image.bytes) : await doc.embedPng(input.image.bytes);
  const areaY = PH - area.top - area.h; // PDF y of the picture's bottom edge
  page.drawImage(img, { x: area.x, y: areaY, width: area.w, height: area.h });
  page.drawRectangle({ x: area.x, y: areaY, width: area.w, height: area.h, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.6 });

  const cap = captureSize(orientation);
  const project = makeProjector(input.center, input.zoom, cap.width, cap.height);
  const onPage = (p: Pos): { x: number; y: number } => {
    const q = project(p);
    return { x: area.x + (q.x / cap.width) * area.w, y: areaY + area.h - (q.y / cap.height) * area.h };
  };

  // the route: a white edge under the colour so it reads on any map
  for (const line of lines) {
    const pts = line.map(onPage);
    strokePath(page, pts, 5.6, [1, 1, 1]);
    strokePath(page, pts, 3, color);
  }

  // distance markers (thinned so they never crowd), then the start and the finish on top
  const all = markersAlong(lines, stepKmFor(units));
  const every = Math.max(1, Math.ceil(all.length / MAX_MARKERS));
  for (const m of all) {
    if (m.n % every !== 0) continue;
    const p = onPage(m.pos);
    const r = m.n >= 100 ? 8 : 6.5;
    page.drawCircle({ x: p.x, y: p.y, size: r, color: rgb(1, 1, 1), borderColor: rgb(...color), borderWidth: 1.2 });
    const t = String(m.n);
    centred(page, bold, t, p.x, p.y - 2.3, 6.5, ink);
  }
  const first = lines.find((l) => l.length)?.[0];
  const lastLine = [...lines].reverse().find((l) => l.length);
  const last = lastLine?.[lastLine.length - 1];
  if (first && last) {
    const a = onPage(first); const b = onPage(last);
    const closed = Math.hypot(a.x - b.x, a.y - b.y) < 9; // a loop: one marker is enough
    if (!closed) { page.drawCircle({ x: b.x, y: b.y, size: 8.5, color: rgb(0.13, 0.13, 0.13), borderColor: rgb(1, 1, 1), borderWidth: 1.6 }); centred(page, bold, 'B', b.x, b.y - 3, 9); }
    page.drawCircle({ x: a.x, y: a.y, size: 8.5, color: rgb(0.18, 0.49, 0.2), borderColor: rgb(1, 1, 1), borderWidth: 1.6 });
    centred(page, bold, 'A', a.x, a.y - 3, 9);
  }

  // scale bar (bottom left), north arrow (top right), attribution (bottom right)
  const mPerPt = metersPerPixel(input.zoom, input.center[1]) * CAPTURE_PX_PER_PT;
  const sc = niceScale(mPerPt, 130, units);
  const sx = area.x + 10; const sy = areaY + 22;
  page.drawRectangle({ x: sx - 5, y: sy - 8, width: sc.pt + 10 + Math.max(0, reg.widthOfTextAtSize(sc.label, 8) - 6), height: 28, color: rgb(1, 1, 1), opacity: 0.8 });
  page.drawLine({ start: { x: sx, y: sy }, end: { x: sx + sc.pt, y: sy }, thickness: 1.6, color: ink });
  page.drawLine({ start: { x: sx, y: sy - 3 }, end: { x: sx, y: sy + 5 }, thickness: 1.2, color: ink });
  page.drawLine({ start: { x: sx + sc.pt, y: sy - 3 }, end: { x: sx + sc.pt, y: sy + 5 }, thickness: 1.2, color: ink });
  page.drawText('0', { x: sx - 2, y: sy + 8, size: 7.5, font: reg, color: ink });
  page.drawText(sc.label, { x: sx + sc.pt - reg.widthOfTextAtSize(sc.label, 7.5) / 2, y: sy + 8, size: 7.5, font: reg, color: ink });
  const nx = area.x + area.w - 22; const ny = areaY + area.h - 40;
  page.drawCircle({ x: nx, y: ny + 6, size: 15, color: rgb(1, 1, 1), opacity: 0.85 });
  page.pushOperators(pushGraphicsState(), setFillingRgbColor(0.1, 0.1, 0.1), moveTo(nx, ny + 17), lineTo(nx - 5, ny - 1), lineTo(nx, ny + 3), lineTo(nx + 5, ny - 1), closePath(), fill(), endPath(), popGraphicsState());
  centred(page, bold, 'N', nx, ny - 9, 8, ink);
  const credit = safe('(c) MapTiler  (c) OpenStreetMap contributors');
  const cw = reg.widthOfTextAtSize(credit, 6.5);
  page.drawRectangle({ x: area.x + area.w - cw - 10, y: areaY, width: cw + 10, height: 11, color: rgb(1, 1, 1), opacity: 0.85 });
  page.drawText(credit, { x: area.x + area.w - cw - 5, y: areaY + 3, size: 6.5, font: reg, color: ink });

  // ---- under the map: the numbers and notes on the left, the elevation profile on the right
  const stripTop = PH - area.top - area.h - GAP; // PDF y of the top of the strip
  const profile = input.profile && input.profile.km.length > 1 ? input.profile : null;
  const textW = profile ? (PW - 2 * MARGIN) * 0.42 : PW - 2 * MARGIN;
  let ty = stripTop - 12;
  const row = (label: string, value: string): void => {
    page.drawText(safe(label), { x: MARGIN, y: ty, size: 9, font: reg, color: grey });
    page.drawText(safe(value), { x: MARGIN + 62, y: ty, size: 10, font: bold, color: ink });
    ty -= 14;
  };
  row('Distance', formatDistance(km, units));
  if (profile) {
    row('Climb', height(profile.ascent, units));
    row('Descent', height(profile.descent, units));
    row('Lowest', height(profile.min, units));
    row('Highest', height(profile.max, units));
  } else if (input.profileNote) {
    page.drawText(safe(input.profileNote), { x: MARGIN, y: ty, size: 8.5, font: reg, color: grey });
    ty -= 14;
  }
  const notes = (input.notes ?? '').trim();
  if (notes) {
    const room = Math.max(0, Math.floor((ty - (MARGIN - 6)) / 11));
    const wrapped = wrapText(safe(notes), textW - 8, (s) => reg.widthOfTextAtSize(s, 8.5), Math.min(room, profile ? 3 : 5));
    for (const l of wrapped) { page.drawText(l, { x: MARGIN, y: ty, size: 8.5, font: reg, color: ink }); ty -= 11; }
  }

  if (profile) {
    const cx0 = MARGIN + textW + 24; const cx1 = PW - MARGIN;
    const top = stripTop - 6; const bottom = MARGIN + 14;
    const span = Math.max(20, profile.max - profile.min);
    const lo = profile.min - (span - (profile.max - profile.min)) / 2;
    const X = (k: number): number => cx0 + (profile.totalKm === 0 ? 0 : (k / profile.totalKm) * (cx1 - cx0));
    const Y = (e: number): number => bottom + ((e - lo) / span) * (top - bottom);
    const pts = profile.km.map((k, i) => ({ x: X(k), y: Y(profile.ele[i]) }));
    page.pushOperators(pushGraphicsState(), setFillingRgbColor(...tint(input.color, 0.78)), moveTo(X(0), bottom), ...pts.map((p) => lineTo(p.x, p.y)), lineTo(X(profile.totalKm), bottom), closePath(), fill(), popGraphicsState());
    strokePath(page, pts, 1.4, color);
    page.drawLine({ start: { x: cx0, y: bottom }, end: { x: cx1, y: bottom }, thickness: 0.6, color: grey });
    page.drawLine({ start: { x: cx0, y: bottom }, end: { x: cx0, y: top }, thickness: 0.6, color: grey });
    const topLabel = height(lo + span, units); const botLabel = height(lo, units);
    page.drawText(topLabel, { x: cx0 - 3 - reg.widthOfTextAtSize(topLabel, 7), y: top - 6, size: 7, font: reg, color: grey });
    page.drawText(botLabel, { x: cx0 - 3 - reg.widthOfTextAtSize(botLabel, 7), y: bottom - 2, size: 7, font: reg, color: grey });
    page.drawText('0', { x: cx0, y: bottom - 10, size: 7, font: reg, color: grey });
    const end = formatDistance(profile.totalKm, units);
    page.drawText(end, { x: cx1 - reg.widthOfTextAtSize(end, 7), y: bottom - 10, size: 7, font: reg, color: grey });
  }

  page.drawText('Made with Route Tracer in Vault. Heights are a terrain model, good to a few metres.', { x: MARGIN, y: 12, size: 6.5, font: reg, color: rgb(0.6, 0.6, 0.6) });
  return doc.save();
}
