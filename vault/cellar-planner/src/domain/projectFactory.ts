import { DEFAULT_RULES, SCHEMA_VERSION, adjacentWall, runExtent, splitRun, wallLengthMm, type BayModule, type CabinetBay, type CellarProject, type Room, type Wall } from '../engine';

export const randomId = (): string => globalThis.crypto.randomUUID();

/** Tidy a project name: collapse spaces, trim, cut to length, fall back when empty. */
export function cleanName(raw: unknown, fallback: string, max = 80): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  return s || fallback;
}

/** Four walls clockwise from the north-west corner, in room millimetres. All ends meet a room wall until cabinets decide otherwise. */
export function rectangularRoom(lengthMm: number, widthMm: number, heightMm: number): Room {
  const wall = (id: string, start: [number, number], end: [number, number]): Wall => ({ id, start, end, startTermination: 'ROOM_WALL', endTermination: 'ROOM_WALL', bays: [] });
  return {
    heightMm,
    walls: [
      wall('wall-north', [0, 0], [lengthMm, 0]),
      wall('wall-east', [lengthMm, 0], [lengthMm, widthMm]),
      wall('wall-south', [lengthMm, widthMm], [0, widthMm]),
      wall('wall-west', [0, widthMm], [0, 0]),
    ],
    doors: [], windows: [], obstructions: [],
  };
}

export function newCellarProject(name = 'My cellar', id: string = randomId(), room: Room = rectangularRoom(3000, 2500, 2400)): CellarProject {
  return { schemaVersion: SCHEMA_VERSION, id, name: cleanName(name, 'My cellar'), locale: 'en-AU', cornerOwnershipMode: 'LONGEST_WALL_FIRST', rules: { ...DEFAULT_RULES }, room };
}

export interface BayTemplate { outerDepthMm: number; outerHeightMm: number; modules: BayModule[] }

/**
 * Equal bays along a wall, as many as asked, whole millimetres, the remainder in the scribes. A wall that starts or ends at a corner whose
 * other wall already has cabinets yields to them (starts after their depth plus the corner clearance). Ids are `<wallId>-bay-<n>`.
 */
export function fillWall(p: CellarProject, wallId: string, count: number, template: BayTemplate): CabinetBay[] {
  const wall = p.room.walls.find((w) => w.id === wallId);
  if (!wall) throw new RangeError(`no wall ${wallId}`);
  const depthAt = (which: 'start' | 'end'): number => {
    const adj = adjacentWall(wall, which, p.room.walls);
    return adj ? Math.max(0, ...adj.bays.map((b) => b.outerDepthMm)) : 0;
  };
  // the neighbour owns the corner (this wall yields) when it has cabinets and is longer, or equal and earlier in the list (same tie rule as cornerOwner)
  const ownerAt = (which: 'start' | 'end'): boolean => {
    const adj = adjacentWall(wall, which, p.room.walls);
    if (!adj || !adj.bays.length) return false;
    const a = wallLengthMm(adj), b = wallLengthMm(wall);
    return a > b || (a === b && p.room.walls.indexOf(adj) < p.room.walls.indexOf(wall));
  };
  const ext = runExtent(wallLengthMm(wall), ownerAt('start') ? 'CORNER_YIELDS' : 'ROOM_WALL', ownerAt('end') ? 'CORNER_YIELDS' : 'ROOM_WALL', depthAt('start'), depthAt('end'), p.rules);
  const split = splitRun(ext.usableMm, count);
  return Array.from({ length: count }, (_, i) => ({
    id: `${wallId}-bay-${i + 1}`,
    xMm: ext.startOffsetMm + split.startExtraMm + i * split.bayWidthMm,
    widthMm: split.bayWidthMm,
    outerDepthMm: template.outerDepthMm,
    outerHeightMm: template.outerHeightMm,
    modules: template.modules.map((m, j) => ({ ...m, id: `${wallId}-bay-${i + 1}-m${j}` })),
  }));
}
