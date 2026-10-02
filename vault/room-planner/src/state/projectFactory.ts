import { FURNITURE_LIBRARY, SEED_MATERIALS } from '../data/furnitureLibrary';
import type { Project, Room, Vertex, WallSegment } from '../engine/types';

export type IdGen = () => string;

/** Collision-resistant ids for the browser; tests inject a counter instead. */
export const randomId: IdGen = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);

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
