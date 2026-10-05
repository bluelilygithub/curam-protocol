// The 2D plan: an imperative Konva scene plus the pointer interaction. Per-frame state (a drag in progress, the cursor, a polygon being
// drawn) lives HERE, never in a store: pointer moves must not cause React or store updates. Only a finished gesture commits one command.
import Konva from 'konva';
import { canvasToWorld, worldToCanvas, zoomAt, type View } from '@planner-core/adapters/canvas';
import { footprintCorners } from '@planner-core/engine/footprints';
import { dist } from '@planner-core/engine/geometry';
import { polygonArea } from '@planner-core/engine/polygons';
import type { App } from '../createApp';
import { gateSwingSector } from '../checks/geom';
import { findItem, replaceItem, translated, vertexAt, vertexCount, withVertex } from '../domain/edit';
import { nearestBoundaryEdge, pick, snapPoint } from '../domain/hit';
import { pathSegments, polylineLength, sampleShape, shapeCentroid } from '../domain/shapes';
import type { Boundary, GardenProject, Vec2 } from '../domain/types';
import { botanicalLabel, plantById, plantLabel } from '../plants/plants';
import { canopyColour, isFlowering, leafFactor, plantSizeAt } from '../plants/growth';
import type { ItemKind, Selection, Tool } from '../state/uiStore';
import {
  COLOURS, EDGING_COLOUR, FENCE_COLOUR, GRASS_COLOUR, MULCH_COLOUR, PATH_COLOUR, SERVICE_COLOUR, STRUCTURE_COLOUR,
} from './theme';
import { MID_MONTH_DAY, solarPosition, sunDirectionOnPlan } from '../sun/solar';
import { placeFor } from '../sun/timezone';
import { obstaclesOf, shadowsFor, type Shadow } from '../sun/shadows';
import { computeSunHours, hoursAt, SUN_COLOURS, type SunGrid } from '../sun/sunHours';
import { sunLevelForHours } from '../plants/suitability';
import { chooseZoom, groupTransform, shiftAnchor, visibleTiles, TILE, type LatLng } from '../map/mercator';

const DRAW_TOOLS: ReadonlySet<Tool> = new Set(['boundary', 'house', 'bed', 'lawn', 'zone', 'path', 'service']);
const POLY_TOOLS: ReadonlySet<Tool> = new Set(['boundary', 'house', 'bed', 'lawn', 'zone']);
const RECT_DRAG_PX = 10;
const DOUBLE_TAP_MS = 350;

interface Draft { points: Vec2[]; rectFrom: { world: Vec2; px: Vec2 } | null; rectTo: Vec2 | null }
type Drag =
  | { mode: 'move'; sel: Selection; start: Vec2; startPx: Vec2; orig: unknown; moved: boolean }
  | { mode: 'vertex'; sel: Selection; index: number; orig: unknown }
  | { mode: 'north' }
  | { mode: 'map'; start: Vec2; anchor0: LatLng }
  | { mode: 'pan'; startPx: Vec2; startView: View }
  | { mode: 'rect' };

const pxPts = (pts: Vec2[], v: View): number[] => pts.flatMap((p) => { const c = worldToCanvas(p, v); return [c.x, c.y]; });
const flat = (pts: Vec2[]): number[] => pts.flatMap((p) => [p.x, p.y]);

export class Plan2D {
  private stage: Konva.Stage;
  private mapLayer = new Konva.Layer({ listening: false });
  private world = new Konva.Layer({ listening: false });
  /** While the map is being dragged into place: where its anchor is right now (committed on release). */
  private mapOverride: LatLng | null = null;
  private mapOn = false;
  private overlay = new Konva.Layer({ listening: false });
  private underlayImg: { src: string; image: HTMLImageElement } | null = null;
  /** The sun-hours map, kept until the garden, growth stage or month changes (never recomputed per frame of a drag). */
  private sunCache: { project: GardenProject | null; stage: string; month: number; grid: SunGrid | null } | null = null;
  private offs: Array<() => void> = [];
  private raf = 0;
  private draft: Draft = { points: [], rectFrom: null, rectTo: null };
  private drag: Drag | null = null;
  private override: { sel: Selection; item: unknown } | null = null;
  private cursorPx: Vec2 | null = null;
  private snapped: { point: Vec2; kind: string } | null = null;
  private pointers = new Map<number, Vec2>();
  private pinch: { dist: number; view: View } | null = null;
  private spaceDown = false;
  private lastTap = 0;
  private areaNote: { at: Vec2; text: string; until: number } | null = null;
  private readonly coarse: boolean;

  constructor(private container: HTMLDivElement, private app: App) {
    this.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.stage.add(this.mapLayer);
    this.stage.add(this.world);
    this.stage.add(this.overlay);
    container.style.touchAction = 'none';

    const dom = (type: string, fn: (e: never) => void, opts?: AddEventListenerOptions): void => {
      container.addEventListener(type, fn as EventListener, opts);
      this.offs.push(() => container.removeEventListener(type, fn as EventListener, opts));
    };
    dom('pointerdown', (e: PointerEvent) => this.onDown(e));
    dom('pointermove', (e: PointerEvent) => this.onMove(e));
    dom('pointerup', (e: PointerEvent) => this.onUp(e));
    dom('pointercancel', (e: PointerEvent) => this.onUp(e, true));
    dom('pointerleave', () => { this.cursorPx = null; this.snapped = null; this.schedule(); });
    dom('wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    dom('dblclick', (e: MouseEvent) => { e.preventDefault(); });
    const key = (down: boolean) => (e: KeyboardEvent): void => { if (e.code === 'Space' && !isTyping(e)) { this.spaceDown = down; if (down) e.preventDefault(); } };
    const kd = key(true), ku = key(false);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    this.offs.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); });

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.offs.push(() => ro.disconnect());
    this.offs.push(app.project.subscribe(() => this.schedule()));
    this.offs.push(app.ui.subscribe((s, p) => { if (s.tool !== p.tool) this.cancelDraft(); this.schedule(); }));
    this.offs.push(app.view.subscribe(() => this.schedule()));
    this.offs.push(app.checks.subscribe(() => this.schedule()));
    this.resize();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.offs.forEach((f) => f());
    this.stage.destroy();
  }

  // ------------------------------------------------------------------ public draft controls (keyboard)
  /** Enter / double-tap: finish the shape being drawn. */
  finishDraft(): boolean {
    const t = this.app.ui.getState().tool;
    const pts = this.draft.points;
    if (t === 'path' || t === 'service') {
      if (pts.length >= 2) {
        if (t === 'path') this.app.addPath(pts); else this.app.addService(pts, this.app.ui.getState().serviceKind);
        this.draft = emptyDraft(); this.app.setTool('select'); this.schedule(); return true;
      }
      return false;
    }
    if (POLY_TOOLS.has(t) && pts.length >= 3) { this.closePolygon(pts); return true; }
    return false;
  }
  cancelDraft(): void { this.draft = emptyDraft(); this.drag = this.drag?.mode === 'rect' ? null : this.drag; this.schedule(); }
  undoLastPoint(): boolean {
    if (!this.draft.points.length) return false;
    this.draft = { ...this.draft, points: this.draft.points.slice(0, -1) };
    this.schedule();
    return true;
  }
  get drawing(): boolean { return this.draft.points.length > 0 || this.draft.rectFrom !== null; }

  // ------------------------------------------------------------------ size / scheduling
  private resize(): void {
    const w = Math.max(100, this.container.clientWidth), h = Math.max(100, this.container.clientHeight);
    this.stage.size({ width: w, height: h });
    this.app.view.getState().setViewport(w, h);
    this.schedule();
  }
  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  private get view(): View { return this.app.view.getState().view; }
  private px(e: PointerEvent): Vec2 {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private toWorld(px: Vec2): Vec2 { return canvasToWorld(px, this.view); }

  /** A plant dragged from the library and released over the plan: plant it there (snapped like a click) and select it. */
  dropPlant(plantId: string, clientX: number, clientY: number, shift = false): void {
    const r = this.container.getBoundingClientRect();
    const world = this.toWorld({ x: clientX - r.left, y: clientY - r.top });
    this.app.addPlant(plantId, this.snap(world, null, shift).point);
    this.schedule();
  }
  private tolMetres(px = 10): number { return (this.coarse ? px * 1.6 : px) / this.view.scale; }

  /** The project as drawn right now: with a drag in progress, the dragged item at its provisional place. */
  private current(): GardenProject | null {
    const p = this.app.project.getState().project;
    if (!p || !this.override) return p;
    return withOverride(p, this.override.sel, this.override.item);
  }

  private snap(world: Vec2, exclude: Selection | null, shift: boolean): { point: Vec2; kind: string } {
    const p = this.app.project.getState().project;
    if (!p) return { point: world, kind: 'none' };
    const ui = this.app.ui.getState();
    const base = exclude ? withoutItem(p, exclude) : p;
    return snapPoint(base, world, { grid: ui.grid, tol: this.tolMetres(11), useGrid: ui.snap && !shift });
  }

  // ------------------------------------------------------------------ pointer handling
  private onDown(e: PointerEvent): void {
    this.container.setPointerCapture(e.pointerId);
    const px = this.px(e);
    this.pointers.set(e.pointerId, px);
    this.app.ui.getState().clearStatus();
    if (this.pointers.size === 2) { this.beginPinch(); return; }
    if (this.pointers.size > 2) return;
    const p = this.app.project.getState().project;
    if (!p) return;
    const ui = this.app.ui.getState();
    const world = this.toWorld(px);

    if (e.button === 1 || this.spaceDown) { this.drag = { mode: 'pan', startPx: px, startView: this.view }; return; }
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    if (this.northHit(px)) { this.drag = { mode: 'north' }; return; }
    if (ui.mapAlign && p.map?.on) { this.drag = { mode: 'map', start: world, anchor0: { lat: p.map.lat, lng: p.map.lng } }; return; }

    if (ui.tool === 'select') {
      const sel = ui.selection;
      if (sel) {
        const item = findItem(p, sel);
        const n = item ? vertexCount(item, sel.kind) : 0;
        const hr = this.tolMetres(this.coarse ? 12 : 8);
        for (let i = 0; i < n; i++) {
          if (dist(vertexAt(item, sel.kind, i), world) <= hr) { this.drag = { mode: 'vertex', sel, index: i, orig: item }; return; }
        }
      }
      const hit = pick(p, world, this.tolMetres(8), ui.stage);
      if (hit) {
        // a boundary click chooses the edge as well, so the Inspector can set that edge's fence
        ui.select(hit);
        const item = findItem(p, hit);
        ui.set({ boundaryEdge: hit.kind === 'boundary' ? nearestBoundaryEdge(p, world, this.tolMetres(10)) : null });
        this.drag = { mode: 'move', sel: hit, start: world, startPx: px, orig: item, moved: false };
      } else {
        ui.select(null);
        this.drag = { mode: 'pan', startPx: px, startView: this.view };
      }
      return;
    }

    if (POLY_TOOLS.has(ui.tool) && this.draft.points.length === 0) {
      this.draft = { points: [], rectFrom: { world: this.snap(world, null, e.shiftKey).point, px }, rectTo: null };
    }
  }

  private onMove(e: PointerEvent): void {
    const px = this.px(e);
    this.cursorPx = px;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, px);
    if (this.pinch && this.pointers.size >= 2) { this.updatePinch(); return; }
    const ui = this.app.ui.getState();
    const world = this.toWorld(px);
    const d = this.drag;

    if (d?.mode === 'pan') {
      this.app.view.getState().setView({ ...d.startView, offsetX: d.startView.offsetX + (px.x - d.startPx.x), offsetY: d.startView.offsetY + (px.y - d.startPx.y) });
      return;
    }
    if (d?.mode === 'north') { this.setNorthFromPointer(px, false); return; }
    if (d?.mode === 'map') {
      const p = this.app.project.getState().project;
      if (p) { this.mapOverride = shiftAnchor(d.anchor0, p.northDeg, { x: world.x - d.start.x, y: world.y - d.start.y }); this.schedule(); }
      return;
    }
    if (d?.mode === 'move') {
      if (!d.moved && dist(px, d.startPx) < 4) return;
      d.moved = true;
      const raw = { x: world.x - d.start.x, y: world.y - d.start.y };
      this.override = { sel: d.sel, item: translated(d.orig, d.sel.kind, raw.x, raw.y) };
      const moved = this.override.item;
      // snap the item's anchor (a plant or structure centre, or the first corner) to a nearby corner or edge
      const anchor = anchorOf(moved, d.sel.kind), anchor0 = anchorOf(d.orig, d.sel.kind);
      if (anchor && anchor0) {
        const s = this.snap(anchor, d.sel, e.shiftKey);
        if (s.kind !== 'none') this.override = { sel: d.sel, item: translated(d.orig, d.sel.kind, s.point.x - anchor0.x, s.point.y - anchor0.y) };
        this.snapped = s.kind === 'none' ? null : s;
      }
      this.schedule();
      return;
    }
    if (d?.mode === 'vertex') {
      const s = this.snap(world, d.sel, e.shiftKey);
      this.snapped = s.kind === 'none' ? null : s;
      this.override = { sel: d.sel, item: withVertex(d.orig, d.sel.kind, d.index, s.point) };
      this.schedule();
      return;
    }

    // drawing tools
    if (POLY_TOOLS.has(ui.tool) && this.draft.rectFrom && this.draft.points.length === 0) {
      if (dist(px, this.draft.rectFrom.px) > RECT_DRAG_PX) this.draft = { ...this.draft, rectTo: this.snap(world, null, e.shiftKey).point };
    }
    if (ui.tool === 'select' || DRAW_TOOLS.has(ui.tool) || ui.tool === 'structure' || ui.tool === 'plant' || ui.tool === 'scale') {
      const s = ui.tool === 'select' ? null : this.snap(world, null, e.shiftKey);
      this.snapped = s && s.kind !== 'none' ? s : null;
    }
    this.schedule();
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const px = this.px(e);
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = null; return; }
    const ui = this.app.ui.getState();
    const p = this.app.project.getState().project;
    const d = this.drag;
    this.drag = null;
    if (cancelled || !p) { this.override = null; this.schedule(); return; }
    const world = this.toWorld(px);

    if (d?.mode === 'north') { this.setNorthFromPointer(px, true); return; }
    if (d?.mode === 'pan') return;
    if (d?.mode === 'map') {
      const at = this.mapOverride;
      this.mapOverride = null;
      if (at && p.map && (at.lat !== p.map.lat || at.lng !== p.map.lng)) this.app.setMap({ ...p.map, lat: at.lat, lng: at.lng }, 'Move map');
      this.schedule();
      return;
    }
    if (d?.mode === 'move' || d?.mode === 'vertex') {
      const ov = this.override;
      this.override = null;
      this.snapped = null;
      if (ov && (d.mode === 'vertex' || (d.mode === 'move' && d.moved))) {
        const cmd = replaceItem(p, d.sel, ov.item);
        if (cmd) this.app.commit(cmd, d.mode === 'vertex' ? 'Move corner' : 'Move');
      }
      this.schedule();
      return;
    }

    const snapped = this.snap(world, null, e.shiftKey).point;
    switch (ui.tool) {
      case 'boundary': case 'house': case 'bed': case 'lawn': case 'zone': {
        const from = this.draft.rectFrom;
        if (from && this.draft.rectTo && this.draft.points.length === 0) {
          const a = from.world, b = this.draft.rectTo;
          this.draft = emptyDraft();
          if (Math.abs(a.x - b.x) > 0.05 && Math.abs(a.y - b.y) > 0.05) this.commitRect(ui.tool, a, b);
          this.schedule();
          return;
        }
        this.draft = { ...this.draft, rectFrom: null, rectTo: null };
        this.addPoint(snapped, px);
        return;
      }
      case 'path': case 'service': this.addPoint(snapped, px); return;
      case 'structure': this.app.addStructure(ui.structureKind, snapped); this.app.setTool('select'); return;
      case 'plant':
        if (ui.placingPlantId) { this.app.addPlant(ui.placingPlantId, snapped, e.shiftKey); this.schedule(); }
        return;
      case 'scale': this.scaleClick(world); return;
      default: return;
    }
  }

  private addPoint(at: Vec2, px: Vec2): void {
    const ui = this.app.ui.getState();
    const pts = this.draft.points;
    const now = performance.now();
    const isDouble = now - this.lastTap < DOUBLE_TAP_MS && pts.length > 0 && dist(at, pts[pts.length - 1]) < this.tolMetres(14);
    this.lastTap = now;
    if (isDouble) { this.finishDraft(); return; }
    if (POLY_TOOLS.has(ui.tool) && pts.length >= 3 && dist(worldToCanvas(pts[0], this.view), px) < (this.coarse ? 22 : 12)) { this.closePolygon(pts); return; }
    if (pts.length && dist(at, pts[pts.length - 1]) < 1e-6) return;
    this.draft = { points: [...pts, at], rectFrom: null, rectTo: null };
    this.schedule();
  }

  private closePolygon(pts: Vec2[]): void {
    const tool = this.app.ui.getState().tool;
    const smooth = this.app.ui.getState().smoothShapes;
    this.draft = emptyDraft();
    const area = polygonArea(tool === 'bed' || tool === 'lawn' ? sampleShapePts(pts, smooth) : pts);
    this.areaNote = { at: centroidOf(pts), text: `${area.toFixed(1)} m²`, until: performance.now() + 2500 };
    this.commitPolygon(tool, pts);
  }

  private commitRect(tool: Tool, a: Vec2, b: Vec2): void {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    this.areaNote = { at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, text: `${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)} m`, until: performance.now() + 2500 };
    this.commitPolygon(tool, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], false);
  }

  /** `smooth` false = keep straight edges (a dragged rectangle); otherwise beds and lawns follow the Curves setting. */
  private commitPolygon(tool: Tool, pts: Vec2[], smooth?: boolean): void {
    switch (tool) {
      case 'boundary': this.app.setBoundary(pts); break;
      case 'house': this.app.setHouse(pts); break;
      case 'bed': this.app.addBed(pts, smooth); break;
      case 'lawn': this.app.addLawn(pts, smooth); break;
      case 'zone': this.app.addZone(pts); break;
      default: return;
    }
    this.app.setTool('select');
  }

  private scaleClick(world: Vec2): void {
    const ui = this.app.ui.getState();
    const d = ui.scaleDraft;
    if (!d || d.b) ui.set({ scaleDraft: { a: world, b: null } });
    else ui.set({ scaleDraft: { a: d.a, b: world } });
  }

  // ------------------------------------------------------------------ pinch and wheel
  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.drag = null; this.override = null;
    this.pinch = { dist: Math.max(1, dist(a, b)), view: this.view };
  }
  private updatePinch(): void {
    if (!this.pinch) return;
    const [a, b] = [...this.pointers.values()];
    const k = dist(a, b) / this.pinch.dist;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.app.view.getState().setView(zoomAt(this.pinch.view, mid, k));
  }
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.container.getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || Math.abs(e.deltaY) > 0) this.app.view.getState().setView(zoomAt(this.view, at, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
  }

  // ------------------------------------------------------------------ north arrow
  private northCentre(): Vec2 { return { x: this.stage.width() - 52, y: 52 }; }
  private northHit(px: Vec2): boolean { return dist(px, this.northCentre()) <= (this.coarse ? 36 : 26); }
  private setNorthFromPointer(px: Vec2, commit: boolean): void {
    const c = this.northCentre();
    const deg = (Math.atan2(px.x - c.x, c.y - px.y) * 180) / Math.PI; // clockwise from screen up
    const rounded = Math.round(((deg % 360) + 360) % 360);
    if (commit) {
      const p = this.app.project.getState().project;
      if (p && p.northDeg !== rounded) this.app.updateMeta({ northDeg: rounded });
      this.northPreview = null;
    } else this.northPreview = rounded;
    this.schedule();
  }
  private northPreview: number | null = null;

  // ------------------------------------------------------------------ drawing the scene
  render(): void {
    const p = this.current();
    const v = this.view;
    this.world.destroyChildren();
    this.mapLayer.destroyChildren();
    this.overlay.destroyChildren();
    this.world.position({ x: v.offsetX, y: v.offsetY });
    this.world.scale({ x: v.scale, y: -v.scale });
    if (!p) { this.stage.batchDraw(); return; }
    const ui = this.app.ui.getState();

    this.mapOn = !!p.map?.on;
    this.drawMap(p, v);
    this.drawUnderlay(p);
    if (ui.showGrid) this.drawGrid(v);
    for (const l of p.lawns) this.world.add(new Konva.Line({ points: flat(sampleShape(l.shape)), closed: true, fill: this.soft(GRASS_COLOUR[l.grass]), stroke: '#86ad68', strokeWidth: 1, strokeScaleEnabled: false }));
    for (const z of p.zones) this.world.add(new Konva.Line({ points: flat(sampleShape(z.shape)), closed: true, fill: `${COLOURS.zone}22`, stroke: COLOURS.zone, strokeWidth: 1.5, dash: [8, 6], strokeScaleEnabled: false }));
    for (const b of p.beds) {
      this.world.add(new Konva.Line({ points: flat(sampleShape(b.shape)), closed: true, fill: this.soft(MULCH_COLOUR[b.mulch]), stroke: EDGING_COLOUR[b.edging], strokeWidth: b.edging === 'none' ? 1 : b.raised ? 4 : 2.5, strokeScaleEnabled: false }));
    }
    for (const pa of p.paths) this.world.add(new Konva.Line({ points: flat(pa.points), stroke: PATH_COLOUR[pa.material], strokeWidth: pa.width, lineCap: 'butt', lineJoin: 'round', dash: pa.material === 'stepping_stones' ? [pa.width * 0.7, pa.width * 0.45] : undefined }));
    for (const sv of p.services) {
      // an easement is a wide translucent band; a pipe is a dashed line
      if (sv.kind === 'easement') this.world.add(new Konva.Line({ points: flat(sv.points), stroke: `${SERVICE_COLOUR.easement}26`, strokeWidth: sv.width, lineCap: 'butt', lineJoin: 'round' }));
      this.world.add(new Konva.Line({ points: flat(sv.points), stroke: SERVICE_COLOUR[sv.kind], strokeWidth: sv.kind === 'easement' ? 1.5 : 2.5, dash: [10, 6], strokeScaleEnabled: false, lineJoin: 'round' }));
    }
    for (const s of p.structures) {
      const corners = footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation });
      const round = s.kind === 'water_tank';
      if (round) this.world.add(new Konva.Circle({ x: s.position.x, y: s.position.y, radius: s.width / 2, fill: STRUCTURE_COLOUR[s.kind], stroke: '#555', strokeWidth: 1, strokeScaleEnabled: false }));
      else this.world.add(new Konva.Line({ points: flat(corners), closed: true, fill: `${STRUCTURE_COLOUR[s.kind]}${s.kind === 'pergola' || s.kind === 'trellis' ? 'aa' : 'ff'}`, stroke: '#555', strokeWidth: 1, strokeScaleEnabled: false, dash: s.kind === 'pergola' ? [6, 3] : undefined }));
      if (s.kind === 'gate') this.drawGateSwing(s);
    }
    if (p.house) this.world.add(new Konva.Line({ points: flat(p.house.vertices.map((x) => x.position)), closed: true, fill: COLOURS.house, stroke: COLOURS.houseStroke, strokeWidth: 2.5, strokeScaleEnabled: false }));
    if (p.house) this.drawFixtures(p);
    if (p.boundary) this.drawBoundary(p.boundary);
    if (ui.showSun) this.drawSunMap(ui);
    if (ui.showShadows) this.drawShadows(p, ui);
    this.drawPlants(p, ui.stage, ui.month);

    this.drawOverlay(p);
    this.stage.batchDraw();
  }

  /** Sun-hours grid for the committed garden. While an item is being dragged the last grid is kept, so dragging stays smooth. */
  private sunGrid(ui: ReturnType<App['ui']['getState']>): SunGrid | null {
    const committed = this.app.project.getState().project;
    const c = this.sunCache;
    if (c && (this.override || (c.project === committed && c.stage === ui.stage && c.month === ui.month))) return c.grid;
    const grid = committed ? computeSunHours(committed, { stage: ui.stage, month: ui.month }) : null;
    this.sunCache = { project: committed, stage: ui.stage, month: ui.month, grid };
    return grid;
  }

  /** The sun-hours map: each cell coloured full sun / part shade / shade by the thresholds in the settings. */
  private drawSunMap(ui: ReturnType<App['ui']['getState']>): void {
    const g = this.sunGrid(ui);
    if (!g) return;
    const classes = new Uint8Array(g.hours.length);
    for (let k = 0; k < g.hours.length; k++) {
      const h = g.hours[k];
      classes[k] = Number.isNaN(h) ? 0 : sunLevelForHours(h, ui.sunThresholds) === 'full_sun' ? 1 : sunLevelForHours(h, ui.sunThresholds) === 'part_shade' ? 2 : 3;
    }
    const fills = ['', ...(['full_sun', 'part_shade', 'shade'] as const).map((l) => { const [r, gg, b] = SUN_COLOURS[l]; return `rgba(${r},${gg},${b},0.55)`; })];
    this.world.add(new Konva.Shape({
      listening: false,
      sceneFunc: (ctx) => {
        const c = ctx._context;
        for (let cls = 1; cls <= 3; cls++) {
          c.fillStyle = fills[cls];
          c.beginPath();
          for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (classes[j * g.nx + i] === cls) c.rect(g.x0 + i * g.cell, g.y0 + j * g.cell, g.cell + 0.002, g.cell + 0.002);
          c.fill();
        }
      },
    }));
  }

  /** Shadows at the chosen time of day. Overlapping shadows darken, which is what several things in the way do. */
  private drawShadows(p: GardenProject, ui: ReturnType<App['ui']['getState']>): void {
    const loc = p.location;
    const sun = solarPosition(placeFor(loc, ui.month), ui.month, MID_MONTH_DAY, ui.hour);
    const shadows: Shadow[] = shadowsFor(obstaclesOf(p, ui.stage, ui.month), sunDirectionOnPlan(sun.azimuth, p.northDeg), sun.altitude);
    for (const s of shadows) {
      const fill = `rgba(25,35,60,${(0.28 * s.opacity).toFixed(3)})`;
      if (s.kind === 'poly') {
        this.world.add(new Konva.Line({ points: flat(s.pts), closed: true, fill, listening: false }));
      } else {
        this.world.add(new Konva.Shape({
          listening: false,
          sceneFunc: (ctx) => {
            const c = ctx._context;
            const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len = Math.hypot(dx, dy);
            c.fillStyle = fill;
            c.beginPath();
            c.arc(s.a.x, s.a.y, s.r, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(s.b.x, s.b.y, s.r, 0, Math.PI * 2);
            c.fill();
            if (len > 1e-6) {
              const nx = (-dy / len) * s.r, ny = (dx / len) * s.r;
              c.beginPath();
              c.moveTo(s.a.x + nx, s.a.y + ny); c.lineTo(s.b.x + nx, s.b.y + ny); c.lineTo(s.b.x - nx, s.b.y - ny); c.lineTo(s.a.x - nx, s.a.y - ny);
              c.closePath();
              c.fill();
            }
          },
        }));
      }
    }
  }

  /** Lawn and bed fills let the aerial photo show through when the map is on (so the plan can be traced over it). */
  private soft(colour: string): string { return this.mapOn && /^#[0-9a-f]{6}$/i.test(colour) ? `${colour}8c` : colour; }

  /** The satellite map: tiles drawn north-up, turned to the garden's north and scaled to metres, under everything else. */
  private drawMap(p: GardenProject, v: View): void {
    const m = p.map;
    if (!m?.on) return;
    const tiles = this.app.mapTiles;
    const st = tiles.peekStatus();
    if (!st) { void tiles.status().then(() => this.schedule()); return; }
    if (!st.enabled) return;
    const anchor = this.mapOverride ?? { lat: m.lat, lng: m.lng };
    const z = chooseZoom(v.scale, anchor.lat, st.maxZoom);
    const list = visibleTiles(anchor, p.northDeg, v, this.stage.width(), this.stage.height(), z);
    const t = groupTransform(v, p.northDeg, z, anchor.lat);
    const g = new Konva.Group({ x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scale, scaleY: t.scale, opacity: m.opacity });
    for (const q of list) {
      const img = tiles.tile(q.z, q.x, q.y, () => this.schedule());
      // a hair of overlap hides the seams that fractional scaling would otherwise show between tiles
      if (img) g.add(new Konva.Image({ image: img as CanvasImageSource as never, x: q.px, y: q.py, width: TILE + 0.6, height: TILE + 0.6 }));
    }
    this.mapLayer.add(g);
  }

  private drawUnderlay(p: GardenProject): void {
    const u = p.underlay;
    if (!u) return;
    if (!this.underlayImg || this.underlayImg.src !== u.imageId) {
      // the picture is stored apart from the design: fetch it once per reference, then draw it
      const image = new Image();
      image.onload = () => this.schedule();
      const mine = { src: u.imageId, image };
      this.underlayImg = mine;
      this.app.images.url(u.imageId).then((url) => { if (this.underlayImg === mine) image.src = url; }, () => { this.app.notify('The tracing picture could not be loaded.', 'warn'); });
    }
    const img = this.underlayImg.image;
    if (!img.complete || !img.naturalWidth) return;
    this.world.add(new Konva.Image({
      image: img, x: u.origin.x, y: u.origin.y + u.heightPx * u.metresPerPixel, width: u.widthPx, height: u.heightPx,
      scaleX: u.metresPerPixel, scaleY: -u.metresPerPixel, opacity: u.opacity,
    }));
  }

  private drawGrid(v: View): void {
    const w = this.stage.width(), h = this.stage.height();
    const a = canvasToWorld({ x: 0, y: h }, v), b = canvasToWorld({ x: w, y: 0 }, v);
    let step = this.app.ui.getState().grid;
    while (step * v.scale < 14) step *= 2;
    const major = step * 5;
    const x0 = Math.floor(a.x / step) * step, y0 = Math.floor(a.y / step) * step;
    if ((b.x - a.x) / step > 400) return;
    for (let x = x0; x <= b.x; x += step) this.world.add(new Konva.Line({ points: [x, a.y, x, b.y], stroke: Math.abs(x / major - Math.round(x / major)) < 1e-6 ? COLOURS.gridMajor : COLOURS.gridMinor, strokeWidth: 1, strokeScaleEnabled: false }));
    for (let y = y0; y <= b.y; y += step) this.world.add(new Konva.Line({ points: [a.x, y, b.x, y], stroke: Math.abs(y / major - Math.round(y / major)) < 1e-6 ? COLOURS.gridMajor : COLOURS.gridMinor, strokeWidth: 1, strokeScaleEnabled: false }));
  }

  private drawBoundary(b: Boundary): void {
    const n = b.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = b.vertices[i].position, c = b.vertices[(i + 1) % n].position;
      const seg = b.segments[i];
      const fence = seg?.fence ?? 'open';
      this.world.add(new Konva.Line({
        points: [a.x, a.y, c.x, c.y], stroke: FENCE_COLOUR[fence], strokeWidth: fence === 'open' ? 1.5 : fence === 'hedge' ? 7 : 4,
        dash: fence === 'open' ? [8, 6] : undefined, strokeScaleEnabled: false, lineCap: 'round',
      }));
    }
  }

  private drawFixtures(p: GardenProject): void {
    const h = p.house; if (!h) return;
    const n = h.vertices.length;
    for (const f of h.fixtures) {
      const a = h.vertices[f.edge % n].position, b = h.vertices[(f.edge + 1) % n].position;
      const len = dist(a, b) || 1;
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const c = { x: a.x + ux * f.offset, y: a.y + uy * f.offset };
      this.world.add(new Konva.Line({ points: [c.x - ux * f.width / 2, c.y - uy * f.width / 2, c.x + ux * f.width / 2, c.y + uy * f.width / 2], stroke: f.type === 'door' ? '#8a5a2a' : '#5aa0d0', strokeWidth: 5, strokeScaleEnabled: false }));
    }
  }

  private drawGateSwing(s: GardenProject['structures'][number]): void {
    const dir = s.swing ?? 1;
    const hinge = { x: s.position.x - (s.width / 2) * Math.cos(s.rotation), y: s.position.y - (s.width / 2) * Math.sin(s.rotation) };
    this.world.add(new Konva.Arc({
      x: hinge.x, y: hinge.y, innerRadius: 0, outerRadius: s.width, angle: 90,
      rotation: (s.rotation * 180) / Math.PI + (dir > 0 ? 0 : -90), fill: '#8a6a4415', stroke: '#8a6a44', strokeWidth: 1, dash: [4, 4], strokeScaleEnabled: false,
    }));
  }

  private drawPlants(p: GardenProject, stage: ReturnType<App['ui']['getState']>['stage'], month: number): void {
    for (const inst of p.plants) {
      const rec = plantById(inst.plantId);
      if (!rec) continue;
      const size = plantSizeAt(rec, stage);
      const r = Math.max(size.canopyRadius, 0.05);
      const leaf = leafFactor(rec, month);
      const colour = canopyColour(rec, month);
      const tree = rec.type === 'tree' || rec.type === 'palm';
      this.world.add(new Konva.Circle({
        x: inst.position.x, y: inst.position.y, radius: r, fill: colour, opacity: 0.25 + 0.6 * leaf,
        stroke: '#2f4a28', strokeWidth: 1, strokeScaleEnabled: false,
      }));
      if (isFlowering(rec, month) && rec.flowerColours[0]) {
        this.world.add(new Konva.Circle({ x: inst.position.x, y: inst.position.y, radius: r * 0.82, stroke: rec.flowerColours[0], strokeWidth: Math.max(2, 3), strokeScaleEnabled: false, opacity: 0.95 }));
      }
      if (tree) this.world.add(new Konva.Circle({ x: inst.position.x, y: inst.position.y, radius: Math.min(0.12 + size.height * 0.012, 0.3), fill: '#6b4a2e' }));
    }
  }

  // ------------------------------------------------------------------ overlay (pixel space)
  private drawOverlay(p: GardenProject): void {
    const v = this.view;
    const ui = this.app.ui.getState();
    const L = this.overlay;
    const text = (t: string, at: Vec2, o: Partial<Konva.TextConfig> = {}): void => {
      L.add(new Konva.Text({ text: t, x: at.x, y: at.y, fontSize: 11, fontFamily: 'system-ui, sans-serif', fill: COLOURS.text, shadowColor: '#ffffff', shadowBlur: 3, shadowOpacity: 0.9, ...o }));
    };

    // names
    if (v.scale > 12) {
      const label = (name: string, c: Vec2): void => { const q = worldToCanvas(c, v); text(name, { x: q.x - name.length * 2.8, y: q.y - 6 }, { opacity: 0.8 }); };
      for (const b of p.beds) label(b.name, shapeCentroid(b.shape));
      for (const l of p.lawns) label(l.name, shapeCentroid(l.shape));
      for (const z of p.zones) label(z.name, shapeCentroid(z.shape));
      for (const s of p.structures) label(s.name, s.position);
      for (const sv of p.services) if (sv.points.length) label(sv.name, sv.points[Math.floor(sv.points.length / 2)]);
      if (p.house) label('House', centroidOf(p.house.vertices.map((x) => x.position)));
    }

    // selection
    const sel = ui.selection;
    if (sel && ui.tool === 'select') this.drawSelection(p, sel, v);
    this.drawIssueMarkers(p, v);

    // hover info for plants
    if (this.cursorPx && !this.drag && ui.tool === 'select') {
      const hit = pick(p, this.toWorld(this.cursorPx), this.tolMetres(8), ui.stage);
      if (hit?.kind === 'plant') {
        const inst = p.plants.find((x) => x.id === hit.id);
        const rec = inst && plantById(inst.plantId);
        if (inst && rec) {
          const s = plantSizeAt(rec, ui.stage);
          const q = worldToCanvas(inst.position, v);
          const line1 = plantLabel(rec), line2 = `${botanicalLabel(rec)}`, line3 = `${s.height.toFixed(1)} m high, ${s.spread.toFixed(1)} m wide`;
          const w = Math.max(line1.length, line2.length, line3.length) * 6 + 16;
          L.add(new Konva.Rect({ x: q.x + 12, y: q.y - 50, width: w, height: 44, fill: '#1A1A1A', cornerRadius: 6, opacity: 0.92 }));
          text(line1, { x: q.x + 20, y: q.y - 45 }, { fill: '#fff', shadowBlur: 0, fontStyle: 'bold' });
          text(line2, { x: q.x + 20, y: q.y - 32 }, { fill: '#d8d8d0', shadowBlur: 0, fontStyle: 'italic', fontSize: 10 });
          text(line3, { x: q.x + 20, y: q.y - 19 }, { fill: '#fff', shadowBlur: 0, fontSize: 10 });
        }
      }
    }

    // hours of sun under the cursor (sun map on)
    if (ui.showSun && this.cursorPx && !this.drag && ui.tool === 'select') {
      const g = this.sunCache?.grid ?? null;
      const h = g ? hoursAt(g, this.toWorld(this.cursorPx)) : null;
      if (h !== null) {
        const level = sunLevelForHours(h, ui.sunThresholds);
        const label = `${h.toFixed(1)} h of sun · ${level === 'full_sun' ? 'full sun' : level === 'part_shade' ? 'part shade' : 'shade'}`;
        L.add(new Konva.Rect({ x: this.cursorPx.x + 14, y: this.cursorPx.y + 14, width: label.length * 6.2 + 14, height: 22, fill: '#1A1A1A', cornerRadius: 11, opacity: 0.9 }));
        text(label, { x: this.cursorPx.x + 21, y: this.cursorPx.y + 19 }, { fill: '#fff', shadowBlur: 0, fontSize: 11 });
      }
    }

    this.drawDraft(p, ui, v, text);

    // scale picture
    if (ui.scaleDraft) {
      const a = worldToCanvas(ui.scaleDraft.a, v);
      L.add(new Konva.Circle({ x: a.x, y: a.y, radius: 5, fill: COLOURS.primary, stroke: '#fff', strokeWidth: 2 }));
      const bw = ui.scaleDraft.b ?? (this.cursorPx ? this.toWorld(this.cursorPx) : null);
      if (bw) {
        const b = worldToCanvas(bw, v);
        L.add(new Konva.Line({ points: [a.x, a.y, b.x, b.y], stroke: COLOURS.primary, strokeWidth: 2, dash: [6, 4] }));
        if (ui.scaleDraft.b) L.add(new Konva.Circle({ x: b.x, y: b.y, radius: 5, fill: COLOURS.primary, stroke: '#fff', strokeWidth: 2 }));
      }
    }

    // plant placement ghost
    if (ui.tool === 'plant' && ui.placingPlantId && this.cursorPx) {
      const rec = plantById(ui.placingPlantId);
      const at = this.snapped?.point ?? this.toWorld(this.cursorPx);
      if (rec) {
        const q = worldToCanvas(at, v);
        L.add(new Konva.Circle({ x: q.x, y: q.y, radius: Math.max(plantSizeAt(rec, ui.stage).canopyRadius * v.scale, 5), fill: canopyColour(rec, ui.month), opacity: 0.45, stroke: COLOURS.primary, strokeWidth: 1.5, dash: [4, 3] }));
      }
    }
    if (ui.tool === 'structure' && this.cursorPx) {
      const at = this.snapped?.point ?? this.toWorld(this.cursorPx);
      const d = structureGhost(ui.structureKind, at);
      L.add(new Konva.Line({ points: pxPts(d, v), closed: true, fill: `${COLOURS.primary}33`, stroke: COLOURS.primary, strokeWidth: 1.5, dash: [4, 3] }));
    }

    if (this.snapped && this.cursorPx && ui.tool !== 'select') {
      const q = worldToCanvas(this.snapped.point, v);
      L.add(new Konva.Rect({ x: q.x - 4, y: q.y - 4, width: 8, height: 8, stroke: this.snapped.kind === 'grid' ? '#9a9a90' : COLOURS.primary, strokeWidth: 1.5, fill: '#fff' }));
    }
    if (this.areaNote && performance.now() < this.areaNote.until) {
      const q = worldToCanvas(this.areaNote.at, v);
      L.add(new Konva.Rect({ x: q.x - 36, y: q.y - 11, width: 72, height: 22, fill: '#1A1A1A', cornerRadius: 11, opacity: 0.9 }));
      text(this.areaNote.text, { x: q.x - 32, y: q.y - 6 }, { fill: '#fff', shadowBlur: 0, width: 64, align: 'center' });
      setTimeout(() => this.schedule(), Math.max(0, this.areaNote.until - performance.now()) + 20);
    }

    this.drawScaleBar(v, text);
    this.drawNorth(p, text);
  }

  /** Rings and outlines on what the checks found: red for something to fix, amber for something to check. */
  private drawIssueMarkers(p: GardenProject, v: View): void {
    const issues = this.app.checks.getState().issues.filter((i) => i.severity !== 'info');
    if (!issues.length) return;
    const L = this.overlay;
    const stage = this.app.ui.getState().stage;
    const colour = (s: string): string => (s === 'error' ? COLOURS.error : COLOURS.warn);
    const plantSeverity = new Map<string, string>();
    for (const i of issues) {
      if (i.type === 'gate_swing') {
        const gate = p.structures.find((s) => s.id === i.items[0]?.id);
        if (gate) L.add(new Konva.Line({ points: pxPts(gateSwingSector(gate.position, gate.width, gate.rotation, gate.swing ?? 1), v), closed: true, fill: `${colour(i.severity)}33`, stroke: colour(i.severity), strokeWidth: 1.5, dash: [4, 3] }));
        continue;
      }
      for (const it of i.items) {
        if (it.kind === 'plant') { if (plantSeverity.get(it.id) !== 'error') plantSeverity.set(it.id, i.severity); continue; }
        if (it.kind === 'path') { const pa = p.paths.find((x) => x.id === it.id); if (pa) for (const q of pathSegments(pa.points, pa.width)) L.add(new Konva.Line({ points: pxPts(q, v), closed: true, stroke: colour(i.severity), strokeWidth: 2, dash: [5, 3] })); }
        else if (it.kind === 'lawn') { const l = p.lawns.find((x) => x.id === it.id); if (l) L.add(new Konva.Line({ points: pxPts(sampleShape(l.shape), v), closed: true, stroke: colour(i.severity), strokeWidth: 2.5, dash: [8, 5] })); }
      }
    }
    let drawn = 0;
    for (const [id, sev] of plantSeverity) {
      if (drawn++ > 300) break;
      const inst = p.plants.find((x) => x.id === id);
      if (!inst) continue;
      const rec = plantById(inst.plantId);
      const q = worldToCanvas(inst.position, v);
      const r = Math.max((rec ? plantSizeAt(rec, stage).canopyRadius : 0.3) * v.scale + 4, 10);
      L.add(new Konva.Circle({ x: q.x, y: q.y, radius: r, stroke: colour(sev), strokeWidth: 2.5, dash: [4, 3] }));
    }
  }

  private drawSelection(p: GardenProject, sel: Selection, v: View): void {
    const L = this.overlay;
    const item = findItem(p, sel);
    if (!item) return;
    const hl = (pts: Vec2[], closed = true): void => { L.add(new Konva.Line({ points: pxPts(pts, v), closed, stroke: COLOURS.select, strokeWidth: 2.5, dash: [7, 4] })); };
    switch (sel.kind) {
      case 'boundary': {
        const b = item as Boundary;
        hl(b.vertices.map((x) => x.position));
        const edge = this.app.ui.getState().boundaryEdge;
        if (edge !== null && b.vertices[edge]) {
          const a = b.vertices[edge].position, c = b.vertices[(edge + 1) % b.vertices.length].position;
          const pa = worldToCanvas(a, v), pc = worldToCanvas(c, v);
          L.add(new Konva.Line({ points: [pa.x, pa.y, pc.x, pc.y], stroke: COLOURS.select, strokeWidth: 6, opacity: 0.55 }));
        }
        break;
      }
      case 'house': hl((item as { vertices: Array<{ position: Vec2 }> }).vertices.map((x) => x.position)); break;
      case 'zone': case 'bed': case 'lawn': hl(sampleShape((item as { shape: { points: Vec2[]; smooth: boolean } }).shape)); break;
      case 'path': case 'service': {
        const pa = item as { points: Vec2[]; width: number };
        for (const q of pathSegments(pa.points, Math.max(pa.width, 0.3))) hl(q);
        break;
      }
      case 'structure': {
        const s = item as { position: Vec2; width: number; length: number; rotation: number };
        hl(footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation }));
        break;
      }
      case 'plant': {
        const inst = item as { position: Vec2; plantId: string };
        const rec = plantById(inst.plantId);
        const q = worldToCanvas(inst.position, v);
        L.add(new Konva.Circle({ x: q.x, y: q.y, radius: Math.max((rec ? plantSizeAt(rec, this.app.ui.getState().stage).canopyRadius : 0.3) * v.scale + 3, 9), stroke: COLOURS.select, strokeWidth: 2.5, dash: [7, 4] }));
        break;
      }
    }
    const n = vertexCount(item, sel.kind);
    for (let i = 0; i < n; i++) {
      const q = worldToCanvas(vertexAt(item, sel.kind, i), v);
      const r = this.coarse ? 9 : 6;
      L.add(new Konva.Circle({ x: q.x, y: q.y, radius: r, fill: COLOURS.handleFill, stroke: COLOURS.select, strokeWidth: 2 }));
    }
  }

  private drawDraft(_p: GardenProject, ui: ReturnType<App['ui']['getState']>, v: View, text: (t: string, at: Vec2, o?: Partial<Konva.TextConfig>) => void): void {
    const L = this.overlay;
    const d = this.draft;
    if (d.rectFrom && d.rectTo) {
      const a = d.rectFrom.world, b = d.rectTo;
      L.add(new Konva.Line({ points: pxPts([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }], v), closed: true, stroke: COLOURS.primary, strokeWidth: 2, fill: `${COLOURS.primary}22`, dash: [6, 4] }));
      const mid = worldToCanvas({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v);
      text(`${Math.abs(b.x - a.x).toFixed(2)} × ${Math.abs(b.y - a.y).toFixed(2)} m`, { x: mid.x - 36, y: mid.y - 6 }, { fontStyle: 'bold' });
      return;
    }
    if (!d.points.length) return;
    const cursorW = this.snapped?.point ?? (this.cursorPx ? this.toWorld(this.cursorPx) : null);
    const pts = cursorW ? [...d.points, cursorW] : d.points;
    const closed = POLY_TOOLS.has(ui.tool) && d.points.length >= 3;
    L.add(new Konva.Line({ points: pxPts(ui.tool === 'path' || ui.tool === 'service' ? pts : (ui.smoothShapes && (ui.tool === 'bed' || ui.tool === 'lawn') && d.points.length >= 3 ? sampleShape({ points: pts, smooth: true }) : pts), v), stroke: COLOURS.primary, strokeWidth: 2.5, closed: false, fill: closed ? `${COLOURS.primary}18` : undefined, lineJoin: 'round' }));
    for (let i = 0; i < d.points.length; i++) {
      const q = worldToCanvas(d.points[i], v);
      L.add(new Konva.Circle({ x: q.x, y: q.y, radius: i === 0 && closed ? 8 : 4.5, fill: i === 0 ? COLOURS.primary : '#fff', stroke: COLOURS.primary, strokeWidth: 2 }));
    }
    // edge lengths
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = dist(a, b);
      if (len < 0.05) continue;
      const m = worldToCanvas({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v);
      text(`${len.toFixed(2)} m`, { x: m.x - 18, y: m.y - 14 }, { fill: COLOURS.primary, fontStyle: 'bold' });
    }
    if ((ui.tool === 'path' || ui.tool === 'service') && pts.length > 1) { const q = worldToCanvas(pts[pts.length - 1], v); text(`${polylineLength(pts).toFixed(1)} m`, { x: q.x + 10, y: q.y + 8 }, { fill: COLOURS.muted }); }
  }

  private drawScaleBar(v: View, text: (t: string, at: Vec2, o?: Partial<Konva.TextConfig>) => void): void {
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const target = 110 / v.scale;
    const len = nice.find((n) => n >= target) ?? 200;
    const x = 18, y = this.stage.height() - 26, w = len * v.scale;
    this.overlay.add(new Konva.Line({ points: [x, y - 5, x, y, x + w, y, x + w, y - 5], stroke: COLOURS.text, strokeWidth: 2 }));
    text(len >= 1 ? `${len} m` : `${len * 100} cm`, { x: x + 4, y: y - 18 }, { fontStyle: 'bold' });
  }

  private drawNorth(p: GardenProject, text: (t: string, at: Vec2, o?: Partial<Konva.TextConfig>) => void): void {
    const c = this.northCentre();
    const deg = this.northPreview ?? p.northDeg;
    const g = new Konva.Group({ x: c.x, y: c.y, rotation: deg });
    g.add(new Konva.Circle({ radius: 24, fill: '#ffffffd0', stroke: '#c9c9bf', strokeWidth: 1 }));
    g.add(new Konva.Line({ points: [0, -19, 7, 8, 0, 3, -7, 8], closed: true, fill: COLOURS.text }));
    this.overlay.add(g);
    const rad = (deg * Math.PI) / 180; // the N sits just outside the circle, in the direction north points
    text('N', { x: c.x + Math.sin(rad) * 33 - 4, y: c.y - Math.cos(rad) * 33 - 6 }, { fontStyle: 'bold', fontSize: 12 });
    // where the sun is right now (the time-of-day slider): a yellow dot on the compass, at the sun's bearing on the plan
    const ui = this.app.ui.getState();
    const sun = solarPosition(placeFor(p.location, ui.month), ui.month, MID_MONTH_DAY, ui.hour);
    if (sun.altitude > 0) {
      const b = ((sun.azimuth + deg) * Math.PI) / 180;
      const r = 24 * (1 - Math.min(sun.altitude, 85) / 130);
      this.overlay.add(new Konva.Circle({ x: c.x + Math.sin(b) * r, y: c.y - Math.cos(b) * r, radius: 5, fill: '#f5b820', stroke: '#b4790a', strokeWidth: 1 }));
    }
  }
}

// ---------------------------------------------------------------------- helpers

const emptyDraft = (): Draft => ({ points: [], rectFrom: null, rectTo: null });

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

const centroidOf = (pts: Vec2[]): Vec2 => ({ x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length });
const sampleShapePts = (pts: Vec2[], smooth: boolean): Vec2[] => sampleShape({ points: pts, smooth });

function anchorOf(item: unknown, kind: ItemKind): Vec2 | null {
  switch (kind) {
    case 'plant': case 'structure': return (item as { position: Vec2 }).position;
    case 'boundary': case 'house': return (item as { vertices: Array<{ position: Vec2 }> }).vertices[0]?.position ?? null;
    case 'zone': case 'bed': case 'lawn': return (item as { shape: { points: Vec2[] } }).shape.points[0] ?? null;
    case 'path': case 'service': return (item as { points: Vec2[] }).points[0] ?? null;
  }
}

function structureGhost(kind: string, at: Vec2): Vec2[] {
  const dims = ({ pergola: [3.6, 3.6], shed: [2.4, 1.8], deck: [4, 3], raised_bed: [2.4, 1.2], water_tank: [2.2, 2.2], clothesline: [2.2, 2.2], pool: [6, 3], retaining_wall: [4, 0.3], trellis: [1.8, 0.1], gate: [0.9, 0.1] } as Record<string, [number, number]>)[kind] ?? [1, 1];
  return footprintCorners({ position: at, width: dims[0], length: Math.max(dims[1], 0.1), rotation: 0 });
}

/** The project with one item replaced (a drag in progress). */
export function withOverride(p: GardenProject, sel: Selection, item: unknown): GardenProject {
  const swap = <T extends { id: string }>(list: T[]): T[] => list.map((x) => (x.id === sel.id ? (item as T) : x));
  switch (sel.kind) {
    case 'boundary': return { ...p, boundary: item as GardenProject['boundary'] };
    case 'house': return { ...p, house: item as GardenProject['house'] };
    case 'zone': return { ...p, zones: swap(p.zones) };
    case 'bed': return { ...p, beds: swap(p.beds) };
    case 'path': return { ...p, paths: swap(p.paths) };
    case 'service': return { ...p, services: swap(p.services) };
    case 'lawn': return { ...p, lawns: swap(p.lawns) };
    case 'structure': return { ...p, structures: swap(p.structures) };
    case 'plant': return { ...p, plants: swap(p.plants) };
  }
}

/** The project without one item (so a drag does not snap to itself). */
export function withoutItem(p: GardenProject, sel: Selection): GardenProject {
  const drop = <T extends { id: string }>(list: T[]): T[] => list.filter((x) => x.id !== sel.id);
  switch (sel.kind) {
    case 'boundary': return { ...p, boundary: null };
    case 'house': return { ...p, house: null };
    case 'zone': return { ...p, zones: drop(p.zones) };
    case 'bed': return { ...p, beds: drop(p.beds) };
    case 'path': return { ...p, paths: drop(p.paths) };
    case 'service': return { ...p, services: drop(p.services) };
    case 'lawn': return { ...p, lawns: drop(p.lawns) };
    case 'structure': return { ...p, structures: drop(p.structures) };
    case 'plant': return { ...p, plants: drop(p.plants) };
  }
}

