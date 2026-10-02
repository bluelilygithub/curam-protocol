import { footprintOf } from './footprints';
import { aabbOf, dist, normalize, sub } from './geometry';
import { wallGeometry } from './constraints';
import type { AABB, FurnitureInstance, Room, Vec2 } from './types';

export type DimKind = 'wall' | 'fixture' | 'furniture' | 'alignment';

export interface DimLabel { center: Vec2; width: number; height: number }
export interface DimLine {
  kind: DimKind;
  from: Vec2;
  to: Vec2;
  length: number;
  text: string;
  /** null when the label was suppressed to avoid overlap (the line itself is still drawn). */
  label: DimLabel | null;
}

export interface LiveDimensionsInput {
  /** The dragged object at its *preview* position. */
  moving: FurnitureInstance;
  room: Room;
  /** Everything else in the room. */
  others: FurnitureInstance[];
  /** World metres per screen pixel. */
  metresPerPixel: number;
  /** Label box in screen pixels. */
  labelPx?: { width: number; height: number };
}

/** B10: below this zoom (more world metres per pixel than this) only wall dimensions are shown. */
export const DIM_SCALE_LIMIT = 0.15;
export const MAX_WALL_DIMS = 2;
export const MAX_FURNITURE_DIMS = 2;
export const MAX_DIMS = 6;
const ALIGN_TOLERANCE = 0.005;
const FIXTURE_REACH = 3;

export const formatMetres = (m: number): string => `${m.toFixed(2)} m`;

/** Distance along +t from p in direction d to segment ab, or null. */
function rayHit(p: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const s = sub(b, a);
  const denom = d.x * s.y - d.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(a, p);
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * d.y - qp.y * d.x) / denom;
  return t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? Math.max(0, t) : null;
}

const DIRS: Vec2[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];

function sideMid(b: AABB, d: Vec2): Vec2 {
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  return d.x < 0 ? { x: b.min.x, y: cy } : d.x > 0 ? { x: b.max.x, y: cy } : d.y < 0 ? { x: cx, y: b.min.y } : { x: cx, y: b.max.y };
}

function line(kind: DimKind, from: Vec2, to: Vec2): DimLine {
  const length = dist(from, to);
  return { kind, from, to, length, text: formatMetres(length), label: null };
}

function overlap(a: DimLabel, b: DimLabel): boolean {
  return (
    Math.abs(a.center.x - b.center.x) < (a.width + b.width) / 2 &&
    Math.abs(a.center.y - b.center.y) < (a.height + b.height) / 2
  );
}

/**
 * Live dimensions while dragging (Spec §5, B10). At most 6 lines: nearest wall per axis (max 2), nearest furniture edge per axis
 * (max 2), nearest fixture (1), alignment indicator (1). Nearest = smallest perpendicular distance. Labels never overlap:
 * a lower-priority label (wall > fixture > furniture > alignment) is offset along its own line by one label height and
 * suppressed if no free spot exists within two label heights. Below the scale limit only wall dimensions are shown.
 */
export function liveDimensions(input: LiveDimensionsInput): DimLine[] {
  const { moving, room, others, metresPerPixel } = input;
  const box = aabbOf(footprintOf(moving));
  const poly = room.vertices.map((v) => v.position);
  const lines: DimLine[] = [];

  // --- walls: nearest per axis
  const wallHits: Array<{ axis: 'x' | 'y'; line: DimLine }> = [];
  for (const d of DIRS) {
    const p = sideMid(box, d);
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const t = rayHit(p, d, poly[i], poly[(i + 1) % poly.length]);
      if (t !== null && t < best) best = t;
    }
    if (best !== Infinity) {
      wallHits.push({ axis: d.x !== 0 ? 'x' : 'y', line: line('wall', p, { x: p.x + d.x * best, y: p.y + d.y * best }) });
    }
  }
  const nearest = (axis: 'x' | 'y'): DimLine | undefined =>
    wallHits.filter((h) => h.axis === axis).sort((a, b) => a.line.length - b.line.length)[0]?.line;
  const wallLines = [nearest('x'), nearest('y')].filter((l): l is DimLine => !!l).slice(0, MAX_WALL_DIMS);
  lines.push(...wallLines);

  if (metresPerPixel <= DIM_SCALE_LIMIT) {
    // --- fixture: nearest opening centre
    let fx: DimLine | undefined;
    for (const f of room.fixtures) {
      const g = wallGeometry(room, f.wallId);
      if (!g) continue;
      const centre = { x: g.start.x + g.dir.x * f.offsetAlongWall, y: g.start.y + g.dir.y * f.offsetAlongWall };
      const c = { x: Math.min(box.max.x, Math.max(box.min.x, centre.x)), y: Math.min(box.max.y, Math.max(box.min.y, centre.y)) };
      const l = line('fixture', c, centre);
      if (l.length <= FIXTURE_REACH && (!fx || l.length < fx.length)) fx = l;
    }
    if (fx) lines.push(fx);

    // --- furniture: nearest edge gap per axis
    const boxes = others.map((o) => ({ o, b: aabbOf(footprintOf(o)) }));
    const gaps: Array<{ axis: 'x' | 'y'; line: DimLine }> = [];
    for (const { b } of boxes) {
      const yOverlap = Math.min(box.max.y, b.max.y) - Math.max(box.min.y, b.min.y);
      const xOverlap = Math.min(box.max.x, b.max.x) - Math.max(box.min.x, b.min.x);
      const midY = (Math.max(box.min.y, b.min.y) + Math.min(box.max.y, b.max.y)) / 2;
      const midX = (Math.max(box.min.x, b.min.x) + Math.min(box.max.x, b.max.x)) / 2;
      if (yOverlap > 0) {
        if (b.min.x >= box.max.x) gaps.push({ axis: 'x', line: line('furniture', { x: box.max.x, y: midY }, { x: b.min.x, y: midY }) });
        else if (b.max.x <= box.min.x) gaps.push({ axis: 'x', line: line('furniture', { x: box.min.x, y: midY }, { x: b.max.x, y: midY }) });
      }
      if (xOverlap > 0) {
        if (b.min.y >= box.max.y) gaps.push({ axis: 'y', line: line('furniture', { x: midX, y: box.max.y }, { x: midX, y: b.min.y }) });
        else if (b.max.y <= box.min.y) gaps.push({ axis: 'y', line: line('furniture', { x: midX, y: box.min.y }, { x: midX, y: b.max.y }) });
      }
    }
    for (const axis of ['x', 'y'] as const) {
      const best = gaps.filter((g) => g.axis === axis).sort((a, b) => a.line.length - b.line.length)[0];
      if (best) lines.push(best.line);
    }

    // --- alignment: one indicator, smallest offset within tolerance
    let align: DimLine | undefined;
    let alignOffset = Infinity;
    for (const o of others) {
      const dx = Math.abs(o.position.x - moving.position.x);
      const dy = Math.abs(o.position.y - moving.position.y);
      const cand = dx <= ALIGN_TOLERANCE && dx < alignOffset ? { off: dx } : dy <= ALIGN_TOLERANCE && dy < alignOffset ? { off: dy } : null;
      if (cand) {
        alignOffset = cand.off;
        align = line('alignment', { ...moving.position }, { ...o.position });
      }
    }
    if (align) lines.push(align);
  }

  // --- label placement in priority order
  const labelPx = input.labelPx ?? { width: 56, height: 18 };
  const w = labelPx.width * metresPerPixel;
  const h = labelPx.height * metresPerPixel;
  const order: DimKind[] = ['wall', 'fixture', 'furniture', 'alignment'];
  const placed: DimLabel[] = [];
  const result = lines.slice(0, MAX_DIMS).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const l of result) {
    const dir = normalize(sub(l.to, l.from));
    const mid = { x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2 };
    for (const k of [0, 1, -1, 2, -2]) {
      const c: DimLabel = { center: { x: mid.x + dir.x * h * k, y: mid.y + dir.y * h * k }, width: w, height: h };
      if (!placed.some((p) => overlap(p, c))) {
        l.label = c;
        placed.push(c);
        break;
      }
    }
  }
  return result;
}
