import type { Project, ValidationViolation } from '../engine/types';

/** Human name of an object id: its definition name for furniture, "Door"/"Window" for fixtures. */
export function nameOf(project: Project, id: string): string {
  for (const room of project.rooms) {
    const f = room.furniture.find((x) => x.id === id);
    if (f) return project.furnitureDefinitions.find((d) => d.id === f.definitionId)?.name ?? 'Object';
    const fx = room.fixtures.find((x) => x.id === id);
    if (fx) return fx.type === 'door' ? 'Door' : 'Window';
  }
  return 'Object';
}

/** One sentence for the status bar (B5: the primary violation only). */
export function describeViolation(project: Project, v: ValidationViolation): string {
  const subject = v.involvedObjectIds[0] ? nameOf(project, v.involvedObjectIds[0]) : undefined;
  const other = v.involvedObjectIds[1] ? nameOf(project, v.involvedObjectIds[1]) : undefined;
  const fixture = v.involvedFixtureIds?.[0] ? nameOf(project, v.involvedFixtureIds[0]) : 'door';
  switch (v.type) {
    case 'locked': return `${subject ?? 'Object'} is locked`;
    case 'outside_room': return `${subject ?? 'Object'} is outside the room`;
    case 'fixture_out_of_wall': return `${fixture} does not fit on its wall`;
    case 'door_swing':
      return subject ? `${subject} blocks the ${fixture.toLowerCase()} swing` : 'Door swings overlap';
    case 'fixture_access': return `${subject ?? 'Object'} blocks the ${fixture.toLowerCase()} access zone`;
    case 'physical_collision': return `${subject ?? 'Object'} overlaps ${other ?? 'another object'}`;
    case 'clearance':
      return v.involvedFixtureIds?.length
        ? `${subject ?? 'Object'} clearance reaches the ${fixture.toLowerCase()} swing`
        : `${other ?? 'Object'} is inside ${subject ?? 'an object'}'s clearance zone`;
  }
}

/** Undo-label verbs (B9): "Undo · Move Sofa". */
export const LABELS = {
  move: (n: string) => `Move ${n}`,
  resize: (n: string) => `Resize ${n}`,
  rotate: (n: string) => `Rotate ${n}`,
  place: (n: string) => `Place ${n}`,
  delete: (n: string) => `Delete ${n}`,
  duplicate: (n: string) => `Duplicate ${n}`,
  edit: (n: string) => `Edit ${n}`,
  lock: (n: string, locked: boolean) => `${locked ? 'Lock' : 'Unlock'} ${n}`,
  group: (verb: string, count: number) => `${verb} ${count} objects`,
} as const;
