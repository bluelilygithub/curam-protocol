import { quantizeVec2 } from '../engine/coordinates';
import { add, dist, scale } from '../engine/geometry';
import { polygonProblemEdges, validatePolygon } from '../engine/polygons';
import {
  proposeCreateRoom, type PipelineResult,
} from '../engine/pipeline';
import { pickVertexId, pickWallId, vertexPickRadius } from '../engine/selection';
import { DEFAULT_SNAP_DISTANCE, rankSnapCandidates } from '../engine/snapping';
import {
  impactOf, moveVertex, stickVertex, vertexSnapCandidates,
} from '../engine/wallEdit';
import { proposeDeleteVertex, proposeInsertVertex, proposeMoveVertex } from '../engine/wallPipeline';
import type { Project, Room, Vec2 } from '../engine/types';
import { ROOM_ID } from '../state/feedbackBus';
import { roomFromPoints } from '../state/projectFactory';
import { DRAG_SLOP_PX, ARROW_SMALL } from './constants';
import type { PointerEv, Ports } from './interaction';
import { LABELS, polygonErrorText } from './statusMessages';

export type WallToolState = 'idle' | 'vertex_press' | 'wall_press' | 'moving_vertex' | 'drawing_room';

/** A second click on the same wall within this window (and a few pixels) inserts a corner (B1). */
export const DOUBLE_CLICK_MS = 450;
export const DOUBLE_CLICK_PX = 6;

export interface WallToolHost {
  p: Ports;
  commit(result: PipelineResult, label: string): boolean;
}

type S =
  | { t: 'idle' }
  | { t: 'vertex_press'; id: string; start: PointerEv }
  | { t: 'wall_press'; id: string; start: PointerEv }
  | { t: 'moving_vertex'; id: string; origin: Vec2; startWorld: Vec2; last: Vec2 };

/**
 * The WALL_EDIT tool (Spec §5, Appendix B B1/B7/B8, C14): select corners and walls, drag a corner (live polygon validation, the
 * corner sticks at the last valid spot, impact preview), insert a corner by double-click or long-press, delete a corner, and
 * draw a room corner by corner. Per-frame state goes through the feedback bus only (A12); one drag = one `EditWall`.
 */
export class WallTool {
  private s: S = { t: 'idle' };
  private draw: Vec2[] | null = null;
  private drawCursor: Vec2 | null = null;
  private lastWallClick: { id: string; time: number; screen: Vec2 } | null = null;

  constructor(private readonly h: WallToolHost) {}

  get stateName(): WallToolState {
    if (this.draw) return 'drawing_room';
    return this.s.t === 'idle' ? 'idle' : this.s.t;
  }
  /** True while the tool holds a gesture that Escape / a tool switch must abandon. */
  get busy(): boolean { return this.s.t !== 'idle' || !!this.draw; }

  private get project(): Project | null { return this.h.p.project.getState().project; }
  private get room(): Room | undefined { return this.project?.rooms[0]; }

  // ------------------------------------------------------------------ pointer

  pointerDown(e: PointerEv): void {
    const room = this.room;
    if (!this.project) return;
    if (!room) { this.drawClick(e); return; }
    const ui = this.h.p.ui.getState();
    const vertex = pickVertexId(room, e.world, e.mpp);
    if (vertex) {
      ui.select([{ kind: 'vertex', id: vertex }]);
      this.s = { t: 'vertex_press', id: vertex, start: e };
      this.lastWallClick = null;
      return;
    }
    const wall = pickWallId(room, e.world, e.mpp);
    if (wall) {
      const now = this.h.p.now();
      const prev = this.lastWallClick;
      if (prev && prev.id === wall && now - prev.time <= DOUBLE_CLICK_MS && dist(prev.screen, e.screen) <= DOUBLE_CLICK_PX) {
        this.lastWallClick = null;
        this.insertCorner(wall, e.world);
        return;
      }
      this.lastWallClick = { id: wall, time: now, screen: e.screen };
      ui.select([{ kind: 'wall', id: wall }]);
      this.s = { t: 'wall_press', id: wall, start: e };
      return;
    }
    this.lastWallClick = null;
    ui.clearSelection();
  }

  pointerMove(e: PointerEv): void {
    if (this.draw) { this.drawMove(e); return; }
    const s = this.s;
    if (s.t === 'vertex_press' && dist(s.start.screen, e.screen) > DRAG_SLOP_PX) {
      const room = this.room;
      const v = room?.vertices.find((x) => x.id === s.id);
      if (!room || !v) { this.s = { t: 'idle' }; return; }
      this.s = { t: 'moving_vertex', id: s.id, origin: { ...v.position }, startWorld: s.start.world, last: { ...v.position } };
      this.h.p.bus.set({ hiddenIds: [ROOM_ID] });
      this.updateDrag(e);
      return;
    }
    if (s.t === 'moving_vertex') this.updateDrag(e);
  }

  pointerUp(_e: PointerEv): void {
    const s = this.s;
    if (s.t === 'moving_vertex') {
      this.s = { t: 'idle' };
      const project = this.project;
      if (project) this.h.commit(proposeMoveVertex(project, s.id, s.last), LABELS.corner.move);
      this.h.p.bus.reset();
      return;
    }
    this.s = { t: 'idle' };
  }

  /** Touch: a long press on a wall inserts a corner there (B1). The host calls this from a timer. */
  longPress(): void {
    const s = this.s;
    if (s.t !== 'wall_press') return;
    this.s = { t: 'idle' };
    this.insertCorner(s.id, s.start.world);
  }

  // ------------------------------------------------------------------ corner drag

  private updateDrag(e: PointerEv): void {
    const s = this.s;
    const room = this.room;
    const project = this.project;
    if (s.t !== 'moving_vertex' || !room || !project) return;
    const ui = this.h.p.ui.getState();
    const raw = quantizeVec2({ x: s.origin.x + (e.world.x - s.startWorld.x), y: s.origin.y + (e.world.y - s.startWorld.y) });
    const valid = (p: Vec2): boolean => {
      const g = moveVertex(room, s.id, p);
      return !!g && validatePolygon(g.vertices).ok;
    };
    const ranked = rankSnapCandidates(vertexSnapCandidates(room, s.id, raw, { grid: ui.grid, snapDistance: DEFAULT_SNAP_DISTANCE }), DEFAULT_SNAP_DISTANCE);
    let pos: Vec2 | null = null;
    let snap = null as (typeof ranked)[number] | null;
    for (const c of ranked) {
      const q = quantizeVec2(c.position);
      if (valid(q)) { pos = q; snap = c; break; }
    }
    let stuck = false;
    if (!pos) {
      if (valid(raw)) pos = raw;
      else { pos = stickVertex(room, s.id, s.last, raw); stuck = true; }
    }
    const geometry = moveVertex(room, s.id, pos)!;
    const bad = stuck ? polygonProblemEdges(moveVertex(room, s.id, raw)!.vertices) : [];
    const impact = impactOf(project, room.id, geometry);
    s.last = pos;
    this.h.p.bus.set({ roomPreview: { ...geometry, badEdges: bad }, impact: impact.newlyInvalid, snap, dims: [] });
    if (stuck) this.h.p.bus.setMessage({ text: 'Walls cannot cross or overlap, so the corner stops here', severity: 'hard', violations: [] });
    else if (impact.newlyInvalid.length) {
      const n = impact.newlyInvalid.length;
      this.h.p.bus.setMessage({ text: `${n} ${n === 1 ? 'object' : 'objects'} will need attention`, severity: 'soft', violations: [] });
    } else this.h.p.bus.setMessage(null);
  }

  // ------------------------------------------------------------------ insert / delete / nudge

  private insertCorner(wallId: string, at: Vec2): void {
    const project = this.project;
    if (!project) return;
    const ids = { vertexId: this.h.p.newId(), segmentId: this.h.p.newId() };
    if (this.h.commit(proposeInsertVertex(project, wallId, at, ids), LABELS.corner.add)) {
      this.h.p.ui.getState().select([{ kind: 'vertex', id: ids.vertexId }]);
    }
  }

  // ------------------------------------------------------------------ keyboard

  keyDown(k: { key: string; shift: boolean; ctrl: boolean }): boolean {
    if (this.draw) {
      if (k.key === 'Enter') { this.closeDrawing(); return true; }
      if (k.key === 'Backspace') {
        this.draw.pop();
        if (this.draw.length === 0) this.draw = null;
        this.publishDrawing();
        return true;
      }
      return false;
    }
    const project = this.project;
    const room = this.room;
    if (!project || !room || this.s.t !== 'idle') return false;
    const sel = this.h.p.ui.getState().selection;
    const vertex = sel.length === 1 && sel[0].kind === 'vertex' ? sel[0].id : null;
    if (!vertex) return false;
    if (k.key === 'Delete' || k.key === 'Backspace') {
      if (this.h.commit(proposeDeleteVertex(project, vertex), LABELS.corner.delete)) this.h.p.ui.getState().clearSelection();
      return true;
    }
    const arrow: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 } };
    if (arrow[k.key] && !k.ctrl) {
      const v = room.vertices.find((x) => x.id === vertex);
      if (!v) return false;
      const step = k.shift ? this.h.p.ui.getState().grid : ARROW_SMALL;
      this.h.commit(proposeMoveVertex(project, vertex, add(v.position, scale(arrow[k.key], step))), LABELS.corner.move);
      return true;
    }
    return false;
  }

  /** B7: MOVING_VERTEX reverts; drawing is abandoned; otherwise Escape deselects (the tool stays). Returns true if it did something. */
  cancel(escape: boolean): boolean {
    if (this.draw) {
      this.draw = null;
      this.drawCursor = null;
      this.h.p.bus.set({ drawing: null });
      return true;
    }
    if (this.s.t === 'moving_vertex') {
      this.s = { t: 'idle' };
      this.h.p.bus.reset();
      return true;
    }
    if (this.s.t !== 'idle') { this.s = { t: 'idle' }; return true; }
    if (escape) {
      const ui = this.h.p.ui.getState();
      if (ui.selection.length) { ui.clearSelection(); return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------ draw a room (C14)

  private snapDraw(p: Vec2, mpp: number): Vec2 {
    const grid = this.h.p.ui.getState().grid;
    let best: Vec2 = quantizeVec2({ x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid });
    if (dist(best, p) > DEFAULT_SNAP_DISTANCE) best = quantizeVec2(p);
    for (const q of this.draw ?? []) {
      if (dist(q, p) <= Math.max(DEFAULT_SNAP_DISTANCE / 2, vertexPickRadius(mpp)) && dist(q, p) < dist(best, p) + 1e-9) best = { ...q };
    }
    return best;
  }

  private nearFirst(p: Vec2, mpp: number): boolean {
    return !!this.draw && this.draw.length >= 3 && dist(this.draw[0], p) <= vertexPickRadius(mpp);
  }

  private drawClick(e: PointerEv): void {
    if (this.nearFirst(e.world, e.mpp)) { this.closeDrawing(); return; }
    const p = this.snapDraw(e.world, e.mpp);
    const pts = this.draw ?? [];
    if (pts.length && dist(pts[pts.length - 1], p) < 0.001) return; // a double click does not add the same corner twice
    this.draw = [...pts, p];
    this.drawCursor = p;
    this.publishDrawing(e.mpp);
  }

  private drawMove(e: PointerEv): void {
    this.drawCursor = this.nearFirst(e.world, e.mpp) ? { ...this.draw![0] } : this.snapDraw(e.world, e.mpp);
    this.publishDrawing(e.mpp);
  }

  private publishDrawing(mpp = 0.01): void {
    if (!this.draw) { this.h.p.bus.set({ drawing: null }); return; }
    const pts = this.draw;
    const cursor = this.drawCursor;
    const withCursor = cursor && dist(cursor, pts[pts.length - 1]) > 0.0005 ? [...pts, cursor] : pts;
    const near = !!cursor && pts.length >= 3 && dist(pts[0], cursor) <= vertexPickRadius(mpp);
    const trial = (near ? pts : withCursor).map((position, i) => ({ id: `d${i}`, position }));
    this.h.p.bus.set({
      drawing: { points: pts, cursor, closable: pts.length >= 3, nearFirst: near, badEdges: trial.length >= 3 ? polygonProblemEdges(trial) : [] },
    });
  }

  private closeDrawing(): void {
    const project = this.project;
    const pts = this.draw;
    if (!project || !pts) return;
    if (pts.length < 3) {
      this.h.p.ui.getState().setStatus({ text: polygonErrorText('TOO_FEW_VERTICES'), severity: 'warn' });
      return;
    }
    const result = proposeCreateRoom(project, roomFromPoints(pts, this.h.p.newId));
    if (result.rejected) {
      if (result.polygonError) this.h.p.ui.getState().setStatus({ text: polygonErrorText(result.polygonError), severity: 'warn' });
      return; // closing is blocked: the corners stay so they can be fixed (Backspace)
    }
    if (this.h.commit(result, LABELS.corner.draw)) {
      this.draw = null;
      this.drawCursor = null;
      this.h.p.bus.reset();
      this.h.p.ui.getState().clearSelection();
      this.h.p.ui.getState().setTool('select');
      this.h.p.onRoomCreated?.();
    }
  }
}
