import { FIXTURE_LIBRARY, type FixtureDefinition } from '../data/furnitureLibrary';
import { apply } from '../engine/commands';
import { quantizeLinear, quantizeRotation, quantizeVec2 } from '../engine/coordinates';
import { resizeAboutAnchor, type OrientedRect, type ResizeHandle } from '../engine/footprints';
import { snapFixtureToWall } from '../engine/fixtureSnap';
import { add, dist, scale, sub } from '../engine/geometry';
import { liveDimensions } from '../engine/liveDimensions';
import {
  evaluateCommand, groupRotateCommands, proposeDelete, proposeDeleteFixture, proposeDuplicate, proposeGroupDelete,
  proposeGroupMove, proposeGroupRotate, proposeMove, proposePlaceFixture, proposePlaceFurniture, proposeResize,
  proposeRotate, proposeUpdateFixture, quantizeInstance, selectionPivot, type PipelineResult,
} from '../engine/pipeline';
import {
  cyclePick, marqueeSelect, pickAll, sameRef, type PickCycleState, type SelectionRef,
} from '../engine/selection';
import { generateSnapCandidates, rankSnapCandidates, wallFlushAngle, DEFAULT_SNAP_DISTANCE } from '../engine/snapping';
import { primaryViolation, validateFixture, validateInstance } from '../engine/validation';
import type {
  Command, Fixture, FurnitureInstance, Project, Room, ValidationViolation, Vec2,
} from '../engine/types';
import { type FeedbackBus, type PreviewObject } from '../state/feedbackBus';
import type { IdGen } from '../state/projectFactory';
import type { ProjectStore } from '../state/projectStore';
import { TOOL_KEYS, type UiStore } from '../state/uiStore';
import { ARROW_SMALL, DRAG_SLOP_PX } from './constants';
import { computeHandles, hitHandle, MIN_SIZE } from './handles';
import { describeViolation, LABELS, nameOf, polygonErrorText } from './statusMessages';
import { WallTool, type WallToolState } from './wallTool';

export interface Ports {
  project: ProjectStore;
  ui: UiStore;
  bus: FeedbackBus;
  newId: IdGen;
  now: () => number;
  panBy: (dx: number, dy: number) => void;
  /** Called after a drawn room is committed (the app fits the view to it). */
  onRoomCreated?: () => void;
}

export interface PointerEv {
  world: Vec2;
  screen: Vec2;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  /** World metres per screen pixel. */
  mpp: number;
  button?: number;
}
export interface KeyEv { key: string; shift: boolean; ctrl: boolean; alt: boolean }

export { DRAG_SLOP_PX, ARROW_SMALL };
/** Default angular snap while rotating (Shift = free, re-quantized to 0.1° on release, B2). */
export const ANGLE_SNAP_DEG = 15;
export const WALL_FLUSH_WINDOW_DEG = 10;
const GHOST_ID = '__ghost__';

type Handle = ResizeHandle;
type State =
  | { t: 'idle' }
  | { t: 'press'; hit: SelectionRef | null; start: PointerEv; shift: boolean; wasSelected: boolean }
  | { t: 'drag'; ids: string[]; primary: string; startWorld: Vec2; origins: Map<string, Vec2>; last: Valid<Vec2> | null }
  | { t: 'fixdrag'; id: string; last: { valid: boolean; wallId: string; offset: number } | null }
  | { t: 'resize'; id: string; handle: Handle; start: OrientedRect; last: { position: Vec2; width: number; length: number } | null }
  | { t: 'rotate'; ids: string[]; pivot: Vec2; angle0: number; last: { valid: boolean; delta: number; step: number } | null }
  | { t: 'marquee'; a: Vec2; b: Vec2; shift: boolean; base: SelectionRef[] }
  | { t: 'ghost'; rotation: number; hinge: 'left' | 'right'; last: { valid: boolean; pos: Vec2; wallId?: string; offset?: number } | null }
  | { t: 'pan'; last: Vec2 }
  | { t: 'measure' };
interface Valid<T> { valid: boolean; value: T }

export type StateName = State['t'] | WallToolState;

/**
 * The pointer/keyboard state machine for the 2D editor (Spec §5, Appendix B). No DOM, no Konva, no React: it takes
 * world-space events, publishes per-frame feedback through the bus (never a Zustand store, A12), and changes the project only
 * by committing one pipeline result on release (one drag = one command = one history entry).
 */
export class Interaction {
  private state: State = { t: 'idle' };
  private cycle: PickCycleState | null = null;
  private measure: { a: Vec2; b: Vec2 | null } | null = null;

  private readonly wall: WallTool;

  constructor(private readonly p: Ports) {
    this.wall = new WallTool({ p, commit: (r, label) => this.commit(r, label) });
  }

  get stateName(): StateName {
    return this.p.ui.getState().tool === 'wall_edit' && this.wall.busy ? this.wall.stateName : this.state.t;
  }

  /** Touch: the host calls this when a press on a wall has been held long enough (B1 "long-press inserts a corner"). */
  longPress(): void { this.wall.longPress(); }

  // ---------------------------------------------------------------- context

  private get project(): Project | null { return this.p.project.getState().project; }
  private get room(): Room | undefined { return this.project?.rooms[0]; }
  private get ui() { return this.p.ui.getState(); }

  private selectedIds(kind: 'furniture' | 'fixture' | 'wall'): string[] {
    return this.ui.selection.filter((s) => s.kind === kind).map((s) => s.id);
  }

  private snapOpts(moving: OrientedRect, others: FurnitureInstance[], room: Room) {
    const u = this.ui;
    return generateSnapCandidates({
      moving, room, others, grid: u.grid, snapDistance: DEFAULT_SNAP_DISTANCE, enabled: u.snapEnabled,
    });
  }

  // ---------------------------------------------------------------- commit helpers

  private commit(result: PipelineResult, label: string): boolean {
    const ok = this.p.project.getState().commitResult(result, label);
    if (!ok && result.rejected && !result.noop) this.reportRejection(result);
    return ok;
  }

  private reportRejection(r: Extract<PipelineResult, { rejected: true }>): void {
    const project = this.project;
    if (!project) return;
    const text = r.message ?? (r.polygonError ? polygonErrorText(r.polygonError) : r.violations[0] ? describeViolation(project, r.violations[0]) : null);
    if (text) this.p.ui.getState().setStatus({ text, severity: 'warn' });
  }

  private clearPreview(): void {
    this.p.bus.reset();
  }

  private announce(violations: ValidationViolation[]): void {
    const project = this.project;
    if (!project) return;
    const pv = primaryViolation({ valid: !violations.some((v) => v.severity === 'hard'), violations });
    this.p.bus.setMessage(pv ? { text: describeViolation(project, pv), severity: pv.severity, violations } : null);
  }

  // ---------------------------------------------------------------- pointer

  pointerDown(e: PointerEv): void {
    const project = this.project;
    const room = this.room;
    if (!project) return;
    const u = this.ui;

    if (u.tool === 'pan' || e.button === 1) {
      this.state = { t: 'pan', last: e.screen };
      return;
    }
    if (u.tool === 'wall_edit') { this.wall.pointerDown(e); return; }
    if (!room) return;
    if (u.placing) {
      if (this.state.t !== 'ghost') this.state = { t: 'ghost', rotation: u.placing.kind === 'furniture' ? (u.placing.template?.rotation ?? 0) : 0, hinge: 'left', last: null };
      this.updateGhost(e);
      this.placeGhost(e);
      return;
    }
    if (u.tool === 'measure') {
      this.measureClick(e);
      return;
    }
    if (u.tool !== 'select') return;

    const handles = computeHandles(project, u.selection, e.mpp);
    const hit = hitHandle(handles, e.world, e.mpp);
    if (hit?.kind === 'rotate') {
      this.startRotate(e);
      return;
    }
    if (hit?.kind === 'resize') {
      const f = room.furniture.find((x) => x.id === u.selection[0].id)!;
      this.state = { t: 'resize', id: f.id, handle: hit.handle, start: { position: { ...f.position }, width: f.width, length: f.length, rotation: f.rotation }, last: null };
      this.p.bus.set({ hiddenIds: [f.id] });
      return;
    }

    const hits = pickAll(room, e.world, { tolerance: Math.max(0.01, 4 * e.mpp) });
    const { pick, state } = cyclePick(hits, e.screen, this.p.now(), this.cycle);
    this.cycle = state;
    const wasSelected = !!pick && u.selection.some((s) => sameRef(s, pick));
    if (pick && !wasSelected) {
      const additive = e.shift && pick.kind === 'furniture' && u.selection.every((s) => s.kind === 'furniture');
      this.p.ui.getState().select(additive ? [...u.selection, pick] : [pick]);
    } else if (pick && wasSelected && e.shift) {
      this.p.ui.getState().toggleSelect(pick);
    }
    this.state = { t: 'press', hit: pick, start: e, shift: e.shift, wasSelected };
  }

  pointerMove(e: PointerEv): void {
    const s = this.state;
    const u = this.ui;
    if (s.t === 'pan') {
      this.p.panBy(e.screen.x - s.last.x, e.screen.y - s.last.y);
      s.last = e.screen;
      return;
    }
    if (u.tool === 'wall_edit') { this.wall.pointerMove(e); return; }
    if (u.placing && this.project && this.room) {
      if (this.state.t !== 'ghost') this.state = { t: 'ghost', rotation: u.placing.kind === 'furniture' ? (u.placing.template?.rotation ?? 0) : 0, hinge: 'left', last: null };
      this.updateGhost(e);
      return;
    }
    if (u.tool === 'measure' && this.measure && !this.measure.b) {
      this.p.bus.set({ measure: { a: this.measure.a, b: this.measureSnap(e.world) } });
      return;
    }
    switch (s.t) {
      case 'press':
        if (dist(s.start.screen, e.screen) <= DRAG_SLOP_PX) return;
        if (!s.hit) {
          this.state = { t: 'marquee', a: s.start.world, b: e.world, shift: s.shift, base: u.selection };
          this.p.bus.set({ marquee: { a: s.start.world, b: e.world } });
        } else if (s.hit.kind === 'furniture') {
          this.beginDrag(s.start);
          this.pointerMove(e);
        } else if (s.hit.kind === 'fixture') {
          this.state = { t: 'fixdrag', id: s.hit.id, last: null };
          this.p.bus.set({ hiddenIds: [s.hit.id] });
          this.pointerMove(e);
        }
        return;
      case 'drag': this.updateDrag(e); return;
      case 'fixdrag': this.updateFixtureDrag(e); return;
      case 'resize': this.updateResize(e); return;
      case 'rotate': this.updateRotate(e); return;
      case 'marquee':
        s.b = e.world;
        this.p.bus.set({ marquee: { a: s.a, b: e.world } });
        return;
      default:
    }
  }

  pointerUp(e: PointerEv): void {
    const s = this.state;
    if (this.ui.tool === 'wall_edit' && s.t !== 'pan') { this.wall.pointerUp(e); return; }
    switch (s.t) {
      case 'pan': this.state = { t: 'idle' }; return;
      case 'press': {
        this.state = { t: 'idle' };
        const ui = this.p.ui.getState();
        if (!s.hit) {
          if (!s.shift) ui.clearSelection();
        } else if (s.wasSelected && !s.shift && ui.selection.length > 1) {
          ui.select([s.hit]); // click (no drag) on a member of a group narrows to it
        }
        return;
      }
      case 'drag': this.finishDrag(e); return;
      case 'fixdrag': this.finishFixtureDrag(); return;
      case 'resize': this.finishResize(); return;
      case 'rotate': this.finishRotate(); return;
      case 'marquee': {
        const room = this.room;
        this.state = { t: 'idle' };
        this.p.bus.set({ marquee: null });
        if (!room) return;
        const found = marqueeSelect(room, s.a, s.b);
        const ui = this.p.ui.getState();
        if (s.shift) {
          const merged = [...s.base];
          for (const f of found) if (!merged.some((m) => sameRef(m, f))) merged.push(f);
          ui.select(merged);
        } else {
          ui.select(found);
        }
        return;
      }
      default:
    }
  }

  // ---------------------------------------------------------------- drag (furniture)

  private beginDrag(start: PointerEv): void {
    const room = this.room!;
    const ids = this.selectedIds('furniture');
    const insts = ids.map((id) => room.furniture.find((f) => f.id === id)).filter((f): f is FurnitureInstance => !!f);
    if (insts.length === 0) { this.state = { t: 'idle' }; return; }
    const locked = insts.find((i) => i.locked);
    if (locked) {
      this.state = { t: 'idle' };
      this.p.ui.getState().setStatus({ text: `${nameOf(this.project!, locked.id)} is locked`, severity: 'warn' });
      return;
    }
    const picked = pickAll(room, start.world).find((h) => h.kind === 'furniture' && ids.includes(h.id));
    const primary = picked?.id ?? insts[0].id;
    this.state = {
      t: 'drag', ids: insts.map((i) => i.id), primary, startWorld: start.world,
      origins: new Map(insts.map((i) => [i.id, { ...i.position }])), last: null,
    };
    this.p.bus.set({ hiddenIds: insts.map((i) => i.id) });
  }

  private moveCommand(ids: string[], origins: Map<string, Vec2>, delta: Vec2): Command {
    const cmds: Command[] = ids.map((id): Command => ({
      type: 'MoveFurniture', instanceId: id, from: { ...origins.get(id)! }, to: quantizeVec2(add(origins.get(id)!, delta)),
    }));
    return cmds.length === 1 ? cmds[0] : { type: 'Composite', commands: cmds };
  }

  private updateDrag(e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'drag') return;
    const project = this.project!;
    const room = this.room!;
    const origin = s.origins.get(s.primary)!;
    const primary = room.furniture.find((f) => f.id === s.primary)!;
    const raw = add(origin, sub(e.world, s.startWorld));
    const others = room.furniture.filter((f) => !s.ids.includes(f.id));
    const ranked = rankSnapCandidates(this.snapOpts({ ...primary, position: raw }, others, room), DEFAULT_SNAP_DISTANCE);

    const tries: Array<{ pos: Vec2; snap: typeof ranked[number] | null }> = [
      ...ranked.map((c) => ({ pos: c.position, snap: c })),
      { pos: raw, snap: null },
    ];
    let chosen: { cmd: Command; delta: Vec2; snap: typeof ranked[number] | null; ok: boolean; violations: ValidationViolation[] } | null = null;
    for (const t of tries) {
      const delta = quantizeVec2(sub(t.pos, origin));
      const cmd = this.moveCommand(s.ids, s.origins, delta);
      const r = evaluateCommand(project, cmd, s.ids);
      if (r.ok) { chosen = { cmd, delta, snap: t.snap, ok: true, violations: r.violations }; break; }
      if (t.snap === null) chosen = { cmd, delta, snap: null, ok: false, violations: r.violations };
    }
    const c = chosen!;
    const after = apply(c.cmd, project);
    const afterRoom = after.rooms[0];
    const previews: PreviewObject[] = [];
    const violations: ValidationViolation[] = [];
    for (const id of s.ids) {
      const inst = afterRoom.furniture.find((f) => f.id === id)!;
      const vs = validateInstance(afterRoom, project.furnitureDefinitions, inst).filter((v) => v.involvedObjectIds.includes(id));
      violations.push(...vs);
      previews.push({ id, kind: 'furniture', instance: inst, valid: !vs.some((v) => v.severity === 'hard'), violations: vs, ghost: false });
    }
    s.last = { valid: c.ok, value: c.delta };
    const primaryAfter = afterRoom.furniture.find((f) => f.id === s.primary)!;
    this.p.bus.set({
      previews,
      snap: c.snap,
      dims: liveDimensions({ moving: primaryAfter, room: afterRoom, others: afterRoom.furniture.filter((f) => !s.ids.includes(f.id)), metresPerPixel: e.mpp }),
    });
    this.announce(violations);
  }

  private finishDrag(_e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'drag') return;
    const project = this.project!;
    this.state = { t: 'idle' };
    const last = s.last;
    if (!last || !last.valid) {
      // Invalid (or no movement): silent animate-back, NO history entry (A11).
      this.p.bus.set({ animateBack: !!last && !last.valid, snap: null, dims: [] });
      if (!last || last.valid) this.clearPreview();
      return;
    }
    const origin = s.origins.get(s.primary)!;
    const target = add(origin, last.value);
    const result = s.ids.length === 1
      ? proposeMove(project, s.ids[0], target)
      : proposeGroupMove(project, s.ids, last.value);
    const label = s.ids.length === 1 ? LABELS.move(nameOf(project, s.ids[0])) : LABELS.group('Move', s.ids.length);
    this.commit(result, label);
    this.clearPreview();
  }

  // ---------------------------------------------------------------- fixture drag

  private updateFixtureDrag(e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'fixdrag') return;
    const project = this.project!;
    const room = this.room!;
    const fx = room.fixtures.find((f) => f.id === s.id)!;
    const snap = snapFixtureToWall(room, e.world, fx.width);
    if (!snap) {
      s.last = null;
      this.p.bus.set({ previews: [{ id: fx.id, kind: 'fixture', fixture: fx, valid: false, violations: [], ghost: false, freeAt: e.world, freeWidth: fx.width }] });
      this.p.bus.setMessage({ text: 'Move next to a wall', severity: 'hard', violations: [] });
      return;
    }
    const moved: Fixture = { ...fx, wallId: snap.wallId, offsetAlongWall: snap.offsetAlongWall };
    const r = proposeUpdateFixture(project, fx.id, { wallId: snap.wallId, offsetAlongWall: snap.offsetAlongWall });
    const afterRoom = { ...room, fixtures: room.fixtures.map((f) => (f.id === fx.id ? moved : f)) };
    const violations = validateFixture(afterRoom, moved).filter((v) => (v.involvedFixtureIds ?? []).includes(fx.id));
    s.last = { valid: !r.rejected || !!r.noop, wallId: snap.wallId, offset: snap.offsetAlongWall };
    this.p.bus.set({ previews: [{ id: fx.id, kind: 'fixture', fixture: moved, valid: s.last.valid, violations, ghost: false }] });
    this.announce(violations);
  }

  private finishFixtureDrag(): void {
    const s = this.state;
    if (s.t !== 'fixdrag') return;
    const project = this.project!;
    this.state = { t: 'idle' };
    const last = s.last;
    if (last && last.valid) {
      const fx = this.room!.fixtures.find((f) => f.id === s.id)!;
      if (fx.wallId !== last.wallId || fx.offsetAlongWall !== last.offset) {
        this.commit(proposeUpdateFixture(project, s.id, { wallId: last.wallId, offsetAlongWall: last.offset }), LABELS.move(nameOf(project, s.id)));
      }
      this.clearPreview();
    } else {
      this.p.bus.set({ animateBack: !!last });
      if (!last) this.clearPreview();
    }
  }

  // ---------------------------------------------------------------- resize

  private updateResize(e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'resize') return;
    const project = this.project!;
    const room = this.room!;
    const f = room.furniture.find((x) => x.id === s.id)!;
    const c = Math.cos(s.start.rotation);
    const sn = Math.sin(s.start.rotation);
    const rel = sub(e.world, s.start.position);
    const px = rel.x * c + rel.y * sn; // pointer in the object's local frame
    const py = -rel.x * sn + rel.y * c;
    const h = s.handle;
    const newW = h.x === 0 ? s.start.width : Math.max(MIN_SIZE, h.x * (px + (h.x * s.start.width) / 2));
    const newL = h.y === 0 ? s.start.length : Math.max(MIN_SIZE, h.y * (py + (h.y * s.start.length) / 2));
    const raw = resizeAboutAnchor(s.start, h, newW, newL);
    const to = { position: quantizeVec2(raw.position), width: quantizeLinear(raw.width), length: quantizeLinear(raw.length) };
    const cmd: Command = {
      type: 'ResizeFurniture', instanceId: s.id,
      from: { position: { ...f.position }, width: f.width, length: f.length }, to,
    };
    const r = evaluateCommand(project, cmd, [s.id]);
    let shown = to;
    if (r.ok) s.last = to;
    else shown = s.last ?? { position: { ...s.start.position }, width: s.start.width, length: s.start.length }; // B3: the handle sticks
    const inst: FurnitureInstance = { ...f, ...shown };
    const vs = validateInstance(room, project.furnitureDefinitions, inst).filter((v) => v.involvedObjectIds.includes(f.id));
    this.p.bus.set({
      previews: [{ id: f.id, kind: 'furniture', instance: inst, valid: !vs.some((v) => v.severity === 'hard'), violations: vs, ghost: false }],
      dims: liveDimensions({ moving: inst, room, others: room.furniture.filter((o) => o.id !== f.id), metresPerPixel: e.mpp }),
    });
    this.announce(r.ok ? vs : r.violations);
  }

  private finishResize(): void {
    const s = this.state;
    if (s.t !== 'resize') return;
    const project = this.project!;
    this.state = { t: 'idle' };
    const last = s.last;
    if (last) this.commit(proposeResize(project, s.id, last), LABELS.resize(nameOf(project, s.id)));
    this.clearPreview();
  }

  // ---------------------------------------------------------------- rotate

  private startRotate(e: PointerEv): void {
    const room = this.room!;
    const ids = this.selectedIds('furniture');
    const insts = ids.map((id) => room.furniture.find((f) => f.id === id)!);
    const pivot = insts.length === 1 ? { ...insts[0].position } : selectionPivot(insts);
    this.state = { t: 'rotate', ids, pivot, angle0: Math.atan2(e.world.y - pivot.y, e.world.x - pivot.x), last: null };
    this.p.bus.set({ hiddenIds: ids });
  }

  private updateRotate(e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'rotate') return;
    const project = this.project!;
    const room = this.room!;
    let step = e.shift ? 0.1 : ANGLE_SNAP_DEG;
    const raw = Math.atan2(e.world.y - s.pivot.y, e.world.x - s.pivot.x) - s.angle0; // 1:1 arc mapping
    let delta = raw;
    if (s.ids.length === 1 && !e.shift) {
      const inst = room.furniture.find((f) => f.id === s.ids[0])!;
      const flush = wallFlushAngle(inst, inst.rotation + raw, room);
      if (flush !== null) {
        delta = flush - inst.rotation;
        step = 0.1; // a wall-flush angle is rarely a multiple of 15°: keep it to 0.1°
      }
    }
    const q = quantizeRotation(delta, step);
    const commands: Command[] = s.ids.length === 1
      ? [{ type: 'RotateFurniture', instanceId: s.ids[0], from: room.furniture.find((f) => f.id === s.ids[0])!.rotation, to: quantizeRotation(room.furniture.find((f) => f.id === s.ids[0])!.rotation + q, step) }]
      : groupRotateCommands(project, s.ids, q);
    const cmd: Command = commands.length === 1 ? commands[0] : { type: 'Composite', commands };
    const r = evaluateCommand(project, cmd, s.ids);
    const after = apply(cmd, project).rooms[0];
    const previews: PreviewObject[] = [];
    const violations: ValidationViolation[] = [];
    for (const id of s.ids) {
      const inst = after.furniture.find((f) => f.id === id)!;
      const vs = validateInstance(after, project.furnitureDefinitions, inst).filter((v) => v.involvedObjectIds.includes(id));
      violations.push(...vs);
      previews.push({ id, kind: 'furniture', instance: inst, valid: !vs.some((v) => v.severity === 'hard'), violations: vs, ghost: false });
    }
    s.last = { valid: r.ok, delta: q, step };
    this.p.bus.set({ previews });
    this.announce(violations);
  }

  private finishRotate(): void {
    const s = this.state;
    if (s.t !== 'rotate') return;
    const project = this.project!;
    this.state = { t: 'idle' };
    const last = s.last;
    if (!last) { this.clearPreview(); return; }
    if (!last.valid) {
      this.p.bus.set({ animateBack: true });
      return;
    }
    if (s.ids.length === 1) {
      const inst = this.room!.furniture.find((f) => f.id === s.ids[0])!;
      this.commit(proposeRotate(project, s.ids[0], inst.rotation + last.delta, { angularSnapDeg: last.step }), LABELS.rotate(nameOf(project, s.ids[0])));
    } else {
      this.commit(proposeGroupRotate(project, s.ids, last.delta), LABELS.group('Rotate', s.ids.length));
    }
    this.clearPreview();
  }

  // ---------------------------------------------------------------- placement ghost

  private ghostInstance(pos: Vec2, rotation: number): FurnitureInstance | null {
    const project = this.project;
    const room = this.room;
    const placing = this.ui.placing;
    if (!project || !room || !placing || placing.kind !== 'furniture') return null;
    if (placing.template) return { ...structuredClone(placing.template), id: GHOST_ID, position: pos, rotation };
    const def = project.furnitureDefinitions.find((d) => d.id === placing.definitionId);
    if (!def) return null;
    return {
      id: GHOST_ID, definitionId: def.id, roomId: room.id, position: pos, elevation: 0, rotation,
      width: def.defaultWidth, length: def.defaultLength, height: def.defaultHeight,
    };
  }

  private fixtureDef(): FixtureDefinition | null {
    const placing = this.ui.placing;
    if (!placing || placing.kind !== 'fixture') return null;
    return FIXTURE_LIBRARY.find((d) => d.id === placing.definitionId) ?? null;
  }

  private updateGhost(e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'ghost') return;
    const project = this.project!;
    const room = this.room!;
    const placing = this.ui.placing!;

    if (placing.kind === 'fixture') {
      const def = this.fixtureDef();
      if (!def) return;
      const snap = snapFixtureToWall(room, e.world, def.width);
      if (!snap) {
        s.last = null;
        this.p.bus.set({ previews: [{ id: GHOST_ID, kind: 'fixture', valid: false, violations: [], ghost: true, freeAt: e.world, freeWidth: def.width }], snap: null, dims: [] });
        this.p.bus.setMessage({ text: 'Move next to a wall to place the ' + def.name.toLowerCase(), severity: 'soft', violations: [] });
        return;
      }
      const fixture: Fixture = {
        id: GHOST_ID, type: def.type, wallId: snap.wallId, offsetAlongWall: snap.offsetAlongWall, width: def.width, height: def.height,
        elevation: def.elevation,
        ...(def.type === 'door' ? { hingeSide: s.hinge, swingAngle: def.swingAngle ?? Math.PI / 2, ...(def.accessZoneDepth ? { accessZoneDepth: def.accessZoneDepth } : {}) } : {}),
      };
      const vs = validateFixture({ ...room, fixtures: [...room.fixtures, fixture] }, fixture).filter((v) => (v.involvedFixtureIds ?? []).includes(GHOST_ID));
      const valid = !vs.some((v) => v.severity === 'hard');
      s.last = { valid, pos: e.world, wallId: snap.wallId, offset: snap.offsetAlongWall };
      this.p.bus.set({ previews: [{ id: GHOST_ID, kind: 'fixture', fixture, valid, violations: vs, ghost: true }], snap: null, dims: [] });
      this.announce(vs);
      return;
    }

    const probe = this.ghostInstance(e.world, s.rotation);
    if (!probe) return;
    const ranked = rankSnapCandidates(this.snapOpts(probe, room.furniture, room), DEFAULT_SNAP_DISTANCE);
    const tries = [...ranked.map((c) => ({ pos: c.position, snap: c })), { pos: e.world, snap: null as (typeof ranked)[number] | null }];
    let pick: { inst: FurnitureInstance; vs: ValidationViolation[]; ok: boolean; snap: (typeof ranked)[number] | null } | null = null;
    for (const t of tries) {
      const inst = quantizeInstance({ ...probe, position: t.pos });
      const vs = validateInstance(room, project.furnitureDefinitions, inst);
      const ok = !vs.some((v) => v.severity === 'hard');
      if (ok) { pick = { inst, vs, ok, snap: t.snap }; break; }
      if (t.snap === null) pick = { inst, vs, ok, snap: null };
    }
    const g = pick!;
    s.last = { valid: g.ok, pos: g.inst.position };
    this.p.bus.set({
      previews: [{ id: GHOST_ID, kind: 'furniture', instance: g.inst, valid: g.ok, violations: g.vs, ghost: true }],
      snap: g.snap,
      dims: liveDimensions({ moving: g.inst, room, others: room.furniture, metresPerPixel: e.mpp }),
    });
    this.announce(g.vs);
  }

  private placeGhost(_e: PointerEv): void {
    const s = this.state;
    if (s.t !== 'ghost' || !s.last) return;
    const project = this.project!;
    const placing = this.ui.placing!;
    if (!s.last.valid) {
      this.p.ui.getState().setStatus({ text: this.p.bus.get().message?.text ?? 'That spot is not valid', severity: 'warn' });
      return;
    }
    if (placing.kind === 'fixture') {
      const def = this.fixtureDef()!;
      const id = this.p.newId();
      const fixture: Fixture = {
        id, type: def.type, wallId: s.last.wallId!, offsetAlongWall: s.last.offset!, width: def.width, height: def.height, elevation: def.elevation,
        ...(def.type === 'door' ? { hingeSide: s.hinge, swingAngle: def.swingAngle ?? Math.PI / 2 } : {}),
      };
      if (this.commit(proposePlaceFixture(project, fixture), LABELS.place(def.name))) {
        this.endPlacing();
        this.p.ui.getState().select([{ kind: 'fixture', id }]);
      }
      return;
    }
    const probe = this.ghostInstance(s.last.pos, s.rotation)!;
    const id = this.p.newId();
    const inst: FurnitureInstance = { ...probe, id };
    const defName = project.furnitureDefinitions.find((d) => d.id === probe.definitionId)?.name ?? 'Object';
    if (this.commit(proposePlaceFurniture(project, inst), placing.template ? LABELS.duplicate(defName) : LABELS.place(defName))) {
      this.p.ui.getState().noteRecent(probe.definitionId);
      this.endPlacing();
      this.p.ui.getState().select([{ kind: 'furniture', id }]);
    }
  }

  private endPlacing(): void {
    this.state = { t: 'idle' };
    this.p.ui.getState().stopPlacing();
    this.clearPreview();
  }

  // ---------------------------------------------------------------- measure

  private measureSnap(p: Vec2): Vec2 {
    const room = this.room;
    if (!room) return p;
    let best: Vec2 = { x: Math.round(p.x / this.ui.grid) * this.ui.grid, y: Math.round(p.y / this.ui.grid) * this.ui.grid };
    let bestD = dist(best, p) <= DEFAULT_SNAP_DISTANCE ? dist(best, p) : Infinity;
    if (bestD === Infinity) best = p;
    for (const v of room.vertices) {
      const d = dist(v.position, p);
      if (d <= DEFAULT_SNAP_DISTANCE && d < bestD) { best = v.position; bestD = d; }
    }
    return { x: quantizeLinear(best.x), y: quantizeLinear(best.y) };
  }

  private measureClick(e: PointerEv): void {
    const p = this.measureSnap(e.world);
    if (!this.measure || this.measure.b) this.measure = { a: p, b: null };
    else this.measure = { a: this.measure.a, b: p };
    this.p.bus.set({ measure: { ...this.measure } });
  }

  get measurement(): { a: Vec2; b: Vec2 | null } | null { return this.measure; }

  // ---------------------------------------------------------------- keyboard

  /** Returns true if the key was handled (so the caller can preventDefault). */
  keyDown(k: KeyEv): boolean {
    const project = this.project;
    const room = this.room;
    const u = this.ui;
    const mod = k.ctrl;

    if (mod && k.key.toLowerCase() === 'z') {
      this.cancel();
      const label = k.shift ? this.p.project.getState().redo() : this.p.project.getState().undo();
      if (label !== null) this.p.ui.getState().setStatus({ text: `${k.shift ? 'Redid' : 'Undid'}: ${label ?? 'last action'}`, severity: 'info' });
      this.p.ui.getState().clearSelection();
      return true;
    }
    if (mod && k.key.toLowerCase() === 'y') {
      this.cancel();
      const label = this.p.project.getState().redo();
      if (label !== null) this.p.ui.getState().setStatus({ text: `Redid: ${label ?? 'last action'}`, severity: 'info' });
      return true;
    }
    if (k.key === 'Escape') { this.cancel(true); return true; }
    if (u.tool === 'wall_edit' && !mod && this.wall.keyDown(k)) return true;
    if (!project || !room) {
      // with no room yet the only keys that matter are the tool shortcuts (e.g. 3 to start drawing, 1 to leave)
      if (!mod && !k.alt && TOOL_KEYS[k.key] && u.tool !== TOOL_KEYS[k.key] && !(this.wall.busy && u.tool === 'wall_edit' && k.key === 'Backspace')) {
        this.setTool(TOOL_KEYS[k.key]);
        return true;
      }
      return false;
    }
    if (!mod && !k.alt && TOOL_KEYS[k.key] && u.tool !== TOOL_KEYS[k.key]) {
      this.setTool(TOOL_KEYS[k.key]);
      return true;
    }
    if (mod && k.key.toLowerCase() === 'a') {
      this.p.ui.getState().select(room.furniture.map((f) => ({ kind: 'furniture', id: f.id } as SelectionRef)));
      return true;
    }
    const s = this.state;
    if (s.t === 'ghost' && (k.key === 'r' || k.key === 'R')) {
      s.rotation = quantizeRotation(s.rotation + Math.PI / 4);
      return true;
    }
    if (s.t === 'ghost' && (k.key === 'h' || k.key === 'H')) {
      s.hinge = s.hinge === 'left' ? 'right' : 'left';
      return true;
    }
    if (s.t !== 'idle') return false; // no edits while a gesture or ghost is active

    const furn = this.selectedIds('furniture');
    const fix = this.selectedIds('fixture');
    if (k.key === 'Delete' || k.key === 'Backspace') {
      if (furn.length) {
        const r = furn.length === 1 ? proposeDelete(project, furn[0]) : proposeGroupDelete(project, furn);
        const label = furn.length === 1 ? LABELS.delete(nameOf(project, furn[0])) : LABELS.group('Delete', furn.length);
        if (this.commit(r, label)) this.p.ui.getState().clearSelection();
        return true;
      }
      if (fix.length === 1) {
        if (this.commit(proposeDeleteFixture(project, fix[0]), LABELS.delete(nameOf(project, fix[0])))) this.p.ui.getState().clearSelection();
        return true;
      }
      return false;
    }
    if (furn.length && (k.key === 'r' || k.key === 'R') && !mod) {
      const r = furn.length === 1
        ? proposeRotate(project, furn[0], room.furniture.find((f) => f.id === furn[0])!.rotation + Math.PI / 4) // applied to the stored, quantized value
        : proposeGroupRotate(project, furn, Math.PI / 4);
      this.commit(r, furn.length === 1 ? LABELS.rotate(nameOf(project, furn[0])) : LABELS.group('Rotate', furn.length));
      return true;
    }
    if (furn.length && mod && k.key.toLowerCase() === 'd') {
      this.duplicate(furn);
      return true;
    }
    const arrow: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 } };
    if (furn.length && arrow[k.key]) {
      const step = k.shift ? u.grid : ARROW_SMALL; // Shift = larger move (one grid unit)
      const delta = scale(arrow[k.key], step);
      const r = furn.length === 1
        ? proposeMove(project, furn[0], add(room.furniture.find((f) => f.id === furn[0])!.position, delta))
        : proposeGroupMove(project, furn, delta);
      this.commit(r, furn.length === 1 ? LABELS.move(nameOf(project, furn[0])) : LABELS.group('Move', furn.length));
      return true;
    }
    return false;
  }

  duplicate(ids: string[]): void {
    const project = this.project;
    if (!project) return;
    const newIds = ids.map(() => this.p.newId());
    const r = proposeDuplicate(project, ids, newIds);
    if (!r.rejected) {
      const name = nameOf(project, ids[0]);
      if (this.commit(r, ids.length === 1 ? LABELS.duplicate(name) : LABELS.group('Duplicate', ids.length))) {
        this.p.ui.getState().select(newIds.map((id) => ({ kind: 'furniture', id } as SelectionRef)));
      }
      return;
    }
    // A6: the offset spot is invalid. A single copy stays attached to the pointer so it can be placed somewhere valid.
    if (ids.length === 1) {
      const src = this.room!.furniture.find((f) => f.id === ids[0])!;
      this.p.ui.getState().startPlacing({ kind: 'furniture', definitionId: src.definitionId, template: structuredClone({ ...src, locked: undefined }) });
      this.p.ui.getState().setStatus({ text: 'No room for the copy there — click to place it', severity: 'info' });
    } else {
      this.reportRejection(r);
    }
  }

  setTool(tool: 'select' | 'pan' | 'wall_edit' | 'measure'): void {
    this.cancel(); // B7: switching tools mid-drag cancels the drag first
    const ui = this.p.ui.getState();
    if (tool === 'wall_edit') {
      ui.clearSelection(); // furniture is not pickable in this tool
      ui.setStatus(this.room
        ? { text: 'Click a corner or wall. Drag a corner to reshape; double-click a wall to add a corner.', severity: 'info' }
        : { text: 'Click to place the first corner. Click the first corner again, or press Enter, to close the room.', severity: 'info' });
    }
    ui.setTool(tool);
    if (tool !== 'measure') { this.measure = null; this.p.bus.set({ measure: null }); }
  }

  /**
   * B7 cancel/escape semantics. `escape` is true for the Escape key (which also clears the measurement or the selection when idle);
   * a tool switch calls it with false so it only abandons temporary gestures.
   */
  cancel(escape = false): void {
    const s = this.state;
    const u = this.p.ui.getState();
    if (u.tool === 'wall_edit' && this.wall.cancel(escape)) return; // B7: MOVING_VERTEX reverts; drawing is abandoned; Escape deselects
    if (s.t === 'ghost' || u.placing) {
      this.state = { t: 'idle' };
      u.stopPlacing(); // discard, no history
      this.clearPreview();
      return;
    }
    switch (s.t) {
      case 'drag': case 'resize': case 'rotate': case 'fixdrag': case 'press':
        this.state = { t: 'idle' };
        this.clearPreview(); // restore the last committed transform, no history
        return;
      case 'marquee':
        this.state = { t: 'idle' };
        this.p.bus.set({ marquee: null }); // clear the marquee, keep the selection
        return;
      case 'pan':
        this.state = { t: 'idle' };
        return;
      default:
    }
    if (!escape) return;
    if (u.tool === 'measure') {
      this.measure = null; // clear the current measurement, stay in the tool
      this.p.bus.set({ measure: null });
      return;
    }
    if (u.selection.length) u.clearSelection(); // Escape never exits a persistent tool
  }

  /** Called by the renderer once an animate-back has finished. */
  animationDone(): void {
    this.clearPreview();
  }
}
