// The printable planting plan: the garden as a to-scale drawing (lawns, beds, paths, house, structures, fences, services, and every plant at
// its mature size, numbered to match the plant schedule), with a key, a north arrow, a scale bar and a title block. Pure: it builds plain
// drawing primitives (lines, polygons, circles, text) and the PDF writer (planPdf.ts) turns them into pages; tests check the primitives.
//
// Honest labelling is part of the sheet: the plant data is a draft, plant positions are only as accurate as the plan, and underground
// services are only what was drawn (a reminder to call Dial Before You Dig).
import { A3, A4, chooseScale, type Prim, type Rgb } from '@planner-core/export/pdfDraw';
import { aabbOf, add, normalize, scale as vscale, sub } from '@planner-core/engine/geometry';
import { footprintCorners } from '@planner-core/engine/footprints';
import type { Vec2 } from '@planner-core/types';
import { pathSegments, sampleShape, shapeArea } from '../domain/shapes';
import type { GardenProject } from '../domain/types';
import { CLIMATE_LABEL } from '../domain/climate';
import { type GrowthStage, plantSizeAt } from '../plants/growth';
import { plantById } from '../plants/plants';
import { COLOURS, FENCE_COLOUR, GRASS_COLOUR, MULCH_COLOUR, PATH_COLOUR, SERVICE_COLOUR, STRUCTURE_COLOUR } from '../render2d/theme';
import type { PlantSchedule } from './plantSchedule';
import { DRAFT_NOTE } from './plantSchedule';

export type { Prim, Rgb };
export type Paper = 'a4' | 'a3';
export const PAPERS: Record<Paper, { w: number; h: number; label: string }> = { a4: { ...A4, label: 'A4' }, a3: { ...A3, label: 'A3' } };

export const INK: Rgb = [0.1, 0.1, 0.1];
export const MUTED: Rgb = [0.45, 0.45, 0.45];
export const MARGIN = 36;
export const TITLE_H = 64;
export const LEGEND_H = 40;
/** Room under the title block for the footnotes (up to three lines). */
const FOOT = 30;
/** Plants are labelled inside their canopy circle when it is at least this many points across, otherwise above it. */
const LABEL_FITS_R = 5.5;

export const SAFETY_NOTE = 'Positions are only as accurate as the plan. Underground services shown are only what was drawn: call Dial Before You Dig (1100) before you dig.';

export interface PlanOptions {
  gardenName: string;
  place: string;
  /** "yyyy-mm-dd". */
  date: string;
  paper: Paper;
  /** Plants drawn at this growth stage ("mature" is the usual for a planting plan: it shows what to leave room for). */
  stage: GrowthStage;
  /** Length labels along the plot boundary. */
  dimensions: boolean;
  sheet: number;
  sheets: number;
  /** plant instance id -> its number in the schedule ("P3"). */
  refs: Map<string, string>;
}

export interface PlanSheet {
  /** Page size in points (1/72 inch), y up. */
  width: number;
  height: number;
  prims: Prim[];
  /** "1:150". */
  scaleLabel: string;
  denom: number;
  /** Points per metre. */
  k: number;
  portrait: boolean;
  /** The drawing's box on the page, in points (everything of the garden is inside it). */
  area: { x0: number; y0: number; x1: number; y1: number };
}

export const STAGE_LABEL: Record<GrowthStage, string> = { planted: 'as planted', yr1: 'at 1 year', yr3: 'at 3 years', yr5: 'at 5 years', mature: 'at mature size' };

/** "#aabbcc" to 0-1 components. */
export function rgbOf(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255];
}
const darker = (c: Rgb, f = 0.6): Rgb => [c[0] * f, c[1] * f, c[2] * f];

/** The numbers printed on the plan: each plant's schedule number. */
export function refsFor(schedule: PlantSchedule): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of schedule.rows) for (const id of r.instanceIds) m.set(id, r.ref);
  return m;
}

const metres = (v: number): string => `${v.toFixed(2)} m`;

/** Helvetica is about half an em wide per character on average (a little more in bold): enough to wrap and cut text without a font. */
const approxWidth = (s: string, size: number, bold = false): number => s.length * size * (bold ? 0.58 : 0.52);

/** Text broken at word breaks into lines that fit `maxW` points (estimated). */
export function wrapApprox(s: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (approxWidth(next, size) <= maxW || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** One line cut with "..." to fit `maxW` points (estimated). */
export function cutApprox(s: string, size: number, maxW: number, bold = false): string {
  if (approxWidth(s, size, bold) <= maxW) return s;
  let out = s;
  while (out.length > 1 && approxWidth(`${out}...`, size, bold) > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}...`;
}

/** Everything of the garden that takes up room on the plan, as points (plants include their canopy). */
export function contentPoints(p: GardenProject, stage: GrowthStage): Vec2[] {
  const pts: Vec2[] = [];
  if (p.boundary) pts.push(...p.boundary.vertices.map((v) => v.position));
  if (p.house) pts.push(...p.house.vertices.map((v) => v.position));
  for (const s of p.structures) pts.push(...footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation }));
  for (const b of p.beds) pts.push(...sampleShape(b.shape));
  for (const l of p.lawns) pts.push(...sampleShape(l.shape));
  for (const z of p.zones) pts.push(...sampleShape(z.shape));
  for (const pa of p.paths) for (const q of pathSegments(pa.points, pa.width)) pts.push(...q);
  for (const s of p.services) pts.push(...s.points);
  for (const inst of p.plants) {
    const rec = plantById(inst.plantId);
    const r = rec ? Math.max(0.15, plantSizeAt(rec, stage).canopyRadius) : 0.2;
    pts.push({ x: inst.position.x - r, y: inst.position.y - r }, { x: inst.position.x + r, y: inst.position.y + r });
  }
  return pts;
}

const centroidOf = (pts: Vec2[]): Vec2 => ({ x: pts.reduce((s, q) => s + q.x, 0) / Math.max(1, pts.length), y: pts.reduce((s, q) => s + q.y, 0) / Math.max(1, pts.length) });

export function planSheet(p: GardenProject, opts: PlanOptions): PlanSheet {
  const all = contentPoints(p, opts.stage);
  const raw = all.length ? aabbOf(all) : { min: { x: 0, y: 0 }, max: { x: 10, y: 8 } };
  const pad = 1; // a metre of air round the drawing
  const box = { min: { x: raw.min.x - pad, y: raw.min.y - pad }, max: { x: raw.max.x + pad, y: raw.max.y + pad } };
  const bw = box.max.x - box.min.x, bh = box.max.y - box.min.y;
  const paper = PAPERS[opts.paper];
  const dimRoom = opts.dimensions ? 14 : 0;
  const fitFor = (pw: number, ph: number): { fitW: number; fitH: number } => ({ fitW: pw - 2 * MARGIN - 2 * dimRoom, fitH: ph - 2 * MARGIN - TITLE_H - LEGEND_H - FOOT - 2 * dimRoom - 6 });
  const tryPortrait = chooseScale(bw, bh, fitFor(paper.w, paper.h).fitW, fitFor(paper.w, paper.h).fitH);
  const tryLandscape = chooseScale(bw, bh, fitFor(paper.h, paper.w).fitW, fitFor(paper.h, paper.w).fitH);
  const portrait = tryPortrait.denom !== tryLandscape.denom ? tryPortrait.denom < tryLandscape.denom : bh > bw;
  const page = portrait ? { w: paper.w, h: paper.h } : { w: paper.h, h: paper.w };
  const { fitW: _fw, fitH } = fitFor(page.w, page.h);
  const { denom, k } = portrait ? tryPortrait : tryLandscape;
  void _fw;
  const baseY = MARGIN + TITLE_H + LEGEND_H + FOOT - 16 + dimRoom + 6;
  const ox = (page.w - bw * k) / 2 - box.min.x * k;
  const oy = baseY + (fitH - bh * k) / 2 - box.min.y * k;
  const P = (q: Vec2): Vec2 => ({ x: ox + q.x * k, y: oy + q.y * k });
  const area = { x0: P(box.min).x, y0: P(box.min).y, x1: P(box.max).x, y1: P(box.max).y };
  const prims: Prim[] = [];
  const text = (x: number, y: number, size: number, t: string, o: Partial<Extract<Prim, { t: 'text' }>> = {}): void => { prims.push({ t: 'text', x, y, size, text: t, anchor: 'centre', color: INK, ...o }); };

  // lawns, zones, beds
  for (const l of p.lawns) prims.push({ t: 'poly', pts: sampleShape(l.shape).map(P), fill: rgbOf(GRASS_COLOUR[l.grass]), opacity: 0.55, stroke: darker(rgbOf(GRASS_COLOUR[l.grass])), width: 0.5, closed: true });
  for (const z of p.zones) {
    const pts = sampleShape(z.shape);
    prims.push({ t: 'poly', pts: pts.map(P), stroke: rgbOf(COLOURS.zone), width: 0.8, dash: [4, 3], closed: true });
    const zb = aabbOf(pts);
    const corner = P({ x: zb.min.x, y: zb.max.y });
    text(corner.x + 4, corner.y - 9, 6.5, z.name, { anchor: 'left', color: MUTED });
  }
  for (const b of p.beds) {
    const pts = sampleShape(b.shape);
    prims.push({ t: 'poly', pts: pts.map(P), fill: rgbOf(MULCH_COLOUR[b.mulch]), opacity: 0.6, stroke: rgbOf('#7a5a38'), width: b.raised ? 1.4 : 0.8, closed: true });
  }
  for (const pa of p.paths) for (const q of pathSegments(pa.points, pa.width)) prims.push({ t: 'poly', pts: q.map(P), fill: rgbOf(PATH_COLOUR[pa.material]), opacity: 0.85, stroke: MUTED, width: 0.3, closed: true });
  for (const s of p.services) {
    if (s.kind === 'easement') for (const q of pathSegments(s.points, s.width)) prims.push({ t: 'poly', pts: q.map(P), fill: rgbOf(SERVICE_COLOUR.easement), opacity: 0.18, closed: true });
    for (let i = 0; i + 1 < s.points.length; i += 1) prims.push({ t: 'line', a: P(s.points[i]), b: P(s.points[i + 1]), width: s.kind === 'easement' ? 0.6 : 1.1, color: rgbOf(SERVICE_COLOUR[s.kind]), dash: [5, 3] });
  }

  // house and structures
  if (p.house) {
    const pts = p.house.vertices.map((v) => v.position);
    prims.push({ t: 'poly', pts: pts.map(P), fill: rgbOf(COLOURS.house), stroke: rgbOf(COLOURS.houseStroke), width: 1.3, closed: true });
    const c = P(centroidOf(pts));
    text(c.x, c.y - 3, 9, 'HOUSE', { color: MUTED, bold: true });
  }
  for (const s of p.structures) {
    const corners = footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation });
    if (s.kind === 'gate') {
      prims.push({ t: 'poly', pts: corners.map(P), fill: [1, 1, 1], stroke: INK, width: 0.8, closed: true });
      continue;
    }
    prims.push({ t: 'poly', pts: corners.map(P), fill: rgbOf(STRUCTURE_COLOUR[s.kind]), opacity: 0.85, stroke: INK, width: 0.7, closed: true });
    const c = P(s.position);
    if (s.width * k > 24) text(c.x, c.y - 2.5, 5.8, s.name, { color: INK });
  }

  // boundary: a solid line for a fence, dashed where it is open; a gap is drawn by the gate itself
  if (p.boundary) {
    const v = p.boundary.vertices.map((q) => q.position);
    for (let i = 0; i < v.length; i += 1) {
      const seg = p.boundary.segments[i];
      const open = !seg || seg.fence === 'open';
      prims.push({ t: 'line', a: P(v[i]), b: P(v[(i + 1) % v.length]), width: open ? 0.9 : 1.8, color: open ? MUTED : rgbOf(FENCE_COLOUR[seg.fence]).map((c) => c * 0.55) as Rgb, ...(open ? { dash: [4, 3] } : {}) });
    }
  }

  // plants: biggest first, so a small plant is never hidden under a big canopy; each numbered to match the schedule
  const plants = p.plants
    .map((inst) => { const rec = plantById(inst.plantId); return { inst, rec, r: rec ? Math.max(0.15, plantSizeAt(rec, opts.stage).canopyRadius) : 0.2 }; })
    .sort((a, b) => b.r - a.r);
  for (const { inst, rec, r } of plants) {
    const c = P(inst.position);
    const rp = r * k;
    const fill = rec ? rgbOf(rec.foliageColour) : ([0.7, 0.7, 0.7] as Rgb);
    prims.push({ t: 'circle', x: c.x, y: c.y, r: rp, fill, opacity: 0.45, stroke: darker(fill, 0.55), width: 0.6 });
    prims.push({ t: 'circle', x: c.x, y: c.y, r: 0.9, fill: darker(fill, 0.4) });
  }
  for (const { inst, r } of plants) {
    const ref = opts.refs.get(inst.id);
    if (!ref) continue;
    const c = P(inst.position);
    const rp = r * k;
    if (rp >= LABEL_FITS_R) text(c.x, c.y - 2.3, rp >= 9 ? 6.5 : 5.4, ref, { bold: true, color: INK });
    else text(c.x, c.y + rp + 3, 5.4, ref, { bold: true, color: INK });
  }

  // dimensions along the boundary, outside it
  if (opts.dimensions && p.boundary) {
    const v = p.boundary.vertices.map((q) => q.position);
    const centre = centroidOf(v);
    for (let i = 0; i < v.length; i += 1) {
      const a = v[i], b = v[(i + 1) % v.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = normalize(sub(b, a));
      let n = { x: -d.y, y: d.x };
      if ((mid.x - centre.x) * n.x + (mid.y - centre.y) * n.y < 0) n = vscale(n, -1); // away from the middle of the plot
      const at = add(P(mid), vscale(n, 9));
      let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang <= -90) ang += 180;
      text(at.x, at.y - 2, 6.5, metres(len), { color: MUTED, rotate: ang });
    }
  }

  // key (legend): what the colours and symbols mean
  const items: Array<{ label: string; draw: (x: number, y: number) => void }> = [];
  const swatch = (label: string, fill: Rgb, opacity = 1, stroke: Rgb = MUTED): void => { items.push({ label, draw: (x, y) => prims.push({ t: 'poly', pts: [{ x, y }, { x: x + 14, y }, { x: x + 14, y: y + 8 }, { x, y: y + 8 }], fill, opacity, stroke, width: 0.5, closed: true }) }); };
  if (p.lawns.length) swatch('Lawn', rgbOf(GRASS_COLOUR[p.lawns[0].grass]), 0.55);
  if (p.beds.length) swatch('Garden bed', rgbOf(MULCH_COLOUR[p.beds[0].mulch]), 0.6, rgbOf('#7a5a38'));
  if (p.paths.length) swatch('Path', rgbOf(PATH_COLOUR[p.paths[0].material]), 0.85);
  if (p.house) swatch('House', rgbOf(COLOURS.house), 1, rgbOf(COLOURS.houseStroke));
  if (p.structures.some((s) => s.kind !== 'gate')) swatch('Structure', rgbOf(STRUCTURE_COLOUR[p.structures.find((s) => s.kind !== 'gate')!.kind]), 0.85, INK);
  if (p.boundary) items.push({ label: 'Fence (dashed: open)', draw: (x, y) => prims.push({ t: 'line', a: { x, y: y + 4 }, b: { x: x + 14, y: y + 4 }, width: 1.8, color: INK }) });
  if (p.services.length) items.push({ label: 'Service line (as drawn)', draw: (x, y) => prims.push({ t: 'line', a: { x, y: y + 4 }, b: { x: x + 14, y: y + 4 }, width: 1.1, color: rgbOf(SERVICE_COLOUR[p.services[0].kind]), dash: [4, 2] }) });
  if (p.plants.length) items.push({ label: `Plant, ${STAGE_LABEL[opts.stage]} (number = schedule)`, draw: (x, y) => prims.push({ t: 'circle', x: x + 6, y: y + 4, r: 4.5, fill: [0.4, 0.65, 0.35], opacity: 0.45, stroke: [0.2, 0.4, 0.2], width: 0.6 }) });
  let lx = MARGIN + 6, ly = MARGIN + TITLE_H + LEGEND_H - 16;
  const keyW = (s: string): number => 14 + 4 + s.length * 3.6 + 14;
  for (const it of items) {
    if (lx + keyW(it.label) > page.w - MARGIN) { lx = MARGIN + 6; ly -= 14; }
    it.draw(lx, ly - 1);
    text(lx + 18, ly + 1, 6.6, it.label, { anchor: 'left', color: INK });
    lx += keyW(it.label);
  }
  if (items.length === 0) text(MARGIN + 6, ly + 1, 6.6, 'Nothing has been drawn yet.', { anchor: 'left', color: MUTED });

  // title block
  const tx0 = MARGIN, tx1 = page.w - MARGIN, ty0 = MARGIN, ty1 = MARGIN + TITLE_H - 8;
  prims.push({ t: 'poly', pts: [{ x: tx0, y: ty0 }, { x: tx1, y: ty0 }, { x: tx1, y: ty1 }, { x: tx0, y: ty1 }], stroke: INK, width: 0.8, closed: true });
  const cx = tx0 + Math.min(300, (tx1 - tx0) * 0.5);
  text(tx0 + 10, ty1 - 18, 14, cutApprox(opts.gardenName, 14, cx - tx0 - 24, true), { anchor: 'left', bold: true });
  text(tx0 + 10, ty0 + 9, 8, cutApprox(`${opts.place} · ${CLIMATE_LABEL[p.climateZone]}`, 8, cx - tx0 - 24), { anchor: 'left', color: MUTED });
  const plot = p.boundary ? shapeArea({ points: p.boundary.vertices.map((v) => v.position), smooth: false }) : 0;
  if (plot > 0) text(tx0 + 10, ty0 + 20, 8, `Plot ${plot.toFixed(0)} m² · ${p.plants.length} plant${p.plants.length === 1 ? '' : 's'}`, { anchor: 'left', color: MUTED });
  text(cx, ty1 - 18, 11, `Scale 1:${denom}`, { anchor: 'left', bold: true });
  text(cx, ty0 + 9, 7.5, `${paper.label} ${portrait ? 'portrait' : 'landscape'} · plants drawn ${STAGE_LABEL[opts.stage]}`, { anchor: 'left', color: MUTED });
  text(tx1 - 10, ty1 - 18, 9, opts.date, { anchor: 'right' });
  text(tx1 - 10, ty0 + 9, 8, `Sheet ${opts.sheet} of ${opts.sheets}`, { anchor: 'right', color: MUTED });
  // scale bar: the longest of 1, 2, 5, 10, 20, 50 m that fits in 120 points
  const barM = [50, 20, 10, 5, 2, 1].find((m) => m * k <= 120) ?? 1;
  const sx = cx, sy = ty0 + 22;
  const seg = (barM * k) / 2;
  for (let i = 0; i < 2; i += 1) prims.push({ t: 'poly', pts: [{ x: sx + i * seg, y: sy }, { x: sx + (i + 1) * seg, y: sy }, { x: sx + (i + 1) * seg, y: sy + 4 }, { x: sx + i * seg, y: sy + 4 }], fill: i === 0 ? INK : [1, 1, 1], stroke: INK, width: 0.6, closed: true });
  text(sx, sy + 7, 6, '0', {});
  text(sx + 2 * seg, sy + 7, 6, `${barM} m`, {});
  // north arrow: on the plan the arrow points the way north goes (the north arrow of the garden, turned by its angle)
  const nx = tx1 - 62, ny = ty0 + 27;
  const th = (p.northDeg * Math.PI) / 180;
  const dir = { x: Math.sin(th), y: Math.cos(th) };
  const rot = (q: Vec2): Vec2 => ({ x: nx + q.x * dir.y + q.y * dir.x, y: ny + (-q.x) * dir.x + q.y * dir.y });
  prims.push({ t: 'poly', pts: [{ x: 0, y: 15 }, { x: 5, y: -8 }, { x: 0, y: -4 }, { x: -5, y: -8 }].map(rot), fill: INK, stroke: INK, width: 0.6, closed: true });
  const lab = rot({ x: 0, y: 21 });
  text(lab.x, lab.y - 3, 9, 'N', { bold: true });

  // footnotes under the sheet: the two things a printed plan must never lose
  let fy = FOOT - 2;
  for (const line of [...wrapApprox(SAFETY_NOTE, 6.2, page.w - 2 * MARGIN), ...wrapApprox(DRAFT_NOTE, 6.2, page.w - 2 * MARGIN)]) { text(MARGIN, fy, 6.2, line, { anchor: 'left', color: MUTED }); fy -= 7.4; }

  return { width: page.w, height: page.h, prims, scaleLabel: `1:${denom}`, denom, k, portrait, area };
}
