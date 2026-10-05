// "Fix position": the nearest spot to a plant where it has no position problems (spacing, boundary, house, services, not inside a building).
import { pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { placedPlants, positionIssues, type Placed } from './plantChecks';
import type { GardenProject, PlantInstance, Vec2 } from '../domain/types';
import { sampleShape } from '../domain/shapes';

export interface NearestSpot {
  to: Vec2;
  /** False when the best spot found still has warnings (a crowded bed): no errors, but not entirely clear. */
  clean: boolean;
}

const MAX_RADIUS = 5;
const STEP = 0.1;

function* rings(from: Vec2): Generator<Vec2> {
  for (let r = STEP; r <= MAX_RADIUS + 1e-9; r += STEP) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.15));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      yield { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
    }
  }
}

/**
 * The closest position within 5 m with no position problems. Tries, in order: inside the same bed with no issues at all; anywhere with no
 * issues; anywhere with no errors (warnings allowed). Returns null if nothing within 5 m works (the plant needs a smaller neighbour, or a
 * different plant).
 */
export function nearestValidPosition(p: GardenProject, plantInstanceId: string): NearestSpot | null {
  const all = placedPlants(p);
  const me = all.find((q) => q.inst.id === plantInstanceId);
  if (!me) return null;
  const others = all.filter((q) => q.inst.id !== plantInstanceId);
  const bed = p.beds.map((b) => sampleShape(b.shape)).find((poly) => pointInPolygonInclusive(me.inst.position, poly, 0));

  const at = (pos: Vec2): Placed => ({ ...me, inst: { ...me.inst, position: pos } as PlantInstance });
  const test = (pos: Vec2, allowWarnings: boolean): boolean => {
    const issues = positionIssues(p, at(pos), others);
    return allowWarnings ? issues.every((i) => i.severity !== 'error') : issues.length === 0;
  };

  if (bed) for (const pos of rings(me.inst.position)) if (pointInPolygonInclusive(pos, bed, 0) && test(pos, false)) return { to: pos, clean: true };
  for (const pos of rings(me.inst.position)) if (test(pos, false)) return { to: pos, clean: true };
  for (const pos of rings(me.inst.position)) if (test(pos, true)) return { to: pos, clean: false };
  return null;
}
