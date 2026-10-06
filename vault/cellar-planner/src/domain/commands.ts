// Invertible commands for undo and redo. Every change to a cellar is one of these; `apply` is pure and never mutates its input.
import type { CabinetBay, CellarProject, ConstructionRules, CornerOwnershipMode, Room, Termination, Wall } from '../engine';

/** Add (`from: null`), remove (`to: null`) or replace a whole wall, bays included. */
export interface SetWallCommand { type: 'SetWall'; id: string; from: Wall | null; to: Wall | null }
/** Add, remove or replace one bay of a wall (replacing covers every edit to the bay, its modules included). */
export interface SetBayCommand { type: 'SetBay'; wallId: string; id: string; from: CabinetBay | null; to: CabinetBay | null }
/** Change how a wall's run ends (used when corner ownership is worked out). */
export interface WallEnds { startTermination?: Termination; endTermination?: Termination }
export interface SetWallEndsCommand { type: 'SetWallEnds'; wallId: string; from: WallEnds; to: WallEnds }
export interface SetRulesCommand { type: 'SetRules'; from: Partial<ConstructionRules>; to: Partial<ConstructionRules> }
export type RoomPatch = Partial<Pick<Room, 'heightMm' | 'doors' | 'windows' | 'obstructions'>>;
export interface SetRoomCommand { type: 'SetRoom'; from: RoomPatch; to: RoomPatch }
export interface MetaPatch { name?: string; cornerOwnershipMode?: CornerOwnershipMode }
export interface SetMetaCommand { type: 'SetMeta'; from: MetaPatch; to: MetaPatch }
export interface CompositeCommand { type: 'Composite'; commands: Command[] }

export type Command = SetWallCommand | SetBayCommand | SetWallEndsCommand | SetRulesCommand | SetRoomCommand | SetMetaCommand | CompositeCommand;

export class ApplyError extends Error {
  constructor(public readonly code: 'ID_NOT_FOUND' | 'ID_EXISTS' | 'UNKNOWN_COMMAND', message: string) {
    super(`${code}: ${message}`);
    this.name = 'ApplyError';
  }
}

export function inverse(c: Command): Command {
  switch (c.type) {
    case 'SetWall': case 'SetBay': return { ...c, from: c.to, to: c.from } as Command;
    case 'SetWallEnds': case 'SetRules': case 'SetRoom': case 'SetMeta': return { ...c, from: c.to, to: c.from } as Command;
    case 'Composite': return { type: 'Composite', commands: [...c.commands].reverse().map(inverse) };
    default: throw new ApplyError('UNKNOWN_COMMAND', JSON.stringify(c));
  }
}

/** Add, remove or replace one item of a list by id. The same rules for walls and bays. */
function setById<T extends { id: string }>(list: T[], id: string, from: T | null, to: T | null, what: string): T[] {
  const at = list.findIndex((x) => x.id === id);
  if (to === null) {
    if (at < 0) throw new ApplyError('ID_NOT_FOUND', `${what}/${id}`);
    return list.filter((_, i) => i !== at);
  }
  if (at < 0) {
    if (from !== null) throw new ApplyError('ID_NOT_FOUND', `${what}/${id}`);
    return [...list, to];
  }
  if (from === null) throw new ApplyError('ID_EXISTS', `${what}/${id}`);
  return list.map((x, i) => (i === at ? to : x));
}

export function apply(c: Command, p: CellarProject): CellarProject {
  switch (c.type) {
    case 'SetWall': return { ...p, room: { ...p.room, walls: setById(p.room.walls, c.id, c.from, c.to, 'wall') } };
    case 'SetBay': {
      if (!p.room.walls.some((w) => w.id === c.wallId)) throw new ApplyError('ID_NOT_FOUND', `wall/${c.wallId}`);
      return { ...p, room: { ...p.room, walls: p.room.walls.map((w) => (w.id === c.wallId ? { ...w, bays: setById(w.bays, c.id, c.from, c.to, 'bay') } : w)) } };
    }
    case 'SetWallEnds': {
      if (!p.room.walls.some((w) => w.id === c.wallId)) throw new ApplyError('ID_NOT_FOUND', `wall/${c.wallId}`);
      return { ...p, room: { ...p.room, walls: p.room.walls.map((w) => (w.id === c.wallId ? { ...w, ...c.to } : w)) } };
    }
    case 'SetRules': return { ...p, rules: { ...p.rules, ...c.to } };
    case 'SetRoom': return { ...p, room: { ...p.room, ...c.to } };
    case 'SetMeta': return { ...p, ...c.to };
    case 'Composite': return c.commands.reduce((acc, sub) => apply(sub, acc), p);
    default: throw new ApplyError('UNKNOWN_COMMAND', JSON.stringify(c));
  }
}

export const setBay = (wallId: string, id: string, from: CabinetBay | null, to: CabinetBay | null): SetBayCommand => ({ type: 'SetBay', wallId, id, from, to });
export const setWall = (id: string, from: Wall | null, to: Wall | null): SetWallCommand => ({ type: 'SetWall', id, from, to });
