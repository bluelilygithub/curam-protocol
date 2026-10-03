import { quantizeLinear, quantizeVec2, EPSILON } from './coordinates';
import { FIXTURE_END_MARGIN } from './constraints';
import { dist, dot, normalize, scale, sub, add } from './geometry';
import { validatePolygon } from './polygons';
import { DEFAULT_GRID, DEFAULT_SNAP_DISTANCE, SNAP_PRIORITY } from './snapping';
import { validateRoom } from './validation';
import type {
  Fixture, Project, Room, RoomGeometryState, SnapCandidate, ValidationResult, Vec2, Vertex, WallSegment,
} from './types';

/**
 * Pure wall / corner editing (Appendix B B1, C5, C6, C15). Every function takes the current room and returns a CANDIDATE
 * geometry (`vertices`, `walls`, `fixtures`), quantized, with all new ids supplied by the caller. Nothing here validates the
 * polygon or the furniture: the commit pipeline (`proposeEditWall`, §6a) checks polygon validity only, and re-validation then
 * reports whatever became invalid. Walls always reference vertices by stable id (Rev 4), never by index.
 */
export const geometryOf = (room: Room): RoomGeometryState => ({
  vertices: room.vertices, walls: room.walls, fixtures: room.fixtures,
});

const clone = <T>(x: T): T => structuredClone(x);

function lengthOf(g: RoomGeometryState, wall: WallSegment): number {
  const a = g.vertices.find((v) => v.id === wall.startVertexId);
  const b = g.vertices.find((v) => v.id === wall.endVertexId);
  return a && b ? dist(a.position, b.position) : 0;
}

/**
 * C5: re-fit fixtures to their (possibly shorter or longer) wall. A fixture is moved to the nearest legal centre when the wall
 * is long enough to hold it; a fixture that cannot fit at all is carried UNCHANGED and later reported as `fixture_out_of_wall`.
 * Idempotent. Rounding goes inward so the 1 mm grid never steps back outside the legal range.
 */
export function clampFixtures(g: RoomGeometryState): RoomGeometryState {
  const fixtures = g.fixtures.map((f): Fixture => {
    const wall = g.walls.find((w) => w.id === f.wallId);
    if (!wall) return f;
    const len = lengthOf(g, wall);
    const lo = f.width / 2 + FIXTURE_END_MARGIN;
    const hi = len - f.width / 2 - FIXTURE_END_MARGIN;
    if (lo > hi + EPSILON) return f; // wall too short: cannot be clamped
    if (f.offsetAlongWall >= lo - EPSILON && f.offsetAlongWall <= hi + EPSILON) return f;
    const loMm = Math.ceil(lo * 1000 - 1e-6) / 1000;
    const hiMm = Math.floor(hi * 1000 + 1e-6) / 1000;
    const q = quantizeLinear(Math.min(hi, Math.max(lo, f.offsetAlongWall)));
    return { ...f, offsetAlongWall: Math.min(hiMm, Math.max(loMm, q)) };
  });
  return { vertices: g.vertices, walls: g.walls, fixtures };
}

/** Move one corner. Walls keep their ids and thickness; fixtures on the two walls it touches are re-clamped (C5). */
export function moveVertex(room: Room, vertexId: string, to: Vec2): RoomGeometryState | null {
  if (!room.vertices.some((v) => v.id === vertexId)) return null;
  const q = quantizeVec2(to);
  const vertices = room.vertices.map((v): Vertex => (v.id === vertexId ? { id: v.id, position: q } : clone(v)));
  return clampFixtures({ vertices, walls: clone(room.walls), fixtures: clone(room.fixtures) });
}

/**
 * Set a wall's inside length: its END corner moves along the wall direction so the wall keeps its angle. (Room size is edited
 * this way, owner decision.) Returns null for an unknown wall or a zero-length wall (no direction).
 */
export function setWallLength(room: Room, wallId: string, length: number): RoomGeometryState | null {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const a = room.vertices.find((v) => v.id === wall.startVertexId);
  const b = room.vertices.find((v) => v.id === wall.endVertexId);
  if (!a || !b) return null;
  const dir = normalize(sub(b.position, a.position));
  if (dir.x === 0 && dir.y === 0) return null;
  return moveVertex(room, b.id, add(a.position, scale(dir, length)));
}

/** Index i such that the wall runs vertices[i] → vertices[i+1] (or the reverse), or -1. */
function edgeIndex(room: Room, wall: WallSegment): number {
  const n = room.vertices.length;
  for (let i = 0; i < n; i++) {
    const a = room.vertices[i].id;
    const b = room.vertices[(i + 1) % n].id;
    if ((wall.startVertexId === a && wall.endVertexId === b) || (wall.startVertexId === b && wall.endVertexId === a)) return i;
  }
  return -1;
}

export interface InsertIds { vertexId: string; segmentId: string }

/**
 * Insert a corner on a wall (C6). The click is projected onto the segment (so the shape does not change: three collinear
 * corners are valid, C7). The wall keeps its id for the half that ends at the new corner; the other half gets the new segment id;
 * both inherit the thickness. A fixture whose CENTRE lies on the new half moves to it (wallId + offset updated); the rest stay.
 * Fixtures that no longer fit are carried unchanged and reported by re-validation.
 */
export function insertVertex(room: Room, wallId: string, at: Vec2, ids: InsertIds): RoomGeometryState | null {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const i = edgeIndex(room, wall);
  const a = room.vertices.find((v) => v.id === wall.startVertexId);
  const b = room.vertices.find((v) => v.id === wall.endVertexId);
  if (i < 0 || !a || !b) return null;
  const ab = sub(b.position, a.position);
  const len2 = dot(ab, ab);
  if (len2 === 0) return null;
  const t = Math.min(1, Math.max(0, dot(sub(at, a.position), ab) / len2));
  const position = quantizeVec2(add(a.position, scale(ab, t)));
  const newVertex: Vertex = { id: ids.vertexId, position };

  // polygon order: the new corner goes between the wall's two corners, whichever way the array lists them
  const vertices = clone(room.vertices);
  vertices.splice(i + 1, 0, newVertex);

  const first: WallSegment = { ...clone(wall), endVertexId: newVertex.id };
  const second: WallSegment = { id: ids.segmentId, startVertexId: newVertex.id, endVertexId: wall.endVertexId, thickness: wall.thickness };
  const wi = room.walls.findIndex((w) => w.id === wall.id);
  const walls = clone(room.walls);
  walls.splice(wi, 1, first, second);

  const firstLen = dist(a.position, position);
  const fixtures = room.fixtures.map((f): Fixture => {
    if (f.wallId !== wall.id) return clone(f);
    if (f.offsetAlongWall > firstLen) {
      return { ...clone(f), wallId: second.id, offsetAlongWall: quantizeLinear(f.offsetAlongWall - firstLen) };
    }
    return clone(f);
  });
  return { vertices, walls, fixtures };
}

/**
 * Delete a corner (B1, C6, C15). The two walls meeting there merge into one that keeps the id and thickness of the INCOMING wall
 * (the one ending at the corner); the outgoing wall disappears. Fixtures from the outgoing wall are re-homed onto the merged wall
 * (offset + the incoming length) and carried unclamped if they no longer fit. Needs at least 4 corners (a room keeps 3).
 */
export function deleteVertex(room: Room, vertexId: string): RoomGeometryState | null {
  if (room.vertices.length < 4) return null;
  const v = room.vertices.find((x) => x.id === vertexId);
  const incoming = room.walls.find((w) => w.endVertexId === vertexId);
  const outgoing = room.walls.find((w) => w.startVertexId === vertexId);
  if (!v || !incoming || !outgoing) return null;
  const prev = room.vertices.find((x) => x.id === incoming.startVertexId);
  if (!prev) return null;
  const incomingLen = dist(prev.position, v.position);

  const vertices = room.vertices.filter((x) => x.id !== vertexId).map(clone);
  const walls = room.walls
    .filter((w) => w.id !== outgoing.id)
    .map((w) => (w.id === incoming.id ? { ...clone(w), endVertexId: outgoing.endVertexId } : clone(w)));
  const fixtures = room.fixtures.map((f): Fixture =>
    f.wallId === outgoing.id
      ? { ...clone(f), wallId: incoming.id, offsetAlongWall: quantizeLinear(f.offsetAlongWall + incomingLen) }
      : clone(f));
  return clampFixtures({ vertices, walls, fixtures });
}

/**
 * "Sticks at the last valid position along the drag vector" (B1): the farthest point from `lastValid` toward `target` for which
 * the polygon is valid (bisection to 1 mm). `lastValid` itself is assumed valid. Returns `target` when it is already valid.
 */
export function stickVertex(room: Room, vertexId: string, lastValid: Vec2, target: Vec2): Vec2 {
  const valid = (p: Vec2): boolean => {
    const g = moveVertex(room, vertexId, p);
    return !!g && validatePolygon(g.vertices).ok;
  };
  const tq = quantizeVec2(target);
  if (valid(tq)) return tq;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 28; k++) {
    const mid = (lo + hi) / 2;
    const p = { x: lastValid.x + (tq.x - lastValid.x) * mid, y: lastValid.y + (tq.y - lastValid.y) * mid };
    if (valid(p)) lo = mid; else hi = mid;
  }
  let best = quantizeVec2({ x: lastValid.x + (tq.x - lastValid.x) * lo, y: lastValid.y + (tq.y - lastValid.y) * lo });
  if (!valid(best)) best = quantizeVec2(lastValid);
  return best;
}

// ------------------------------------------------------------------ impact preview and derived status

const hardIds = (r: ValidationResult): Set<string> => {
  const s = new Set<string>();
  for (const v of r.violations) {
    if (v.severity !== 'hard') continue;
    for (const id of v.involvedObjectIds) s.add(id);
    for (const id of v.involvedFixtureIds ?? []) s.add(id);
  }
  return s;
};

export interface Impact {
  /** Objects (furniture and fixtures) that are hard-invalid after the edit but were not before: "N objects will need attention". */
  newlyInvalid: string[];
  /** Everything hard-invalid after the edit. */
  allInvalid: string[];
}

/**
 * Pre-commit impact of a wall edit (B1, A3). It runs the SAME `validateRoom` that re-validates after the commit, on the
 * hypothetical room, so what the preview promises is what the edit does. The edit still commits either way.
 */
export function impactOf(project: Project, roomId: string, candidate: RoomGeometryState): Impact {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return { newlyInvalid: [], allInvalid: [] };
  const before = hardIds(validateRoom(room, project.furnitureDefinitions));
  const after = hardIds(validateRoom({ ...room, ...candidate }, project.furnitureDefinitions));
  return {
    newlyInvalid: [...after].filter((id) => !before.has(id)).sort(),
    allInvalid: [...after].sort(),
  };
}

export type DerivedStatus = 'ok' | 'soft' | 'hard';

/** Every furniture instance and fixture in the project with its derived status (never stored, Spec rule 4). */
export function deriveStatus(project: Project): Map<string, DerivedStatus> {
  const out = new Map<string, DerivedStatus>();
  for (const room of project.rooms) {
    for (const f of room.furniture) out.set(f.id, 'ok');
    for (const f of room.fixtures) out.set(f.id, 'ok');
    const rank = (s: DerivedStatus): number => (s === 'hard' ? 2 : s === 'soft' ? 1 : 0);
    for (const v of validateRoom(room, project.furnitureDefinitions).violations) {
      const status: DerivedStatus = v.severity === 'hard' ? 'hard' : 'soft';
      for (const id of [...v.involvedObjectIds, ...(v.involvedFixtureIds ?? [])]) {
        const cur = out.get(id);
        if (cur !== undefined && rank(status) > rank(cur)) out.set(id, status);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ corner snapping

export interface VertexSnapOptions { grid?: number; snapDistance?: number }

/** Snap candidates for a dragged corner: another corner (100), alignment with another corner's x or y (40), grid (20). */
export function vertexSnapCandidates(room: Room, vertexId: string, pos: Vec2, opts: VertexSnapOptions = {}): SnapCandidate[] {
  const grid = opts.grid ?? DEFAULT_GRID;
  const reach = opts.snapDistance ?? DEFAULT_SNAP_DISTANCE;
  const out: SnapCandidate[] = [];
  const mk = (targetType: SnapCandidate['targetType'], position: Vec2, reason: string): void => {
    out.push({ targetType, position, distance: dist(position, pos), priority: SNAP_PRIORITY[targetType], reason });
  };
  mk('grid', { x: Math.round(pos.x / grid) * grid, y: Math.round(pos.y / grid) * grid }, 'grid');
  for (const v of room.vertices) {
    if (v.id === vertexId) continue;
    mk('wall_endpoint', { ...v.position }, `corner ${v.id}`);
    mk('alignment', { x: v.position.x, y: pos.y }, `x aligned with ${v.id}`);
    mk('alignment', { x: pos.x, y: v.position.y }, `y aligned with ${v.id}`);
  }
  return out.filter((c) => c.distance <= reach);
}
