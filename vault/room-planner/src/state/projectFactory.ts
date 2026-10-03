import { FURNITURE_LIBRARY, SEED_MATERIALS } from '../data/furnitureLibrary';
import type { Project, Room, Vec2, Vertex, WallSegment } from '../engine/types';

export type IdGen = () => string;

let lastTime = 0;
let sequence = 0;
/**
 * Collision-resistant ids for the browser. They are TIME-ORDERED (a base-36 timestamp, a per-millisecond counter, then random
 * characters), so sorting by id (C18) lists rooms and furniture in the order they were created. Tests inject a counter instead.
 */
export const randomId: IdGen = () => {
  const now = Date.now();
  if (now === lastTime) sequence++; else { lastTime = now; sequence = 0; }
  const random = (globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 12);
  return `${now.toString(36).padStart(9, '0')}${sequence.toString(36).padStart(3, '0')}-${random}`;
};

export function counterIds(prefix = 'id'): IdGen {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(4, '0')}`;
}

export function newProject(newId: IdGen = randomId): Project {
  return {
    schemaVersion: 1,
    id: newId(),
    units: 'metric',
    rooms: [],
    furnitureDefinitions: structuredClone(FURNITURE_LIBRARY),
    materials: structuredClone(SEED_MATERIALS),
  };
}

/**
 * A room from drawn corners (C14): counter-clockwise, default 150 mm walls, ids generated here (outside `apply`). The corners are
 * re-ordered CCW BEFORE the walls are built, so every wall runs in polygon order and its interior normal points into the room.
 */
export function roomFromPoints(points: Vec2[], newId: IdGen = randomId, name = 'Room 1'): Room {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  const ordered = area < 0 ? [...points].reverse() : points;
  const vertices: Vertex[] = ordered.map((p) => ({ id: newId(), position: { x: p.x, y: p.y } }));
  const walls: WallSegment[] = vertices.map((v, i) => ({
    id: newId(), startVertexId: v.id, endVertexId: vertices[(i + 1) % vertices.length].id, thickness: 0.15,
  }));
  return { id: newId(), name, floorElevation: 0, wallHeight: 2.7, ceilingHeight: 2.7, vertices, walls, fixtures: [], furniture: [] };
}

export const DEFAULT_RECT = { width: 4, length: 5 } as const;

/**
 * "Start from a rectangle" (B8): a default 4 × 5 m room, CCW from the origin, with the default 150 mm walls.
 * All vertex, wall and room ids are generated here, outside `apply`, and carried in the CreateRoom command.
 */
export function rectangleRoom(
  newId: IdGen = randomId, width: number = DEFAULT_RECT.width, length: number = DEFAULT_RECT.length, name = 'Room 1',
): Room {
  const vertices: Vertex[] = [
    { id: newId(), position: { x: 0, y: 0 } },
    { id: newId(), position: { x: width, y: 0 } },
    { id: newId(), position: { x: width, y: length } },
    { id: newId(), position: { x: 0, y: length } },
  ];
  const walls: WallSegment[] = vertices.map((v, i) => ({
    id: newId(), startVertexId: v.id, endVertexId: vertices[(i + 1) % 4].id, thickness: 0.15,
  }));
  return {
    id: newId(), name, floorElevation: 0, wallHeight: 2.7, ceilingHeight: 2.7, vertices, walls, fixtures: [], furniture: [],
  };
}
