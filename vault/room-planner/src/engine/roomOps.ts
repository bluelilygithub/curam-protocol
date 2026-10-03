import type { Project, Room, SavedView } from './types';

/** Supplies fresh ids (the app passes `randomId`; tests pass a counter). */
export type IdGen = () => string;

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A copy of a room with every id replaced (corners, walls, doors/windows, furniture) and all references remapped, so the copy is
 * independent of the original and valid wherever the original is. Collections stay sorted by id (C18). Pure: the input is untouched.
 */
export function cloneRoom(room: Room, newId: IdGen, name?: string): Room {
  const id = newId();
  const vertex = new Map(room.vertices.map((v) => [v.id, newId()]));
  const wall = new Map(room.walls.map((w) => [w.id, newId()]));
  const map = (m: Map<string, string>, old: string): string => m.get(old) ?? old;
  return {
    ...structuredClone({ ...room, vertices: undefined, walls: undefined, fixtures: undefined, furniture: undefined }),
    id,
    name: name ?? room.name,
    vertices: room.vertices.map((v) => ({ id: map(vertex, v.id), position: { ...v.position } })),
    walls: room.walls.map((w) => ({ ...w, id: map(wall, w.id), startVertexId: map(vertex, w.startVertexId), endVertexId: map(vertex, w.endVertexId) })),
    fixtures: room.fixtures.map((f) => ({ ...structuredClone(f), id: newId(), wallId: map(wall, f.wallId) })).sort(byId),
    furniture: room.furniture.map((f) => ({ ...structuredClone(f), id: newId(), roomId: id })).sort(byId),
  };
}

/** "Room 2", "Room 3", …: the first number not already used as a room name, starting from the room count + 1. */
export function nextRoomName(project: Project): string {
  const used = new Set(project.rooms.map((r) => r.name));
  for (let n = project.rooms.length + 1; ; n++) if (!used.has(`Room ${n}`)) return `Room ${n}`;
}

/**
 * An independent copy of a whole project under a new name: new project id, every room cloned, saved views kept (their room
 * references follow the cloned rooms and each view gets a fresh id). Used by "Duplicate project".
 */
export function cloneProject(project: Project, newId: IdGen, name: string): Project {
  const rooms: Room[] = [];
  const roomMap = new Map<string, string>();
  for (const r of project.rooms) {
    const copy = cloneRoom(r, newId);
    roomMap.set(r.id, copy.id);
    rooms.push(copy);
  }
  const savedViews: SavedView[] | undefined = project.savedViews?.map((v) => ({
    ...structuredClone(v), id: newId(), ...(v.roomId ? { roomId: roomMap.get(v.roomId) ?? v.roomId } : {}),
  }));
  return {
    ...structuredClone({ ...project, rooms: undefined, savedViews: undefined }),
    id: newId(),
    name,
    rooms: rooms.sort(byId),
    ...(savedViews ? { savedViews } : {}),
  };
}

/** A project's display name: its own name, else its first room's, else a default. */
export const projectName = (p: Project): string => (p.name?.trim() || p.rooms[0]?.name || 'Untitled project');

/** Clean a user-typed name: trim, collapse spaces, limit the length; a blank result keeps the fallback. */
export function cleanName(raw: string, fallback: string, max = 80): string {
  const n = raw.trim().replace(/\s+/g, ' ').slice(0, max);
  return n || fallback;
}
