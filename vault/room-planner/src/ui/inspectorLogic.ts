import { apply } from '../engine/commands';
import { quantizeLinear, quantizeRotation, quantizeVec2 } from '../engine/coordinates';
import {
  evaluateCommand, proposeEditWall, proposeUpdateFixture, type PipelineResult,
} from '../engine/pipeline';
import { validateInstance } from '../engine/validation';
import { impactOf } from '../engine/wallEdit';
import { proposeMoveVertex, proposeSetWallLength } from '../engine/wallPipeline';
import { MIN_SIZE } from '../interaction/handles';
import { describeViolation, LABELS, nameOf, polygonErrorText } from '../interaction/statusMessages';
import type {
  Command, FurnitureInstance, FurnitureMetadata, FurniturePatch, Project, ValidationViolation, Fixture, FixturePatch,
} from '../engine/types';

/**
 * Pure inspector edit logic (A5, A9, B4). Components only render what this returns, so the rules are testable without a DOM:
 *  - every numeric field validates live against the domain on change (`preview*`)
 *  - on blur/Enter an invalid value reverts, a valid one is quantized and committed as ONE command (`commit` is the caller's job)
 *  - multi-selection applies absolute values to every instance of the B4 whitelist; any hard-invalid outcome rejects the whole
 *    edit with one aggregated warning; position is unavailable.
 */
export type FurnitureField =
  | 'width' | 'length' | 'height' | 'elevation' | 'rotationDeg' | 'x' | 'y' | 'locked' | 'finish'
  | 'meta.vendor' | 'meta.sku' | 'meta.finishCode' | 'meta.unitCost' | 'meta.notes';

export type FieldValue = string | number | boolean;

export interface FieldRead {
  /** The shared value, or undefined when it is mixed or absent. */
  value: FieldValue | undefined;
  mixed: boolean;
  /** Not editable for this selection (B4: position on a group). */
  unavailable: boolean;
}

export interface FieldPreview {
  /** ok = commits cleanly · soft = commits, with a warning · hard = would be rejected · invalid = could not be parsed. */
  state: 'ok' | 'soft' | 'hard' | 'invalid' | 'unavailable';
  command: Command | null;
  label: string;
  /** Tooltip text: the primary violation, or the parse problem. */
  message?: string;
  violations: ValidationViolation[];
}

export const FINISH_PART = 'main';

/** Accepts bare metres ("1.25") or an explicit unit ("1250mm", "125cm", "1.25m"). Returns null if it is not a length. */
export function parseLength(text: string): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(mm|cm|m)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'm').toLowerCase();
  return unit === 'mm' ? n / 1000 : unit === 'cm' ? n / 100 : n;
}

function instances(project: Project, ids: string[]): FurnitureInstance[] {
  const room = project.rooms[0];
  return ids.map((id) => room.furniture.find((f) => f.id === id)).filter((f): f is FurnitureInstance => !!f);
}

const NUMERIC: FurnitureField[] = ['width', 'length', 'height', 'elevation', 'rotationDeg', 'x', 'y', 'meta.unitCost'];

/** Current value of a field across the selection. */
export function readFurnitureField(project: Project, ids: string[], field: FurnitureField): FieldRead {
  const insts = instances(project, ids);
  if ((field === 'x' || field === 'y') && insts.length > 1) return { value: undefined, mixed: false, unavailable: true };
  const get = (i: FurnitureInstance): FieldValue | undefined => {
    switch (field) {
      case 'width': return i.width;
      case 'length': return i.length;
      case 'height': return i.height;
      case 'elevation': return i.elevation;
      case 'rotationDeg': return Math.round(((i.rotation * 180) / Math.PI) * 10) / 10;
      case 'x': return i.position.x;
      case 'y': return i.position.y;
      case 'locked': return !!i.locked;
      case 'finish': return i.finishOverrides?.[FINISH_PART];
      case 'meta.vendor': return i.metadata?.vendor;
      case 'meta.sku': return i.metadata?.sku;
      case 'meta.finishCode': return i.metadata?.finishCode;
      case 'meta.unitCost': return i.metadata?.unitCost;
      case 'meta.notes': return i.metadata?.notes;
    }
  };
  const values = insts.map(get);
  const first = values[0];
  const mixed = values.some((v) => v !== first);
  return { value: mixed ? undefined : first, mixed, unavailable: false };
}

const rejectedPreview = (state: FieldPreview['state'], label: string, message: string): FieldPreview =>
  ({ state, command: null, label, message, violations: [] });

/**
 * Build the command for setting `field` to `raw` on every selected instance (absolute values, B4) and judge it with the same
 * validate + escape-rule step the commit pipeline uses.
 */
export function previewFurnitureEdit(project: Project, ids: string[], field: FurnitureField, raw: FieldValue): FieldPreview {
  const insts = instances(project, ids);
  const group = insts.length > 1;
  const subject = group ? `${insts.length} objects` : nameOf(project, ids[0]);
  const label = field === 'locked' ? LABELS.lock(subject, raw === true) : group ? LABELS.group('Edit', insts.length) : LABELS.edit(subject);
  if (insts.length === 0) return rejectedPreview('unavailable', label, 'Nothing selected');
  if ((field === 'x' || field === 'y') && group) return rejectedPreview('unavailable', label, 'Position can only be changed by moving the group');

  // A16: a locked object accepts only a change to `locked` itself.
  if (field !== 'locked') {
    const locked = insts.find((i) => i.locked);
    if (locked) {
      const v: ValidationViolation = { type: 'locked', severity: 'hard', message: 'locked', involvedObjectIds: [locked.id] };
      return { state: 'hard', command: null, label, message: describeViolation(project, v), violations: [v] };
    }
  }

  let num = NaN;
  if (NUMERIC.includes(field)) {
    if (typeof raw === 'number') num = raw;
    else if (field === 'rotationDeg' || field === 'meta.unitCost') num = Number(String(raw).trim());
    else num = parseLength(String(raw)) ?? NaN;
    if (!Number.isFinite(num)) return rejectedPreview('invalid', label, 'Enter a number');
    if ((field === 'width' || field === 'length') && num < MIN_SIZE) return rejectedPreview('invalid', label, `Minimum size is ${MIN_SIZE} m`);
    if (field === 'height' && num <= 0) return rejectedPreview('invalid', label, 'Height must be above 0');
    if (field === 'meta.unitCost' && num < 0) return rejectedPreview('invalid', label, 'Cost cannot be negative');
  }

  const commands: Command[] = [];
  for (const i of insts) {
    switch (field) {
      case 'width':
      case 'length': {
        const to = { position: { ...i.position }, width: field === 'width' ? quantizeLinear(num) : i.width, length: field === 'length' ? quantizeLinear(num) : i.length };
        commands.push({ type: 'ResizeFurniture', instanceId: i.id, from: { position: { ...i.position }, width: i.width, length: i.length }, to }); // about the centre
        break;
      }
      case 'rotationDeg':
        commands.push({ type: 'RotateFurniture', instanceId: i.id, from: i.rotation, to: quantizeRotation((num * Math.PI) / 180) }); // about its own centre
        break;
      case 'x':
      case 'y':
        commands.push({ type: 'MoveFurniture', instanceId: i.id, from: { ...i.position }, to: quantizeVec2({ x: field === 'x' ? num : i.position.x, y: field === 'y' ? num : i.position.y }) });
        break;
      default: {
        const patch = patchFor(i, field, raw, num);
        commands.push({ type: 'UpdateFurniture', instanceId: i.id, from: patch.from, to: patch.to });
      }
    }
  }
  const command: Command = commands.length === 1 ? commands[0] : { type: 'Composite', commands };
  const needsValidation = !['locked', 'finish', 'meta.vendor', 'meta.sku', 'meta.finishCode', 'meta.unitCost', 'meta.notes'].includes(field);
  if (!needsValidation) return { state: 'ok', command, label, violations: [] };

  const r = evaluateCommand(project, command, ids);
  const after = apply(command, project).rooms[0];
  const all = ids.flatMap((id) => {
    const inst = after.furniture.find((f) => f.id === id)!;
    return validateInstance(after, project.furnitureDefinitions, inst).filter((v) => v.involvedObjectIds.includes(id));
  });
  const soft = all.filter((v) => v.severity === 'soft');
  if (!r.ok) {
    const primary = r.violations[0];
    const base = primary ? describeViolation(project, primary) : 'Not allowed here';
    const message = group ? `${base} (the whole edit was rejected)` : base; // A9: one aggregated warning
    return { state: 'hard', command: null, label, message, violations: r.violations };
  }
  if (soft.length) return { state: 'soft', command, label, message: describeViolation(project, soft[0]), violations: soft };
  return { state: 'ok', command, label, violations: [] };
}

function patchFor(i: FurnitureInstance, field: FurnitureField, raw: FieldValue, num: number): { from: FurniturePatch; to: FurniturePatch } {
  switch (field) {
    case 'height': return { from: { height: i.height }, to: { height: quantizeLinear(num) } };
    case 'elevation': return { from: { elevation: i.elevation }, to: { elevation: quantizeLinear(num) } };
    case 'locked': return { from: { locked: i.locked ?? null }, to: { locked: raw === true ? true : null } };
    case 'finish': {
      const next = raw === '' ? null : { ...(i.finishOverrides ?? {}), [FINISH_PART]: String(raw) };
      return { from: { finishOverrides: i.finishOverrides ? { ...i.finishOverrides } : null }, to: { finishOverrides: next } };
    }
    default: {
      const key = field.slice(5) as keyof FurnitureMetadata;
      const meta: FurnitureMetadata = { ...(i.metadata ?? {}) };
      if (raw === '' || raw === undefined) delete meta[key];
      else if (key === 'unitCost') meta.unitCost = num;
      else (meta as Record<string, unknown>)[key] = String(raw);
      return { from: { metadata: i.metadata ? { ...i.metadata } : null }, to: { metadata: Object.keys(meta).length ? meta : null } };
    }
  }
}

// ------------------------------------------------------------------ fixtures

export type FixtureField = 'width' | 'height' | 'elevation' | 'hingeSide' | 'swingAngleDeg' | 'offsetAlongWall';

export function readFixtureField(f: Fixture, field: FixtureField): FieldValue | undefined {
  switch (field) {
    case 'width': return f.width;
    case 'height': return f.height;
    case 'elevation': return f.elevation;
    case 'hingeSide': return f.hingeSide;
    case 'swingAngleDeg': return f.swingAngle === undefined ? 90 : Math.round(((f.swingAngle * 180) / Math.PI) * 10) / 10;
    case 'offsetAlongWall': return f.offsetAlongWall;
  }
}

export function previewFixtureEdit(project: Project, id: string, field: FixtureField, raw: FieldValue): FieldPreview {
  const label = LABELS.edit(nameOf(project, id));
  let patch: FixturePatch;
  if (field === 'hingeSide') {
    patch = { hingeSide: raw === 'right' ? 'right' : 'left' };
  } else {
    const n = typeof raw === 'number' ? raw : field === 'swingAngleDeg' ? Number(String(raw).trim()) : parseLength(String(raw)) ?? NaN;
    if (!Number.isFinite(n)) return rejectedPreview('invalid', label, 'Enter a number');
    if ((field === 'width' || field === 'height') && n <= 0) return rejectedPreview('invalid', label, 'Must be above 0');
    if (field === 'swingAngleDeg' && (n <= 0 || n > 180)) return rejectedPreview('invalid', label, 'Swing must be between 1° and 180°');
    patch = field === 'swingAngleDeg' ? { swingAngle: (n * Math.PI) / 180 } : { [field]: n } as FixturePatch;
  }
  const r: PipelineResult = proposeUpdateFixture(project, id, patch);
  if (r.rejected) {
    if (r.noop) return { state: 'ok', command: null, label, violations: [] };
    return { state: 'hard', command: null, label, message: r.violations[0] ? describeViolation(project, r.violations[0]) : 'Not allowed here', violations: r.violations };
  }
  return { state: 'ok', command: r.command, label, violations: [] };
}

// ------------------------------------------------------------------ corners and wall length (M3)

function wallEditPreview(project: Project, label: string, r: PipelineResult): FieldPreview {
  if (r.rejected) {
    if (r.noop) return { state: 'ok', command: null, label, violations: [] };
    const message = r.polygonError ? polygonErrorText(r.polygonError) : r.message ?? 'That edit is not allowed';
    return { state: 'hard', command: null, label, message, violations: [] };
  }
  // The edit always commits (A3). If it would leave things outside or colliding, say so (soft): same function as the live drag preview.
  const to = (r.command as { to?: Parameters<typeof impactOf>[2] }).to;
  const n = to ? impactOf(project, project.rooms[0].id, to).newlyInvalid.length : 0;
  if (n > 0) return { state: 'soft', command: r.command, label, message: `${n} ${n === 1 ? 'object' : 'objects'} will need attention`, violations: [] };
  return { state: 'ok', command: r.command, label, violations: [] };
}

/** Type a corner's X or Y (metres, mm or cm). One EditWall; rejected only if the polygon would become invalid. */
export function previewVertexPosition(project: Project, vertexId: string, axis: 'x' | 'y', raw: FieldValue): FieldPreview {
  const label = LABELS.corner.move;
  const v = project.rooms[0]?.vertices.find((x) => x.id === vertexId);
  const n = typeof raw === 'number' ? raw : parseLength(String(raw)) ?? NaN;
  if (!v) return rejectedPreview('invalid', label, 'Unknown corner');
  if (!Number.isFinite(n)) return rejectedPreview('invalid', label, 'Enter a number');
  return wallEditPreview(project, label, proposeMoveVertex(project, vertexId, { ...v.position, [axis]: n }));
}

/** Type a wall's inside length: its end corner moves along the wall. This is how room size is set. */
export function previewWallLength(project: Project, wallId: string, raw: FieldValue): FieldPreview {
  const label = LABELS.corner.length;
  const n = typeof raw === 'number' ? raw : parseLength(String(raw)) ?? NaN;
  if (!Number.isFinite(n)) return rejectedPreview('invalid', label, 'Enter a number');
  if (n < 0.05) return rejectedPreview('invalid', label, 'A wall must be at least 0.05 m long');
  return wallEditPreview(project, label, proposeSetWallLength(project, wallId, n));
}

// ------------------------------------------------------------------ walls

export const MAX_WALL_THICKNESS = 1;

/** B1: segment thickness is edited numerically here, never by dragging the outer face. One EditWall, same vertices. */
export function previewWallThickness(project: Project, wallId: string, raw: FieldValue): FieldPreview {
  const room = project.rooms[0];
  const label = 'Edit wall thickness';
  const n = typeof raw === 'number' ? raw : parseLength(String(raw)) ?? NaN;
  if (!Number.isFinite(n)) return rejectedPreview('invalid', label, 'Enter a number');
  if (n < 0.01 || n > MAX_WALL_THICKNESS) return rejectedPreview('invalid', label, `Thickness must be between 0.01 m and ${MAX_WALL_THICKNESS} m`);
  if (quantizeLinear(n) === room.walls.find((w) => w.id === wallId)?.thickness) return { state: 'ok', command: null, label, violations: [] };
  const walls = room.walls.map((w) => (w.id === wallId ? { ...w, thickness: n } : w));
  const r = proposeEditWall(project, room.id, { vertices: room.vertices, walls, fixtures: room.fixtures });
  if (r.rejected) return rejectedPreview('invalid', label, 'That edit is not allowed');
  return { state: 'ok', command: r.command, label, violations: [] };
}
