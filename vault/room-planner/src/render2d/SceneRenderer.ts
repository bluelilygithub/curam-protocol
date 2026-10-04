import Konva from 'konva';
import { canvasToWorld, metresPerPixel, worldToCanvas, type View } from '../adapters/canvas';
import { doorFrame, wallGeometry, clearanceZones, fixtureCentre } from '../engine/constraints';
import { CUT_PLANE_HEIGHT } from '../engine/cutPlane';
import { footprintOf } from '../engine/footprints';
import { add, aabbOf, normalize, rotateVec, scale, sub } from '../engine/geometry';
import { polygonArea } from '../engine/polygons';
import { isAboveCutPlane } from '../engine/selection';
import { validateRoom } from '../engine/validation';
import { wallOutlines } from '../engine/wallOutline';
import type { Fixture, FurnitureInstance, Project, Room, ValidationViolation, Vec2 } from '../engine/types';
import { computeHandles } from '../interaction/handles';
import { ROOM_ID, type FeedbackBus, type FeedbackState, type PreviewObject } from '../state/feedbackBus';
import type { ProjectStore } from '../state/projectStore';
import type { UiStore } from '../state/uiStore';
import type { ViewStore } from '../state/viewStore';
import { glyphFor, type GlyphShape, type Weight } from './glyphs';
import { gridStep, readPalette, type Palette } from './theme';

export interface RendererDeps {
  container: HTMLDivElement;
  project: ProjectStore;
  ui: UiStore;
  view: ViewStore;
  bus: FeedbackBus;
  onAnimationDone(): void;
}

const WEIGHT_PX: Record<Weight, number> = { outline: 1.7, detail: 1, faint: 0.8 };
const ANIMATE_MS = 200;

/**
 * Imperative Konva renderer. The committed scene is redrawn only when the project, selection, toggles or view change; the
 * overlay (previews, ghost, dimensions, marquee, handles) is redrawn from the feedback bus, coalesced to one frame. Nothing
 * here is React state, so pointer movement never causes a React render (A12). All Y-flipping happens in `worldToCanvas`.
 */
export class SceneRenderer {
  readonly stage: Konva.Stage;
  private readonly gridLayer = new Konva.Layer({ listening: false });
  private readonly sceneLayer = new Konva.Layer({ listening: false });
  private readonly overlayLayer = new Konva.Layer({ listening: false });
  private palette: Palette;
  private readonly unsub: Array<() => void> = [];
  private staticQueued = false;
  private overlayQueued = false;
  private animating = false;
  private lastHidden = '';

  constructor(private readonly d: RendererDeps) {
    this.palette = readPalette();
    const { width, height } = d.view.getState().viewport;
    this.stage = new Konva.Stage({ container: d.container, width, height, listening: false });
    this.stage.add(this.gridLayer, this.sceneLayer, this.overlayLayer);
    this.unsub.push(
      d.project.subscribe(() => this.queueStatic()),
      d.ui.subscribe(() => this.queueStatic()),
      d.view.subscribe(() => { this.syncSize(); this.queueStatic(); }),
      d.bus.subscribe((s) => this.onFeedback(s)),
    );
    this.queueStatic();
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.stage.destroy();
  }

  refreshPalette(): void {
    this.palette = readPalette();
    this.queueStatic();
  }

  private get view(): View { return this.d.view.getState().view; }
  private get project(): Project | null { return this.d.project.getState().project; }
  private cv = (p: Vec2): Vec2 => worldToCanvas(p, this.view);
  private flat = (pts: Vec2[]): number[] => pts.flatMap((p) => { const c = this.cv(p); return [c.x, c.y]; });

  private syncSize(): void {
    const { width, height } = this.d.view.getState().viewport;
    if (this.stage.width() !== width || this.stage.height() !== height) this.stage.size({ width, height });
  }

  // ------------------------------------------------------------ scheduling

  private queueStatic(): void {
    if (this.staticQueued) return;
    this.staticQueued = true;
    requestAnimationFrame(() => {
      this.staticQueued = false;
      this.drawStatic();
      this.drawOverlay(this.d.bus.get());
    });
  }

  private onFeedback(s: FeedbackState): void {
    if (this.animating) return;
    const hidden = s.hiddenIds.join('|');
    if (hidden !== this.lastHidden) { // objects being dragged are hidden from the committed scene and drawn in the overlay
      this.lastHidden = hidden;
      this.queueStatic();
    }
    if (s.animateBack && s.previews.length) { this.animateBack(s); return; }
    if (this.overlayQueued) return;
    this.overlayQueued = true;
    requestAnimationFrame(() => {
      this.overlayQueued = false;
      this.drawOverlay(this.d.bus.get());
    });
  }

  // ------------------------------------------------------------ committed scene

  private drawStatic(): void {
    const project = this.project;
    const ui = this.d.ui.getState();
    const bus = this.d.bus.get();
    this.d.container.style.cursor = ui.placing || ui.tool === 'measure' ? 'crosshair' : ui.tool === 'pan' ? 'grab' : 'default';
    this.gridLayer.destroyChildren();
    this.sceneLayer.destroyChildren();
    const room = project?.rooms[0];
    this.drawGrid(ui.showGrid, ui.grid, room?.vertices[0]?.position ?? { x: 0, y: 0 });
    if (project && room) {
      const wallTool = ui.tool === 'wall_edit';
      const roomHidden = bus.hiddenIds.includes(ROOM_ID); // a candidate room is being dragged: it is drawn in the overlay
      const validation = validateRoom(room, project.furnitureDefinitions);
      if (!roomHidden) {
        this.drawRoom(room, ui.selection.filter((s) => s.kind === 'wall').map((s) => s.id));
        this.drawFixtures(room, ui.selection.filter((s) => s.kind === 'fixture').map((s) => s.id), bus.hiddenIds, validation.violations);
      }
      // in the wall tool furniture is dimmed and cannot be selected
      this.drawFurniture(room, wallTool ? [] : ui.selection.filter((s) => s.kind === 'furniture').map((s) => s.id), bus.hiddenIds, validation.violations, wallTool ? 0.45 : 1);
      if (ui.showClearances && !wallTool) this.drawClearances(project, room, ui.selection.filter((s) => s.kind === 'furniture').map((s) => s.id));
      if (wallTool && !roomHidden) this.drawVertexHandles(room, ui.selection);
      this.drawRoomLabel(room);
    }
    this.gridLayer.batchDraw();
    this.sceneLayer.batchDraw();
  }

  /** The grid starts at the room's first corner (the same origin the snapping uses), so lines and snaps agree. */
  private drawGrid(show: boolean, base: number, origin: Vec2): void {
    if (!show) return;
    const v = this.view;
    const { width, height } = this.stage.size();
    const tl = canvasToWorld({ x: 0, y: 0 }, v);
    const br = canvasToWorld({ x: width, y: height }, v);
    const step = gridStep(v.scale, base);
    const p = this.palette;
    const x0 = origin.x + Math.floor((tl.x - origin.x) / step) * step;
    const y0 = origin.y + Math.floor((br.y - origin.y) / step) * step;
    const major = (n: number, o: number): boolean => Math.abs(n - o - Math.round(n - o)) < 1e-6; // whole metres from the room corner
    this.gridLayer.add(new Konva.Shape({
      sceneFunc: (ctx) => {
        for (const pass of ['minor', 'major'] as const) {
          ctx.beginPath();
          for (let x = x0; x <= br.x; x += step) {
            if (major(x, origin.x) !== (pass === 'major')) continue;
            const c = worldToCanvas({ x, y: 0 }, v).x;
            ctx.moveTo(c, 0); ctx.lineTo(c, height);
          }
          for (let y = y0; y <= tl.y; y += step) {
            if (major(y, origin.y) !== (pass === 'major')) continue;
            const c = worldToCanvas({ x: 0, y }, v).y;
            ctx.moveTo(0, c); ctx.lineTo(width, c);
          }
          ctx.strokeStyle = pass === 'major' ? p.gridMajor : p.grid;
          ctx.lineWidth = pass === 'major' ? 1 : 0.6;
          ctx.stroke();
        }
      },
      listening: false,
    }));
  }

  private drawRoom(room: Room, selectedWalls: string[]): void {
    const p = this.palette;
    const layer = this.sceneLayer;
    layer.add(new Konva.Line({ points: this.flat(room.vertices.map((v) => v.position)), closed: true, fill: p.floor, listening: false }));
    for (const o of wallOutlines(room.vertices, room.walls)) {
      const sel = !!o.wallId && selectedWalls.includes(o.wallId);
      layer.add(new Konva.Line({
        points: this.flat(o.polygon), closed: true, fill: p.wall, stroke: sel ? p.primary : p.wallEdge,
        strokeWidth: sel ? 2.5 : 0.8, strokeScaleEnabled: false, lineJoin: 'miter', listening: false,
      }));
    }
    layer.add(new Konva.Line({
      points: this.flat(room.vertices.map((v) => v.position)), closed: true, stroke: p.wallEdge, strokeWidth: 1.6, listening: false,
    }));
  }

  private drawFixtures(room: Room, selected: string[], hidden: string[], violations: ValidationViolation[]): void {
    for (const f of [...room.fixtures].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (hidden.includes(f.id)) continue;
      const bad = violations.find((v) => (v.involvedFixtureIds ?? []).includes(f.id) && v.severity === 'hard' && v.involvedObjectIds.length === 0);
      this.drawFixture(this.sceneLayer, room, f, { selected: selected.includes(f.id), invalid: !!bad, ghost: false });
    }
  }

  /** Door / window in plan: cuts the wall, jambs, leaf + swing sector (door) or glazing lines (window). */
  private drawFixture(layer: Konva.Layer | Konva.Group, room: Room, f: Fixture, st: { selected: boolean; invalid: boolean; ghost: boolean; valid?: boolean }): void {
    const p = this.palette;
    const g = wallGeometry(room, f.wallId);
    if (!g) return;
    const t = g.wall.thickness;
    const out = scale(g.normal, -1);
    const c = fixtureCentre(g, f);
    const a = add(c, scale(g.dir, -f.width / 2));
    const b = add(c, scale(g.dir, f.width / 2));
    const ink = st.invalid || st.valid === false ? p.hard : st.selected ? p.primary : p.wallEdge;
    const alpha = st.ghost ? 0.7 : 1;
    const line = (pts: Vec2[], w = 1, dash?: number[], color = ink): Konva.Line =>
      new Konva.Line({ points: this.flat(pts), stroke: color, strokeWidth: w, dash, opacity: alpha, strokeScaleEnabled: false, listening: false });
    layer.add(new Konva.Line({ points: this.flat([a, b, add(b, scale(out, t + 0.002)), add(a, scale(out, t + 0.002))]), closed: true, fill: st.ghost ? 'rgba(255,255,255,0.85)' : p.floor, listening: false }));
    layer.add(line([a, add(a, scale(out, t))], 1.4));
    layer.add(line([b, add(b, scale(out, t))], 1.4));
    if (f.type === 'window') {
      layer.add(line([a, b], 1.2));
      layer.add(line([add(a, scale(out, t)), add(b, scale(out, t))], 1.2));
      layer.add(line([add(a, scale(out, t / 2)), add(b, scale(out, t / 2))], 0.8, undefined, p.dim));
    } else {
      const fr = doorFrame(room, f);
      if (fr) {
        const n = 24;
        const arc: Vec2[] = [];
        for (let i = 0; i <= n; i++) arc.push(add(fr.hinge, scale(rotateVec(fr.closed, (fr.sign * (fr.angle * i)) / n), fr.radius)));
        layer.add(new Konva.Line({ points: this.flat([fr.hinge, ...arc]), closed: true, fill: st.valid === false || st.invalid ? 'rgba(239,68,68,0.10)' : 'rgba(204,120,92,0.08)', opacity: alpha, listening: false }));
        layer.add(line(arc, 0.9, [5, 4], p.muted));
        const open = arc[arc.length - 1];
        layer.add(line([fr.hinge, open], 2.4)); // the leaf, drawn open
        layer.add(line([a, b], 0.8, [3, 3], p.muted)); // closed position in the opening
        if ((f.accessZoneDepth ?? 0) > 0) {
          const outer: Vec2[] = [];
          for (let i = 0; i <= n; i++) outer.push(add(fr.hinge, scale(rotateVec(fr.closed, (fr.sign * (fr.angle * i)) / n), fr.radius + (f.accessZoneDepth ?? 0))));
          layer.add(line(outer, 0.8, [2, 4], p.muted));
        }
      }
    }
  }

  /** Corner squares (selected one filled) and, for a selected wall, a "+" at its midpoint hinting at double-click to add a corner. */
  private drawVertexHandles(room: Room, selection: Array<{ kind: string; id: string }>): void {
    const p = this.palette;
    const selV = selection.filter((s) => s.kind === 'vertex').map((s) => s.id);
    for (const v of room.vertices) {
      const c = this.cv(v.position);
      const sel = selV.includes(v.id);
      this.sceneLayer.add(new Konva.Rect({
        x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill: sel ? p.primary : p.paper, stroke: sel ? p.primary : p.text,
        strokeWidth: 1.6, listening: false,
      }));
    }
    for (const w of selection.filter((s) => s.kind === 'wall')) {
      const g = wallGeometry(room, w.id);
      if (!g) continue;
      const m = this.cv({ x: (g.start.x + g.end.x) / 2, y: (g.start.y + g.end.y) / 2 });
      this.sceneLayer.add(new Konva.Circle({ x: m.x, y: m.y, radius: 9, fill: p.paper, stroke: p.primary, strokeWidth: 1.6, listening: false }));
      this.sceneLayer.add(new Konva.Line({ points: [m.x - 4, m.y, m.x + 4, m.y], stroke: p.primary, strokeWidth: 1.6, listening: false }));
      this.sceneLayer.add(new Konva.Line({ points: [m.x, m.y - 4, m.x, m.y + 4], stroke: p.primary, strokeWidth: 1.6, listening: false }));
    }
  }

  private drawFurniture(room: Room, selected: string[], hidden: string[], violations: ValidationViolation[], alpha = 1): void {
    const p = this.palette;
    const sorted = [...room.furniture].sort((a, b) => a.elevation - b.elevation || (a.id < b.id ? -1 : 1)); // explicit draw order (C18)
    for (const inst of sorted) {
      if (hidden.includes(inst.id)) continue;
      const mine = violations.filter((v) => v.involvedObjectIds.includes(inst.id));
      const hard = mine.some((v) => v.severity === 'hard');
      const soft = !hard && mine.some((v) => v.severity === 'soft');
      this.sceneLayer.add(this.furnitureGroup(inst, { stroke: p.text, dashed: isAboveCutPlane(inst, CUT_PLANE_HEIGHT), fill: p.paper, alpha, hard, soft }));
      if (selected.includes(inst.id)) {
        this.sceneLayer.add(new Konva.Line({
          points: this.flat(footprintOf(inst)), closed: true, stroke: p.primary, strokeWidth: 2.2, strokeScaleEnabled: false, listening: false,
        }));
      }
    }
  }

  /** One furniture instance as a Konva group: blueprint glyph + front marker, in its local frame (C20). */
  furnitureGroup(
    inst: FurnitureInstance,
    st: { stroke: string; dashed: boolean; fill: string; alpha: number; hard: boolean; soft: boolean },
  ): Konva.Group {
    const p = this.palette;
    const s = this.view.scale;
    const c = this.cv(inst.position);
    // canvas = Flip · R(φ) = R(−φ) · Flip: scale (s, −s), then rotate by −φ
    const group = new Konva.Group({ x: c.x, y: c.y, rotation: (-inst.rotation * 180) / Math.PI, scaleX: s, scaleY: -s, opacity: st.alpha, listening: false });
    const glyph = glyphFor(inst.definitionId, inst.width, inst.length);
    const hw = inst.width / 2;
    const hl = inst.length / 2;
    group.add(new Konva.Rect({ x: -hw, y: -hl, width: inst.width, height: inst.length, fill: st.hard ? 'rgba(239,68,68,0.16)' : st.fill, listening: false }));
    const dash = st.dashed ? [7, 4] : undefined;
    const color = st.hard ? p.hard : st.soft ? p.soft : st.stroke;
    const stroke = (w: Weight) => ({ stroke: color, strokeWidth: WEIGHT_PX[w] * (st.hard ? 1.25 : 1), strokeScaleEnabled: false, dash: w === 'outline' ? (st.soft ? [5, 3] : dash) : dash, listening: false });
    for (const sh of glyph.shapes as GlyphShape[]) {
      if (sh.t === 'rect') group.add(new Konva.Rect({ x: sh.x, y: sh.y, width: sh.w, height: sh.h, ...stroke(sh.weight) }));
      else if (sh.t === 'line') group.add(new Konva.Line({ points: sh.pts, ...stroke(sh.weight) }));
      else group.add(new Konva.Circle({ x: sh.x, y: sh.y, radius: sh.r, ...stroke(sh.weight) }));
    }
    group.add(new Konva.Line({ points: glyph.frontMarker.pts, closed: true, fill: color, stroke: color, strokeWidth: 0.6, strokeScaleEnabled: false, opacity: 0.85, listening: false }));
    return group;
  }

  private drawClearances(project: Project, room: Room, selected: string[]): void {
    const p = this.palette;
    for (const id of selected) {
      const inst = room.furniture.find((f) => f.id === id);
      if (!inst) continue;
      const policies = project.furnitureDefinitions.find((d) => d.id === inst.definitionId)?.clearancePolicies ?? [];
      for (const z of clearanceZones(inst, policies)) {
        const col = z.policy.severity === 'hard' ? p.hard : p.soft;
        this.sceneLayer.add(new Konva.Line({
          points: this.flat(z.polygon), closed: true, fill: z.policy.severity === 'hard' ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
          stroke: col, strokeWidth: 1.1, dash: [6, 4], strokeScaleEnabled: false, listening: false,
        }));
      }
    }
  }

  /** Room name and area (P0 "room area display"), set just below the room's bottom-left outside corner so it never sits under furniture. */
  private drawRoomLabel(room: Room): void {
    const pts = room.vertices.map((v) => v.position);
    const box = aabbOf(pts);
    const thickest = Math.max(0.15, ...room.walls.map((w) => w.thickness));
    const anchor = this.cv({ x: box.min.x, y: box.min.y - thickest });
    this.sceneLayer.add(new Konva.Text({
      text: `${room.name} · ${polygonArea(pts).toFixed(2)} m²`, x: anchor.x, y: anchor.y + 8,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, fill: this.palette.muted, listening: false,
    }));
  }

  // ------------------------------------------------------------ overlay (previews, handles, dimensions)

  private drawOverlay(s: FeedbackState): void {
    if (this.animating) return;
    const project = this.project;
    const room = project?.rooms[0];
    this.overlayLayer.destroyChildren();
    if (project && room && s.roomPreview) this.drawRoomPreview(room, s);
    if (s.drawing) this.drawDrawing(s.drawing);
    if (project && room) {
      for (const pv of s.previews) this.drawPreview(room, pv);
      if (s.previews.length === 0) this.drawHandles(project);
      if (s.snap) this.drawSnap(s.snap.position);
      for (const d of s.dims) this.drawDim(d);
      if (s.marquee) this.drawMarquee(s.marquee.a, s.marquee.b);
      if (s.measure) this.drawMeasure(s.measure.a, s.measure.b);
    }
    this.overlayLayer.batchDraw();
  }

  /** The candidate room while a corner is dragged: floor, mitred walls, fixtures, orange bad edges, dashed-red impact outlines. */
  private drawRoomPreview(room: Room, s: FeedbackState): void {
    const p = this.palette;
    const rp = s.roomPreview!;
    const candidate: Room = { ...room, vertices: rp.vertices, walls: rp.walls, fixtures: rp.fixtures };
    const pts = rp.vertices.map((v) => v.position);
    this.overlayLayer.add(new Konva.Line({ points: this.flat(pts), closed: true, fill: p.floor, listening: false }));
    for (const o of wallOutlines(rp.vertices, rp.walls)) {
      this.overlayLayer.add(new Konva.Line({ points: this.flat(o.polygon), closed: true, fill: p.wall, stroke: p.wallEdge, strokeWidth: 0.8, strokeScaleEnabled: false, listening: false }));
    }
    for (const f of rp.fixtures) this.drawFixture(this.overlayLayer, candidate, f, { selected: false, invalid: false, ghost: false });
    this.overlayLayer.add(new Konva.Line({ points: this.flat(pts), closed: true, stroke: p.wallEdge, strokeWidth: 1.6, listening: false }));
    for (const i of rp.badEdges) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      this.overlayLayer.add(new Konva.Line({ points: this.flat([a, b]), stroke: '#f97316', strokeWidth: 4, lineCap: 'round', listening: false }));
    }
    for (const v of rp.vertices) {
      const c = this.cv(v.position);
      this.overlayLayer.add(new Konva.Rect({ x: c.x - 6, y: c.y - 6, width: 12, height: 12, fill: p.paper, stroke: p.text, strokeWidth: 1.6, listening: false }));
    }
    for (const id of s.impact) {
      const f = room.furniture.find((x) => x.id === id);
      if (f) {
        this.overlayLayer.add(new Konva.Line({
          points: this.flat(footprintOf(f)), closed: true, stroke: p.hard, strokeWidth: 2, dash: [6, 4], fill: 'rgba(239,68,68,0.10)', strokeScaleEnabled: false, listening: false,
        }));
        continue;
      }
      const fx = rp.fixtures.find((x) => x.id === id);
      const g = fx ? wallGeometry(candidate, fx.wallId) : undefined;
      if (fx && g) {
        const c = fixtureCentre(g, fx);
        const a = add(c, scale(g.dir, -fx.width / 2));
        const b = add(c, scale(g.dir, fx.width / 2));
        const out = scale(g.normal, -g.wall.thickness);
        this.overlayLayer.add(new Konva.Line({ points: this.flat([a, b, add(b, out), add(a, out)]), closed: true, stroke: p.hard, strokeWidth: 2, dash: [5, 3], listening: false }));
      }
    }
  }

  /** "Draw a room" in progress: corners, segment lengths, rubber band, a ring on the first corner when it can be closed. */
  private drawDrawing(d: NonNullable<FeedbackState['drawing']>): void {
    const p = this.palette;
    const line = d.cursor ? [...d.points, d.cursor] : d.points;
    if (d.points.length >= 3) {
      this.overlayLayer.add(new Konva.Line({ points: this.flat(d.points), closed: true, fill: 'rgba(204,120,92,0.07)', listening: false }));
    }
    this.overlayLayer.add(new Konva.Line({ points: this.flat(line), stroke: p.primary, strokeWidth: 2.2, lineJoin: 'round', listening: false }));
    for (const i of d.badEdges) {
      const a = line[i];
      const b = line[(i + 1) % line.length];
      if (a && b) this.overlayLayer.add(new Konva.Line({ points: this.flat([a, b]), stroke: '#f97316', strokeWidth: 4, lineCap: 'round', listening: false }));
    }
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 0.01) {
        const m = this.cv({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        this.chip(`${len.toFixed(2)} m`, { x: m.x, y: m.y - 14 }, p.dim);
      }
    }
    for (const q of d.points) {
      const c = this.cv(q);
      this.overlayLayer.add(new Konva.Rect({ x: c.x - 5, y: c.y - 5, width: 10, height: 10, fill: p.paper, stroke: p.primary, strokeWidth: 2, listening: false }));
    }
    if (d.points.length) {
      const f = this.cv(d.points[0]);
      if (d.nearFirst) this.overlayLayer.add(new Konva.Circle({ x: f.x, y: f.y, radius: 13, stroke: p.valid, strokeWidth: 2.5, listening: false }));
      else if (d.closable) this.overlayLayer.add(new Konva.Circle({ x: f.x, y: f.y, radius: 11, stroke: p.primary, strokeWidth: 1.4, dash: [3, 3], listening: false }));
    }
  }

  private drawPreview(room: Room, pv: PreviewObject): void {
    const p = this.palette;
    if (pv.kind === 'furniture' && pv.instance) {
      const hard = !pv.valid;
      const soft = pv.valid && pv.violations.some((v) => v.severity === 'soft');
      this.overlayLayer.add(this.furnitureGroup(pv.instance, {
        stroke: pv.ghost ? p.primary : p.text, dashed: isAboveCutPlane(pv.instance), fill: pv.ghost ? 'rgba(251,250,246,0.7)' : p.paper,
        alpha: pv.ghost ? 0.78 : 0.92, hard, soft,
      }));
      if (!hard) {
        this.overlayLayer.add(new Konva.Line({
          points: this.flat(footprintOf(pv.instance)), closed: true, stroke: soft ? p.soft : p.primary, strokeWidth: 1.8, dash: soft ? [5, 3] : undefined,
          strokeScaleEnabled: false, listening: false,
        }));
      }
    } else if (pv.kind === 'fixture' && pv.fixture) {
      this.drawFixture(this.overlayLayer, room, pv.fixture, { selected: false, invalid: false, ghost: pv.ghost, valid: pv.valid });
    } else if (pv.freeAt) {
      const c = this.cv(pv.freeAt);
      const w = (pv.freeWidth ?? 0.8) * this.view.scale;
      this.overlayLayer.add(new Konva.Rect({ x: c.x - w / 2, y: c.y - 6, width: w, height: 12, stroke: p.hard, dash: [4, 3], strokeWidth: 1.4, fill: 'rgba(239,68,68,0.08)', listening: false }));
    }
  }

  private drawHandles(project: Project): void {
    const ui = this.d.ui.getState();
    const room = project.rooms[0];
    const h = computeHandles(project, ui.selection, metresPerPixel(this.view));
    const p = this.palette;
    if (!h.rotate) return;
    const selected = ui.selection.map((s) => room.furniture.find((f) => f.id === s.id)).filter((f): f is FurnitureInstance => !!f);
    if (selected.length > 1) {
      const box = aabbOf(selected.flatMap((f) => footprintOf(f)));
      const a = this.cv(box.min);
      const b = this.cv(box.max);
      this.overlayLayer.add(new Konva.Rect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), stroke: p.primary, dash: [6, 4], strokeWidth: 1.2, listening: false }));
    }
    const top = selected.length ? this.cv({ x: h.rotate.x, y: aabbOf(selected.flatMap((f) => footprintOf(f))).max.y }) : this.cv(h.rotate);
    const r = this.cv(h.rotate);
    this.overlayLayer.add(new Konva.Line({ points: [top.x, top.y, r.x, r.y], stroke: p.primary, strokeWidth: 1.2, listening: false }));
    this.overlayLayer.add(new Konva.Circle({ x: r.x, y: r.y, radius: 7, fill: p.paper, stroke: p.primary, strokeWidth: 2, listening: false }));
    for (const item of h.resize) {
      const c = this.cv(item.world);
      this.overlayLayer.add(new Konva.Rect({ x: c.x - 5, y: c.y - 5, width: 10, height: 10, fill: p.paper, stroke: p.primary, strokeWidth: 1.6, listening: false }));
    }
  }

  private drawSnap(pos: Vec2): void {
    const c = this.cv(pos);
    const col = this.palette.primary;
    this.overlayLayer.add(new Konva.Line({ points: [c.x - 7, c.y, c.x + 7, c.y], stroke: col, strokeWidth: 1.4, listening: false }));
    this.overlayLayer.add(new Konva.Line({ points: [c.x, c.y - 7, c.x, c.y + 7], stroke: col, strokeWidth: 1.4, listening: false }));
    this.overlayLayer.add(new Konva.Circle({ x: c.x, y: c.y, radius: 4, stroke: col, strokeWidth: 1.4, listening: false }));
  }

  private chip(text: string, c: Vec2, color: string): void {
    const t = new Konva.Text({ text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, fill: color, padding: 3, listening: false });
    const w = t.width();
    const h = t.height();
    this.overlayLayer.add(new Konva.Rect({ x: c.x - w / 2, y: c.y - h / 2, width: w, height: h, fill: this.palette.paper, stroke: this.palette.border, strokeWidth: 1, cornerRadius: 2, listening: false }));
    t.position({ x: c.x - w / 2, y: c.y - h / 2 });
    this.overlayLayer.add(t);
  }

  private drawDim(d: { kind: string; from: Vec2; to: Vec2; text: string; label: { center: Vec2 } | null }): void {
    const col = d.kind === 'alignment' ? this.palette.primary : this.palette.dim;
    const a = this.cv(d.from);
    const b = this.cv(d.to);
    this.overlayLayer.add(new Konva.Line({ points: [a.x, a.y, b.x, b.y], stroke: col, strokeWidth: 1, dash: d.kind === 'alignment' ? [4, 3] : undefined, listening: false }));
    const dir = normalize(sub(b, a));
    const nx = -dir.y * 4;
    const ny = dir.x * 4;
    for (const e of [a, b]) this.overlayLayer.add(new Konva.Line({ points: [e.x - nx, e.y - ny, e.x + nx, e.y + ny], stroke: col, strokeWidth: 1, listening: false }));
    if (d.label && d.kind !== 'alignment') this.chip(d.text, this.cv(d.label.center), col);
  }

  private drawMarquee(a: Vec2, b: Vec2): void {
    const ca = this.cv(a);
    const cb = this.cv(b);
    this.overlayLayer.add(new Konva.Rect({
      x: Math.min(ca.x, cb.x), y: Math.min(ca.y, cb.y), width: Math.abs(cb.x - ca.x), height: Math.abs(cb.y - ca.y),
      stroke: this.palette.primary, dash: [5, 4], strokeWidth: 1.2, fill: 'rgba(204,120,92,0.07)', listening: false,
    }));
  }

  private drawMeasure(a: Vec2, b: Vec2 | null): void {
    const p = this.palette;
    const ca = this.cv(a);
    this.overlayLayer.add(new Konva.Circle({ x: ca.x, y: ca.y, radius: 4, fill: p.primary, listening: false }));
    if (!b) return;
    const cb = this.cv(b);
    this.overlayLayer.add(new Konva.Line({ points: [ca.x, ca.y, cb.x, cb.y], stroke: p.primary, strokeWidth: 1.6, listening: false }));
    this.overlayLayer.add(new Konva.Circle({ x: cb.x, y: cb.y, radius: 4, fill: p.primary, listening: false }));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    this.chip(`${len.toFixed(3)} m`, { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 - 14 }, p.primary);
    this.chip(`Δx ${(b.x - a.x).toFixed(2)}  Δy ${(b.y - a.y).toFixed(2)}`, { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 + 10 }, p.muted);
  }

  // ------------------------------------------------------------ animate back (invalid release, A11)

  private animateBack(s: FeedbackState): void {
    this.animating = true;
    const project = this.project;
    const room = project?.rooms[0];
    this.overlayLayer.destroyChildren();
    const groups: Array<{ g: Konva.Group; target: FurnitureInstance }> = [];
    for (const pv of s.previews) {
      if (pv.kind === 'furniture' && pv.instance) {
        const target = room?.furniture.find((f) => f.id === pv.id);
        const g = this.furnitureGroup(pv.instance, { stroke: this.palette.text, dashed: isAboveCutPlane(pv.instance), fill: this.palette.paper, alpha: 0.92, hard: true, soft: false });
        this.overlayLayer.add(g);
        if (target) groups.push({ g, target });
      } else if (room && pv.kind === 'fixture' && pv.fixture) {
        this.drawFixture(this.overlayLayer, room, pv.fixture, { selected: false, invalid: false, ghost: false, valid: false });
      }
    }
    this.overlayLayer.batchDraw();
    const finish = (): void => {
      this.animating = false;
      this.d.onAnimationDone();
    };
    if (groups.length === 0) { setTimeout(finish, 160); return; }
    let remaining = groups.length;
    for (const { g, target } of groups) {
      const c = this.cv(target.position);
      new Konva.Tween({
        node: g, duration: ANIMATE_MS / 1000, x: c.x, y: c.y, rotation: (-target.rotation * 180) / Math.PI, easing: Konva.Easings.EaseOut,
        onFinish: () => { if (--remaining === 0) finish(); },
      }).play();
    }
  }
}
