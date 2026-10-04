// Pieces that settle on top of other pieces (a small plant on a side table or sideboard). Pure.
// A "settler" has `settles: true` in its definition. Its height follows what is under its centre: the top of a floor-standing piece
// whose footprint contains the centre, or the floor. Moving a piece carries the settlers resting on it (`ridersOf`).
import { EPSILON } from './coordinates';
import { footprintOf } from './footprints';
import { pointInPolygonInclusive } from './geometry';
import type { FurnitureDefinition, FurnitureInstance, Room, Vec2 } from './types';

/** Settlers only stand on pieces up to this top height (a plant does not go on a wardrobe). */
export const MAX_SUPPORT_TOP = 1.6;
const NOT_SUPPORTS = new Set(['rugs', 'wall art', 'decor', 'lighting']);

export const isSettler = (defs: FurnitureDefinition[], definitionId: string): boolean => !!defs.find((d) => d.id === definitionId)?.settles;

function canSupport(defs: FurnitureDefinition[], o: FurnitureInstance): boolean {
  const cat = defs.find((d) => d.id === o.definitionId)?.category;
  return !!cat && !NOT_SUPPORTS.has(cat) && o.elevation <= 0.05 && o.elevation + o.height <= MAX_SUPPORT_TOP;
}

/** Height a settler should have with its centre at `pos`: the top of the highest piece under it, or 0. */
export function supportElevation(room: Room, defs: FurnitureDefinition[], moving: FurnitureInstance, pos: Vec2): number {
  let top = 0;
  for (const o of room.furniture) {
    if (o.id === moving.id || !canSupport(defs, o)) continue;
    if (pointInPolygonInclusive(pos, footprintOf(o), 0)) top = Math.max(top, o.elevation + o.height);
  }
  return top;
}

/** Settlers resting on any of `carriers` (their centre inside the footprint, their underside at its top). */
export function ridersOf(room: Room, defs: FurnitureDefinition[], carriers: FurnitureInstance[]): FurnitureInstance[] {
  const ids = new Set(carriers.map((c) => c.id));
  return room.furniture.filter((r) =>
    !ids.has(r.id) && isSettler(defs, r.definitionId) && r.elevation > EPSILON &&
    carriers.some((c) => !isSettler(defs, c.definitionId) && Math.abs(r.elevation - (c.elevation + c.height)) < 0.01 && pointInPolygonInclusive(r.position, footprintOf(c), 0)));
}
