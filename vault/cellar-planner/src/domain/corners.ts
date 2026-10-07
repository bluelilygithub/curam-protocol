import { adjacentWall, cornerOwner, wallLengthMm, type CellarProject, type Termination, type Wall } from '../engine';
import { apply, type Command, type SetWallEndsCommand } from './commands';

// Working out who owns each corner (spec-v1.md section 6). Only a corner where BOTH walls have cabinets needs an owner; elsewhere both ends
// simply meet a room wall. In MANUAL mode the person's own choices are left alone.

type End = 'start' | 'end';
const endOf = (w: Wall, which: End): [number, number] => (which === 'start' ? w.start : w.end);
const near = (p: [number, number], q: [number, number]): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 1;
const key = (which: End): 'startTermination' | 'endTermination' => (which === 'start' ? 'startTermination' : 'endTermination');

/** Commands that set the terminations at every corner to match who owns it. Empty when nothing changes. */
export function cornerCommands(p: CellarProject): SetWallEndsCommand[] {
  if (p.cornerOwnershipMode !== 'LONGEST_WALL_FIRST') return [];
  const walls = p.room.walls;
  const want = new Map<string, Termination>(); // `${wallId}:${start|end}` -> termination
  const seen = new Set<string>();
  for (const w of walls) {
    for (const which of ['start', 'end'] as const) {
      const adj = adjacentWall(w, which, walls);
      const mine = `${w.id}:${which}`;
      if (!adj) { want.set(mine, 'ROOM_WALL'); continue; }
      const adjEnd: End = near(adj.start, endOf(w, which)) ? 'start' : 'end';
      const pair = [mine, `${adj.id}:${adjEnd}`].sort().join('|');
      if (seen.has(pair)) continue;
      seen.add(pair);
      if (!w.bays.length || !adj.bays.length) { want.set(mine, 'ROOM_WALL'); want.set(`${adj.id}:${adjEnd}`, 'ROOM_WALL'); continue; }
      const owner = cornerOwner({ id: w.id, lengthMm: wallLengthMm(w) }, { id: adj.id, lengthMm: wallLengthMm(adj) }, 'LONGEST_WALL_FIRST');
      want.set(mine, owner === 'A' ? 'CORNER_OWNS' : 'CORNER_YIELDS');
      want.set(`${adj.id}:${adjEnd}`, owner === 'A' ? 'CORNER_YIELDS' : 'CORNER_OWNS');
    }
  }
  const out: SetWallEndsCommand[] = [];
  for (const w of walls) {
    const from: SetWallEndsCommand['from'] = {}, to: SetWallEndsCommand['to'] = {};
    for (const which of ['start', 'end'] as const) {
      const t = want.get(`${w.id}:${which}`);
      if (t && w[key(which)] !== t) { from[key(which)] = w[key(which)]; to[key(which)] = t; }
    }
    if (Object.keys(to).length) out.push({ type: 'SetWallEnds', wallId: w.id, from, to });
  }
  return out;
}

/** The command plus whatever corner changes it causes, as one step (one undo). */
export function withCorners(p: CellarProject, command: Command): Command {
  const after = apply(command, p);
  const fix = cornerCommands(after);
  return fix.length ? { type: 'Composite', commands: [command, ...fix] } : command;
}
