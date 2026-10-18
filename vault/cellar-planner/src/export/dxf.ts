import type { AppProject } from '../app/model';
import { analyseApp, fullRuns } from '../app/model';
import type { WallSide } from '../enclosure/types';
import { badRunIds, boundsOf, elevationView, planView, rackFaceView, type Prim, type Tone } from '../views';

// DXF export: the plan, the door-wall elevation and the racks on each wall as a CAD drawing an architect or fabricator can open in AutoCAD, Revit (link),
// BricsCAD, LibreCAD and the like. It is the SAME drawing primitives the PDF package uses (views/), so the two can never disagree.
//
// Format: ASCII DXF release 12 (AC1009), the oldest and most widely read. Plain LINE, POLYLINE, CIRCLE and TEXT entities only (no DIMENSION, no blocks, no
// hatches), so every CAD program reads it the same way. Units are MILLIMETRES, drawn at full size (1:1). One layer per kind of thing (CELLAR-WALL-PANEL,
// CELLAR-GLASS, CELLAR-RACK ...), so layers can be switched, recoloured and plotted as the office likes. The views sit side by side in model space with a
// title above each. y is flipped from the screen (CAD has y up). Text is plain ASCII.

/** The same words the PDF sheets carry (drawingPackage.ts PRELIMINARY; a test keeps the two equal). */
export const DXF_PRELIMINARY = 'PRELIMINARY DESIGN ONLY - FINAL SITE MEASURE REQUIRED PRIOR TO FABRICATION';

export interface DxfView { id: string; title: string; prims: Prim[] }

const LAYER: Record<Tone, { name: string; color: number }> = {
  panel: { name: 'CELLAR-WALL-PANEL', color: 7 },
  glass: { name: 'CELLAR-GLASS', color: 5 },
  stud: { name: 'CELLAR-WALL-STUD', color: 8 },
  inside: { name: 'CELLAR-INSIDE', color: 9 },
  door: { name: 'CELLAR-DOOR', color: 6 },
  rack: { name: 'CELLAR-RACK', color: 30 },
  rackIssue: { name: 'CELLAR-RACK-ISSUE', color: 1 },
  zone: { name: 'CELLAR-ZONE', color: 3 },
  header: { name: 'CELLAR-HEADER', color: 4 },
  equipment: { name: 'CELLAR-EQUIPMENT', color: 2 },
  ink: { name: 'CELLAR-NOTES', color: 7 },
  muted: { name: 'CELLAR-NOTES-MUTED', color: 8 },
  bottle: { name: 'CELLAR-BOTTLE', color: 94 },
};
const TITLE_LAYER = { name: 'CELLAR-TITLE', color: 7 };
const DIM_LAYER = { name: 'CELLAR-DIMENSION', color: 2 };

/** Plain ASCII only (release 12 has no Unicode), no control characters, and a sensible length. */
export const dxfText = (s: string): string => String(s)
  .replace(/[×✕]/g, 'x').replace(/[−–—]/g, '-').replace(/°C/g, ' deg C').replace(/°/g, ' deg').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/²/g, '2')
  .normalize('NFKD').replace(/[^\x20-\x7e]/g, '').slice(0, 200);

/** The drawings of a design, as views in millimetres (y down, as the screen draws them). */
export function dxfViews(project: AppProject): DxfView[] {
  const a = analyseApp(project);
  const runs = fullRuns(project);
  const bad = badRunIds(a.racks.issues);
  const views: DxfView[] = [
    { id: 'A101', title: 'PLAN VIEW', prims: planView(project.enclosure, runs, a.racks, { walkwayMm: project.walkwayMm, badRuns: bad }) },
    { id: 'A102', title: `ELEVATION - ${project.enclosure.door.wall} WALL (OUTSIDE)`, prims: elevationView(project.enclosure, project.enclosure.door.wall) },
  ];
  let n = 3;
  for (const wall of ['NORTH', 'EAST', 'SOUTH', 'WEST'] as WallSide[]) {
    if (!runs.some((r) => r.wall === wall && r.spec.unitWidthMm !== null)) continue;
    views.push({ id: `A10${n++}`, title: `RACKS - ${wall} WALL (INSIDE FACE)`, prims: rackFaceView(project.enclosure, runs, a.racks, wall, project.bottle, { badRuns: bad }) });
  }
  return views;
}

class Writer {
  private out: string[] = [];
  private fmt(n: number): string { return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0'; }
  pair(code: number, value: string | number): void { this.out.push(String(code), typeof value === 'number' ? this.fmt(value) : value); }
  text(): string { return `${this.out.join('\n')}\n`; }
}

/** Build the DXF text. `meta` lines go in a small block at the top left. */
export function buildDxf(views: DxfView[], meta: { lines: string[] } = { lines: [] }): string {
  const w = new Writer();
  const layersUsed = new Map<string, number>([[TITLE_LAYER.name, TITLE_LAYER.color], [DIM_LAYER.name, DIM_LAYER.color]]);
  const entities = new Writer();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number): void => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };

  const line = (layer: string, x1: number, y1: number, x2: number, y2: number, dash = false): void => {
    entities.pair(0, 'LINE'); entities.pair(8, layer); if (dash) entities.pair(6, 'DASHED');
    entities.pair(10, x1); entities.pair(20, y1); entities.pair(30, 0); entities.pair(11, x2); entities.pair(21, y2); entities.pair(31, 0);
    grow(x1, y1); grow(x2, y2);
  };
  const poly = (layer: string, pts: Array<[number, number]>, closed: boolean, dash = false): void => {
    if (pts.length < 2) return;
    entities.pair(0, 'POLYLINE'); entities.pair(8, layer); if (dash) entities.pair(6, 'DASHED'); entities.pair(66, 1);
    entities.pair(10, 0); entities.pair(20, 0); entities.pair(30, 0); entities.pair(70, closed ? 1 : 0);
    for (const [x, y] of pts) { entities.pair(0, 'VERTEX'); entities.pair(8, layer); entities.pair(10, x); entities.pair(20, y); entities.pair(30, 0); grow(x, y); }
    entities.pair(0, 'SEQEND'); entities.pair(8, layer);
  };
  const circle = (layer: string, cx: number, cy: number, r: number): void => {
    entities.pair(0, 'CIRCLE'); entities.pair(8, layer); entities.pair(10, cx); entities.pair(20, cy); entities.pair(30, 0); entities.pair(40, Math.max(0.5, r));
    grow(cx - r, cy - r); grow(cx + r, cy + r);
  };
  /** Text anchored at (x, y): left aligned, or centred/right using the second alignment point. Rotation in degrees. */
  const text = (layer: string, x: number, y: number, height: number, value: string, anchor: 'start' | 'middle' | 'end' = 'start', rotation = 0): void => {
    const s = dxfText(value);
    if (!s) return;
    entities.pair(0, 'TEXT'); entities.pair(8, layer);
    entities.pair(10, x); entities.pair(20, y); entities.pair(30, 0);
    entities.pair(40, height); entities.pair(1, s);
    if (rotation) entities.pair(50, rotation);
    if (anchor !== 'start') { entities.pair(72, anchor === 'middle' ? 1 : 2); entities.pair(11, x); entities.pair(21, y); entities.pair(31, 0); }
    grow(x, y); grow(x + (anchor === 'start' ? s.length * height * 0.6 : 0), y + height);
  };
  const useLayer = (tone: Tone): string => { const l = LAYER[tone]; layersUsed.set(l.name, l.color); return l.name; };

  // the title block text, then the views left to right, each with its title above
  let cursorX = 0;
  const topY = 0;
  let titleY = 900;
  text(TITLE_LAYER.name, 0, titleY, 120, 'CELLAR PLANNER - CAD DRAWINGS (units: millimetres, full size 1:1)');
  text(TITLE_LAYER.name, 0, (titleY -= 200), 90, DXF_PRELIMINARY);
  for (const l of meta.lines) text(TITLE_LAYER.name, 0, (titleY -= 150), 70, l);
  const viewsTop = titleY - 600;
  void topY;
  for (const v of views) {
    const b = boundsOf(v.prims);
    const ox = cursorX - b.x0;           // shift so the view's left edge lands at the cursor
    const oy = -b.y0;                    // and its top edge at y = 0 before flipping
    const X = (x: number): number => x + ox;
    const Y = (y: number): number => -(y + oy) + viewsTop;
    const widthMm = b.x1 - b.x0, heightMm = b.y1 - b.y0;
    text(TITLE_LAYER.name, cursorX, viewsTop + 350, 100, `${v.id}  ${v.title}`);
    for (const p of v.prims) {
      if (p.kind === 'rect') {
        const layer = useLayer(p.tone);
        poly(layer, [[X(p.x), Y(p.y)], [X(p.x + p.w), Y(p.y)], [X(p.x + p.w), Y(p.y + p.h)], [X(p.x), Y(p.y + p.h)]], true, !!p.dash);
        if (p.label && p.w > 150 && p.h > 60) text(layer, X(p.x + p.w / 2), Y(p.y + p.h / 2) - 20, 40, p.label, 'middle');
      } else if (p.kind === 'poly') {
        const pts: Array<[number, number]> = [];
        for (let i = 0; i + 1 < p.pts.length; i += 2) pts.push([X(p.pts[i]!), Y(p.pts[i + 1]!)]);
        poly(useLayer(p.tone), pts, !!p.closed, !!p.dash);
      } else if (p.kind === 'circle') {
        circle(useLayer(p.tone), X(p.cx), Y(p.cy), p.r);
      } else if (p.kind === 'text') {
        text(useLayer(p.tone), X(p.x), Y(p.y), Math.max(30, (p.size ?? 11) * 4), p.text, p.anchor ?? 'start');
      } else {
        // a dimension: two extension lines, the dimension line, a tick at each end and the size, drawn with plain entities
        const dx = p.x2 - p.x1, dy = p.y2 - p.y1, len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const nx = (-dy / len) * p.offset, ny = (dx / len) * p.offset;
        const a1: [number, number] = [X(p.x1), Y(p.y1)], a2: [number, number] = [X(p.x2), Y(p.y2)];
        const b1: [number, number] = [X(p.x1 + nx), Y(p.y1 + ny)], b2: [number, number] = [X(p.x2 + nx), Y(p.y2 + ny)];
        line(DIM_LAYER.name, a1[0], a1[1], b1[0], b1[1]); line(DIM_LAYER.name, a2[0], a2[1], b2[0], b2[1]); line(DIM_LAYER.name, b1[0], b1[1], b2[0], b2[1]);
        const ux = (b2[0] - b1[0]) / (len || 1), uy = (b2[1] - b1[1]) / (len || 1), tick = 40;
        for (const [px, py] of [b1, b2]) line(DIM_LAYER.name, px - (ux + -uy) * tick, py - (uy + ux) * tick, px + (ux + -uy) * tick, py + (uy + ux) * tick);
        let deg = (Math.atan2(b2[1] - b1[1], b2[0] - b1[0]) * 180) / Math.PI;
        if (deg > 90) deg -= 180; else if (deg <= -90) deg += 180;
        text(DIM_LAYER.name, (b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2 + 12, 50, p.text, 'middle', Math.round(deg * 10) / 10);
      }
    }
    cursorX += widthMm + 3000;
    void heightMm;
  }

  // ---- header
  w.pair(0, 'SECTION'); w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER'); w.pair(1, 'AC1009');
  w.pair(9, '$INSUNITS'); w.pair(70, 4);
  const ex = Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 1, 1];
  w.pair(9, '$EXTMIN'); w.pair(10, ex[0]!); w.pair(20, ex[1]!); w.pair(30, 0);
  w.pair(9, '$EXTMAX'); w.pair(10, ex[2]!); w.pair(20, ex[3]!); w.pair(30, 0);
  w.pair(0, 'ENDSEC');
  // ---- tables: line types and layers
  w.pair(0, 'SECTION'); w.pair(2, 'TABLES');
  w.pair(0, 'TABLE'); w.pair(2, 'LTYPE'); w.pair(70, 2);
  w.pair(0, 'LTYPE'); w.pair(2, 'CONTINUOUS'); w.pair(70, 0); w.pair(3, 'Solid line'); w.pair(72, 65); w.pair(73, 0); w.pair(40, 0);
  w.pair(0, 'LTYPE'); w.pair(2, 'DASHED'); w.pair(70, 0); w.pair(3, 'Dashed'); w.pair(72, 65); w.pair(73, 2); w.pair(40, 15); w.pair(49, 10); w.pair(49, -5);
  w.pair(0, 'ENDTAB');
  w.pair(0, 'TABLE'); w.pair(2, 'LAYER'); w.pair(70, layersUsed.size);
  for (const [name, color] of layersUsed) { w.pair(0, 'LAYER'); w.pair(2, name); w.pair(70, 0); w.pair(62, color); w.pair(6, 'CONTINUOUS'); }
  w.pair(0, 'ENDTAB');
  w.pair(0, 'TABLE'); w.pair(2, 'STYLE'); w.pair(70, 1);
  w.pair(0, 'STYLE'); w.pair(2, 'STANDARD'); w.pair(70, 0); w.pair(40, 0); w.pair(41, 1); w.pair(50, 0); w.pair(71, 0); w.pair(42, 2.5); w.pair(3, 'txt'); w.pair(4, '');
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');
  // ---- blocks (none; the section is present because some older readers expect it)
  w.pair(0, 'SECTION'); w.pair(2, 'BLOCKS'); w.pair(0, 'ENDSEC');
  // ---- entities
  w.pair(0, 'SECTION'); w.pair(2, 'ENTITIES');
  const body = entities.text();
  w.pair(0, 'ENDSEC'); // placeholder removed below: entities are spliced in between SECTION/ENTITIES and ENDSEC
  const head = w.text();
  const cut = head.lastIndexOf('0\nENDSEC\n');
  return `${head.slice(0, cut)}${body}0\nENDSEC\n0\nEOF\n`;
}

/** The DXF for a design: its drawings and the title block details kept with it. */
export function makeDxf(project: AppProject, date: string): string {
  const d = project.drawing;
  const lines = [
    `Project: ${project.name}`,
    ...(d?.company ? [`Company: ${d.company}`] : []), ...(d?.client ? [`Client: ${d.client}`] : []), ...(d?.address ? [`Address: ${d.address}`] : []),
    ...(d?.projectNo ? [`Project no: ${d.projectNo}`] : []), ...(d?.drawnBy ? [`Drawn by: ${d.drawnBy}`] : []), ...(d?.checkedBy ? [`Checked by: ${d.checkedBy}`] : []),
    `Date: ${date}`,
  ];
  return buildDxf(dxfViews(project), { lines });
}

export function dxfFileName(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cellar';
  return `${slug}-drawings.dxf`;
}
