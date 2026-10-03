import { proposeEditWall, type PipelineResult } from './pipeline';
import { deleteVertex, geometryOf, insertVertex, moveVertex, setWallLength, type InsertIds } from './wallEdit';
import { ApplyError, type Project, type RoomGeometryState, type Room, type Vec2 } from './types';

/**
 * Commit-pipeline wrappers for wall / corner editing. Each builds a candidate geometry with `wallEdit.ts` and hands it to
 * `proposeEditWall` (§6a): only polygon validity can reject; furniture and fixtures that become invalid never block the edit.
 */
const same = (a: RoomGeometryState, b: Room): boolean => JSON.stringify(a) === JSON.stringify(geometryOf(b));

function propose(project: Project, room: Room, candidate: RoomGeometryState | null, whenNull: PipelineResult): PipelineResult {
  if (!candidate) return whenNull;
  if (same(candidate, room)) return { rejected: true, violations: [], noop: true };
  return proposeEditWall(project, room.id, candidate);
}

function editable(project: Project): Room {
  const room = project.rooms[0];
  if (!room) throw new ApplyError('ID_NOT_FOUND', 'there is no room to edit');
  return room;
}

const unknown = (what: string): PipelineResult => ({ rejected: true, violations: [], message: `Unknown ${what}` });

export function proposeMoveVertex(project: Project, vertexId: string, to: Vec2): PipelineResult {
  const room = editable(project);
  return propose(project, room, moveVertex(room, vertexId, to), unknown('corner'));
}

export function proposeInsertVertex(project: Project, wallId: string, at: Vec2, ids: InsertIds): PipelineResult {
  const room = editable(project);
  return propose(project, room, insertVertex(room, wallId, at, ids), unknown('wall'));
}

/** Delete a corner. Rejected (with a plain message, no command) when it would leave fewer than three corners. */
export function proposeDeleteVertex(project: Project, vertexId: string): PipelineResult {
  const room = editable(project);
  const candidate = deleteVertex(room, vertexId);
  if (!candidate) {
    return {
      rejected: true, violations: [], polygonError: room.vertices.length < 4 ? 'TOO_FEW_VERTICES' : undefined,
      message: room.vertices.length < 4 ? 'A room needs at least three corners' : 'Unknown corner',
    };
  }
  return propose(project, room, candidate, unknown('corner'));
}

export function proposeSetWallLength(project: Project, wallId: string, length: number): PipelineResult {
  const room = editable(project);
  return propose(project, room, setWallLength(room, wallId, length), unknown('wall'));
}
