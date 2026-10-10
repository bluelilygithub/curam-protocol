import type { PDFFont } from 'pdf-lib';
import { chooseScale, winAnsi, wrapText, type Prim as PdfPrim, type Rgb } from '@planner-core/export/pdfDraw';
import { analyseApp, ESTIMATE_FIELDS, fullRuns, type Analysis, type AppProject } from '../app/model';
import { doorLayout } from '../enclosure/enclosure';
import type { WallSide } from '../enclosure/types';
import { effectiveBottlesPerRow, missingFields } from '../rack/rack';
import { badRunIds, boundsOf, elevationView, planView, rackFaceView, type Prim, type Tone } from '../views';

// The drawing package: A3 landscape sheets in the style of the Carter Noir sample drawings (a title block with project, client, address, drawing
// title, drawing number, project number, date, scale, drawn and checked by), built as plain PDF primitives first so tests can check every sheet
// without a PDF reader, then drawn by packagePdf.ts. Every sheet says PRELIMINARY DESIGN ONLY, and a status line says plainly whether the rack
// values are estimated, calculated or not set.

export const A3_LANDSCAPE = { w: 1190.55, h: 841.89 };
export const PRELIMINARY = 'PRELIMINARY DESIGN ONLY - FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION';

export interface DrawingMeta { company: string; client: string; address: string; projectNo: string; drawnBy: string; checkedBy: string; date: string }
export const blankMeta = (date: string): DrawingMeta => ({ company: '', client: '', address: '', projectNo: '', drawnBy: '', checkedBy: '', date });

export interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont }
/** A picture placed on a sheet (a JPEG data address) in PDF points, y up. */
export interface SheetImage { dataUrl: string; x: number; y: number; w: number; h: number }
export interface Sheet { id: string; title: string; scale: string; width: number; height: number; prims: PdfPrim[]; image?: SheetImage }

const INK: Rgb = [0.1, 0.1, 0.1], MUTED: Rgb = [0.4, 0.4, 0.4], RED: Rgb = [0.7, 0.14, 0.09];
const FILL: Record<Tone, Rgb | undefined> = { panel: [0.55, 0.6, 0.65], glass: [0.75, 0.88, 0.95], stud: [0.8, 0.73, 0.6], inside: [0.96, 0.95, 0.92], door: [0.93, 0.84, 0.64], rack: [0.89, 0.72, 0.65], rackIssue: [0.95, 0.65, 0.65], zone: [0.98, 0.9, 0.7], header: [0.9, 0.9, 0.88], equipment: [0.66, 0.7, 0.75], ink: undefined, muted: undefined, bottle: [0.29, 0.42, 0.27] };
const LINE: Record<Tone, Rgb> = { panel: [0.36, 0.4, 0.44], glass: [0.42, 0.65, 0.78], stud: [0.55, 0.47, 0.32], inside: [0.79, 0.77, 0.72], door: [0.71, 0.51, 0.18], rack: [0.8, 0.47, 0.36], rackIssue: [0.8, 0.2, 0.2], zone: [0.96, 0.62, 0.04], header: [0.6, 0.6, 0.58], equipment: [0.36, 0.4, 0.44], ink: INK, muted: MUTED, bottle: [0.18, 0.29, 0.16] };

const today = (): string => new Date().toISOString().slice(0, 10);

/** One sentence on how far the rack numbers can be trusted, printed on every sheet. */
export function statusLine(p: AppProject, a: Analysis): string {
  const missing = missingFields(p.rackSpec, p.bottle);
  const bits: string[] = [];
  if (p.estimated?.length && p.rackType && !p.rackType.confirmed) bits.push(`RACK VALUES (${p.rackType.name}) NOT YET CONFIRMED BY THE SUPPLIER (estimated: ${p.estimated.length} of ${ESTIMATE_FIELDS.length} fields) - NOT FOR QUOTING OR FABRICATION`);
  else if (p.estimated?.length) bits.push(`RACK VALUES ARE BEST GUESSES (estimated: ${p.estimated.length} of ${ESTIMATE_FIELDS.length} fields) - NOT FOR QUOTING OR FABRICATION`);
  else if (missing.length) bits.push(`RACK VALUES NOT SET (missing: ${missing.join(', ')}) - BOTTLES CANNOT BE COUNTED`);
  else bits.push('Rack values entered by the designer; confirm with the fabricator.');
  if (a.racks.runs.some((r) => r.capacity.status === 'OK' && r.capacity.bottlesPerRowSource === 'calculated')) bits.push('Bottles per row is calculated (unit width / bottle pitch): an estimate.');
  const t = a.racks.total;
  if (t.status === 'OK' && t.uncounted) bits.push(`${t.uncounted.bottles} bottles in ${t.uncounted.runs} run(s) with errors are NOT counted.`);
  return bits.join(' | ');
}

// ---------------------------------------------------------------- the frame: border, title block, notes

function frame(sheet: Sheet, meta: DrawingMeta, project: AppProject, status: string, f: Fonts, no: number, of: number): void {
  const { w: W, h: H } = A3_LANDSCAPE;
  const m = 20, tbH = 78, tbY = m + 4;
  const line = (ax: number, ay: number, bx: number, by: number, width = 0.8): void => { sheet.prims.push({ t: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by }, width, color: INK }); };
  const text = (s: string, x: number, y: number, size: number, o: { bold?: boolean; color?: Rgb; anchor?: 'left' | 'centre' | 'right' } = {}): void => { sheet.prims.push({ t: 'text', x, y, size, text: s, anchor: o.anchor ?? 'left', color: o.color ?? INK, bold: o.bold }); };
  sheet.prims.push({ t: 'poly', pts: [{ x: m, y: m }, { x: W - m, y: m }, { x: W - m, y: H - m }, { x: m, y: H - m }], stroke: INK, width: 1, closed: true });
  // the notes, above the title block
  text(PRELIMINARY, W / 2, tbY + tbH + 26, 9, { bold: true, anchor: 'centre', color: RED });
  const lines = wrapText(f.regular, status, 7.5, W - 2 * m - 40);
  lines.slice(0, 2).forEach((l, i) => text(l, W / 2, tbY + tbH + 14 - i * 9, 7.5, { anchor: 'centre', color: MUTED }));
  // the title block, as on the sample sheets
  line(m, tbY + tbH, W - m, tbY + tbH);
  const cols = [m + 6, 250, 450, 790, 940, 1040];
  for (const x of cols.slice(1)) line(x - 6, tbY, x - 6, tbY + tbH);
  line(cols[1] - 6, tbY + tbH / 2, W - m, tbY + tbH / 2, 0.4);
  const cell = (label: string, value: string, x: number, row: 0 | 1, maxW: number): void => {
    const top = row === 0 ? tbY + tbH - 11 : tbY + tbH / 2 - 11;
    text(label, x, top, 6.5, { bold: true, color: MUTED });
    // a long value is made smaller, then wrapped onto a second line: never cut off
    const v = value || '-';
    const size = [9.5, 8.5, 7.5].find((s) => f.bold.widthOfTextAtSize(winAnsi(v), s) <= maxW);
    if (size) text(v, x, top - 13, size, { bold: true });
    else {
      // up to three small lines; only something absurdly long is cut, and then with an ellipsis so the cut is visible
      const lines = wrapText(f.bold, v, 6.5, maxW);
      const shown = lines.slice(0, 3);
      if (lines.length > 3) shown[2] = `${shown[2].replace(/s+S*$/, '')}...`;
      shown.forEach((l, i) => text(l, x, top - 12 - i * 7, 6.5, { bold: true }));
    }
  };
  text((meta.company || '').toUpperCase(), cols[0] + 4, tbY + tbH / 2 - 4, 14, { bold: true });
  cell('Project', project.name, cols[1], 0, cols[2] - cols[1] - 12);
  cell('Address', meta.address, cols[1], 1, cols[2] - cols[1] - 12);
  cell('Client', meta.client, cols[2], 0, cols[3] - cols[2] - 12);
  cell('Drawing Title', sheet.title, cols[2], 1, cols[3] - cols[2] - 12);
  cell('Drawing No.', sheet.id, cols[3], 0, cols[4] - cols[3] - 12);
  cell('Date', meta.date, cols[3], 1, cols[4] - cols[3] - 12);
  cell('Project No.', meta.projectNo, cols[4], 0, cols[5] - cols[4] - 12);
  cell('Scale @ A3', sheet.scale, cols[4], 1, cols[5] - cols[4] - 12);
  cell('Drawn', meta.drawnBy, cols[5], 0, W - m - cols[5] - 8);
  cell('Checker', meta.checkedBy, cols[5], 1, W - m - cols[5] - 8);
  text(`Sheet ${no} of ${of}`, W - m - 6, m + 5, 6.5, { anchor: 'right', color: MUTED });
}

// ---------------------------------------------------------------- views -> pdf primitives

/** Map a view (millimetres, y down) to a sheet at a standard scale, centred in the drawing area. Returns the scale label. */
export function placeView(sheet: Sheet, prims: Prim[], f: Fonts): string {
  const { w: W, h: H } = A3_LANDSCAPE;
  const area = { x: 40, y: 20 + 4 + 78 + 40, w: W - 80, h: H - (20 + 4 + 78 + 40) - 56 };
  const b = boundsOf(prims);
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const { denom, k } = chooseScale(bw / 1000, bh / 1000, area.w, area.h);
  const s = k / 1000; // points per millimetre
  const ox = area.x + (area.w - bw * s) / 2, oy = area.y + (area.h - bh * s) / 2;
  const X = (x: number): number => ox + (x - b.x0) * s, Y = (y: number): number => oy + (b.y1 - y) * s;
  const out = sheet.prims;
  const line = (ax: number, ay: number, bx: number, by: number, color: Rgb, width = 0.6, dash?: number[]): void => { out.push({ t: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by }, width, color, dash }); };
  for (const p of prims) {
    if (p.kind === 'rect') {
      const x = X(p.x), y = Y(p.y + p.h), w = p.w * s, h = p.h * s;
      out.push({ t: 'poly', pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], fill: FILL[p.tone], stroke: LINE[p.tone], width: 0.5, dash: p.dash ? [3, 2] : undefined, closed: true });
      if (p.label) {
        const lw = f.regular.widthOfTextAtSize(winAnsi(p.label), 6.5);
        if (w >= lw + 6 && h >= 10) out.push({ t: 'text', x: x + 3, y: y + h - 8, size: 6.5, text: p.label, anchor: 'left', color: INK });
      }
    } else if (p.kind === 'circle') {
      out.push({ t: 'circle', x: X(p.cx), y: Y(p.cy), r: Math.max(0.3, p.r * s), fill: FILL[p.tone], stroke: LINE[p.tone], width: 0.25 });
    } else if (p.kind === 'poly') {
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < p.pts.length; i += 2) pts.push({ x: X(p.pts[i]), y: Y(p.pts[i + 1]) });
      out.push({ t: 'poly', pts, stroke: LINE[p.tone], fill: p.closed ? FILL[p.tone] : undefined, width: 0.8, dash: p.dash ? [3, 2] : undefined, closed: !!p.closed });
    } else if (p.kind === 'text') {
      out.push({ t: 'text', x: X(p.x), y: Y(p.y) - 8, size: Math.max(6, Math.min(9, (p.size ?? 11) * 0.7)), text: p.text, anchor: p.anchor === 'middle' ? 'centre' : p.anchor === 'end' ? 'right' : 'left', color: LINE[p.tone] });
    } else {
      // a dimension: extension lines, the dimension line, ticks, and the figure
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * p.offset, ny = (dx / len) * p.offset;
      const a = { x: X(p.x1), y: Y(p.y1) }, bb = { x: X(p.x2), y: Y(p.y2) }, c = { x: X(p.x1 + nx), y: Y(p.y1 + ny) }, d = { x: X(p.x2 + nx), y: Y(p.y2 + ny) };
      line(a.x, a.y, c.x, c.y, MUTED, 0.3); line(bb.x, bb.y, d.x, d.y, MUTED, 0.3); line(c.x, c.y, d.x, d.y, INK, 0.5);
      const ux = d.x - c.x, uy = d.y - c.y, ul = Math.hypot(ux, uy) || 1, tx = (ux / ul) * 3, ty = (uy / ul) * 3;
      for (const e of [c, d]) line(e.x - tx - ty, e.y - ty + tx, e.x + tx + ty, e.y + ty - tx, INK, 0.7);
      const ang = (Math.atan2(uy, ux) * 180) / Math.PI;
      const flip = ang > 90 || ang < -90 ? 180 : 0;
      const mid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
      const rot = ang + flip;
      const sz = 7.5, tw = f.regular.widthOfTextAtSize(p.text, sz);
      const rad = (rot * Math.PI) / 180;
      // centre the figure on the line, lifted a little off it toward the top of the text (up for horizontal text, left for text running up the page)
      out.push({ t: 'text', x: mid.x - (tw / 2) * Math.cos(rad) - 3 * Math.sin(rad), y: mid.y - (tw / 2) * Math.sin(rad) + 3 * Math.cos(rad), size: sz, text: p.text, anchor: 'left', color: INK, rotate: rot });
    }
  }
  return `1:${denom}`;
}

// ---------------------------------------------------------------- the specification sheet

function specLines(p: AppProject, a: Analysis, f: Fonts): Array<{ text: string; bold?: boolean; gap?: boolean; color?: Rgb }> {
  const e = p.enclosure, s = p.rackSpec, inner = a.enclosure.internal;
  const L: Array<{ text: string; bold?: boolean; gap?: boolean; color?: Rgb }> = [];
  const head = (t: string): void => { L.push({ text: '', gap: true }); L.push({ text: t, bold: true }); };
  const row = (t: string): void => { L.push({ text: t }); };
  const lay = doorLayout(e);
  head('ENCLOSURE');
  row(`Outer size to the outer faces: ${e.outerWidthMm} x ${e.outerDepthMm} x ${e.heightMm} mm (width x depth x height).`);
  row(`Inside size: ${inner.widthMm} x ${inner.depthMm} x ${inner.heightMm} mm.`);
  row(`Ceiling build-up ${e.ceilingBuildUpMm} mm, floor build-up ${e.floorBuildUpMm} mm (UNCONFIRMED: not given on the sample drawings).`);
  for (const w of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const) row(`${w[0]}${w.slice(1).toLowerCase()} wall: ${e.walls[w].kind.toLowerCase()}, ${e.walls[w].buildUpMm} mm.`);
  row(`Glass is ${(a.enclosure.glassFraction * 100).toFixed(1)}% of the outer wall area.`);
  head('DOOR');
  row(`${e.door.leaves === 2 ? `Double door, two ${e.door.widthMm / 2} mm leaves, ` : ''}${e.door.widthMm} x ${e.door.heightMm} mm on the ${e.door.wall.toLowerCase()} wall, swinging ${e.door.swing === 'OUT' ? 'out' : 'in'}, ${e.door.leaves === 2 ? 'hinged at both outer edges' : `hinge ${e.door.hinge.toLowerCase()} seen from outside`}, ${e.door.glazed ? 'glazed' : 'solid'}.`);
  row(`The wall splits ${lay.beforeMm} | ${lay.doorMm} | ${lay.afterMm} mm.`);
  head('HEADER (above the enclosure)');
  row(`${e.headerHeightMm} mm high.`);
  for (const c of e.header) row(`${c.kind === 'VENT' ? 'Vent' : 'Conditioner'} (${c.id}): ${c.widthMm} x ${c.heightMm} mm, ${c.xMm} mm from the left, ${c.yMm} mm up.`);
  head('RACK SPECIFICATION');
  const per = effectiveBottlesPerRow(s, p.bottle);
  const src = (k: (typeof ESTIMATE_FIELDS)[number]): string => (s[k] === null ? 'NOT SET' : p.estimated?.includes(k) ? 'ESTIMATED' : 'entered');
  if (p.rackType) row(`Rack type: ${p.rackType.name} (${p.rackType.confirmed ? 'values confirmed by the supplier' : 'values NOT yet confirmed by the supplier'}).`);
  row(`Bottle: ${p.bottle.toLowerCase()}.`);
  row(`Unit width: ${s.unitWidthMm ?? '-'} mm [${src('unitWidthMm')}].`);
  row(`Unit depth: ${s.unitDepthMm ?? '-'} mm [${src('unitDepthMm')}].`);
  row(`Unit height: ${s.unitHeightMm ?? '-'} mm [${src('unitHeightMm')}].`);
  row(`Row pitch: ${s.rowPitchMm ?? '-'} mm [${src('rowPitchMm')}].`);
  row(`Bottles per row: ${per ? per.value : '-'} [${per ? (per.source === 'calculated' ? 'CALCULATED: unit width / bottle pitch' : 'entered') : 'NOT SET'}].`);
  row(`Orientation: ${s.orientation ? s.orientation.toLowerCase().replace('_', '-') : '-'} [${src('orientation')}].`);
  row(`Posts per unit: ${s.postsPerUnit ?? '-'} [${src('postsPerUnit')}].`);
  head('RACK RUNS');
  if (!p.runs.length) row('No racks placed.');
  for (const r of p.runs) {
    const c = a.racks.runs.find((x) => x.runId === r.id)?.capacity;
    const bad = a.racks.issues.some((i) => i.severity === 'error' && i.where === r.id);
    row(`${r.id}: ${r.units} unit${r.units === 1 ? '' : 's'} on the ${r.wall.toLowerCase()} wall from ${r.startMm} mm - ${c?.status === 'OK' ? `${c.capacity} bottles${bad ? ' (NOT COUNTED: has an error)' : ''}` : 'bottles not set'}.`);
  }
  const t = a.racks.total;
  head('BOTTLES');
  L.push({ text: t.status === 'OK' ? `${t.capacity} bottles` : `NOT SET (${t.unsetRuns} run${t.unsetRuns === 1 ? '' : 's'} without rack values)`, bold: true });
  if (t.status === 'OK' && t.uncounted) row(`Not counted: ${t.uncounted.bottles} bottles in ${t.uncounted.runs} run(s) with errors.`);
  head('CHECKS');
  const issues = a.issues.filter((i) => i.severity !== 'info');
  if (!issues.length) row('No errors or warnings.');
  for (const i of issues.slice(0, 30)) row(`${i.severity.toUpperCase()}: ${i.message}${i.fix ? ` ${i.fix}` : ''}${i.where ? ` (${i.where})` : ''}`);
  if (issues.length > 30) row(`... and ${issues.length - 30} more.`);
  head('ADVISORY GUIDANCE (information only)');
  for (const x of a.advisories) row(x.text);
  head('ASSUMPTIONS AND UNVERIFIED VALUES');
  row('The enclosure values come from the Carter Noir sample drawings as read and are unverified. Bottle sizes are typical, not measured. The label-forward depth rule is a joinery assumption on metal racks until the fabricator confirms it.');
  row('This is a design aid. It does not size cooling or insulation and is not an engineering document.');
  void f;
  return L;
}

/** Flow lines into columns across as many specification sheets as needed. */
function specSheets(p: AppProject, a: Analysis, meta: DrawingMeta, f: Fonts): Sheet[] {
  const { w: W, h: H } = A3_LANDSCAPE;
  const top = H - 70, bottom = 20 + 4 + 78 + 52, colW = (W - 80 - 2 * 24) / 3, size = 8.4, lead = 10.6;
  const perCol = Math.floor((top - bottom) / lead);
  const wrapped: Array<{ text: string; bold?: boolean; color?: Rgb }> = [];
  for (const l of specLines(p, a, f)) {
    if (l.gap) { wrapped.push({ text: '' }); continue; }
    const font = l.bold ? f.bold : f.regular;
    for (const w of wrapText(font, l.text, size, colW)) wrapped.push({ text: w, bold: l.bold, color: l.color });
  }
  const sheets: Sheet[] = [];
  const perSheet = perCol * 3;
  for (let s = 0; s * perSheet < wrapped.length || s === 0; s++) {
    const sheet: Sheet = { id: s === 0 ? 'A100' : `A100-${s + 1}`, title: s === 0 ? 'SPECIFICATION AND SCHEDULE' : 'SPECIFICATION (CONTINUED)', scale: 'NTS', width: W, height: H, prims: [] };
    sheet.prims.push({ t: 'text', x: 40, y: H - 48, size: 16, text: `${p.name}`, anchor: 'left', color: INK, bold: true });
    wrapped.slice(s * perSheet, (s + 1) * perSheet).forEach((l, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      if (l.text) sheet.prims.push({ t: 'text', x: 40 + col * (colW + 24), y: top - row * lead, size: size, text: l.text, anchor: 'left', color: l.color ?? INK, bold: l.bold });
    });
    sheets.push(sheet);
  }
  void meta;
  return sheets;
}

// ---------------------------------------------------------------- the package

/** All the sheets: specification, plan, door-wall elevation, then the inside face of every wall that has racks. */
/** Place a picture of the given proportions in the middle of the sheet's drawing area. */
export function placeImage(sheet: Sheet, dataUrl: string, aspect: number): void {
  const { w: W, h: H } = A3_LANDSCAPE;
  const area = { x: 40, y: 20 + 4 + 78 + 40, w: W - 80, h: H - (20 + 4 + 78 + 40) - 56 };
  let w = area.w, h = w / aspect;
  if (h > area.h) { h = area.h; w = h * aspect; }
  sheet.image = { dataUrl, x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

export function buildSheets(project: AppProject, meta: DrawingMeta, f: Fonts, opts: { insideImage?: string; imageAspect?: number } = {}): Sheet[] {
  const a = analyseApp(project);
  const runs = fullRuns(project);
  const bad = badRunIds(a.racks.issues);
  const status = statusLine(project, a);
  const mk = (id: string, title: string): Sheet => ({ id, title, scale: '', width: A3_LANDSCAPE.w, height: A3_LANDSCAPE.h, prims: [] });
  const sheets: Sheet[] = [...specSheets(project, a, meta, f)];

  const plan = mk('A101', 'PLAN VIEW');
  plan.scale = placeView(plan, planView(project.enclosure, runs, a.racks, { walkwayMm: project.walkwayMm, badRuns: bad }), f);
  const elev = mk('A102', `ELEVATION - ${project.enclosure.door.wall} WALL (OUTSIDE)`);
  elev.scale = placeView(elev, elevationView(project.enclosure, project.enclosure.door.wall), f);
  sheets.push(plan, elev);

  let n = 3;
  for (const wall of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as WallSide[]) {
    if (!runs.some((r) => r.wall === wall && r.spec.unitWidthMm !== null)) continue;
    const s = mk(`A10${n++}`, `RACKS - ${wall} WALL (INSIDE FACE)`);
    s.scale = placeView(s, rackFaceView(project.enclosure, runs, a.racks, wall, project.bottle, { badRuns: bad }), f);
    sheets.push(s);
  }
  if (opts.insideImage) {
    const s = mk(`A10${n++}`, '3D VIEW - INSIDE THE CELLAR');
    s.scale = 'NOT TO SCALE';
    placeImage(s, opts.insideImage, opts.imageAspect ?? 1200 / 760);
    sheets.push(s);
  }
  sheets.forEach((s, i) => frame(s, { ...meta, date: meta.date || today() }, project, status, f, i + 1, sheets.length));
  return sheets;
}
