// Sun hours at a plant's spot for the sun-mismatch check. A plant needs its light all year, so this is the average of four mid-season months
// (March, June, September, December), from the same sun-hours maps the Sun map shows. Two maps per month: one with only the house, fences and
// structures (used for trees, so a tree is not shaded by itself) and one that adds the trees' shade (used for everything else). Shade from
// shrubs on other plants is not counted. The maps only change when the house, fences, structures or trees change, so they are kept.
import type { GardenProject, Vec2 } from '../domain/types';
import { computeSunHours, hoursAt, type SunGrid } from '../sun/sunHours';
import type { SunLookup } from './plantChecks';

export const CHECK_MONTHS = [3, 6, 9, 12] as const;

function structuralSignature(p: GardenProject, withTrees: boolean): string {
  return JSON.stringify([
    p.location.lat, p.location.lng, p.location.state, p.northDeg, p.boundary, p.house, p.structures,
    withTrees ? p.plants.map((q) => [q.id, q.plantId, q.position.x, q.position.y]).filter((q) => treeIds.has(String(q[1]))) : null,
  ]);
}

// plant ids that are trees or palms (filled lazily from the dataset)
import { PLANTS } from '../plants/plants';
const treeIds = new Set(PLANTS.filter((r) => r.type === 'tree' || r.type === 'palm').map((r) => r.id));

const cache = new Map<string, SunGrid[]>();
function gridsFor(p: GardenProject, withTrees: boolean): SunGrid[] {
  const key = structuralSignature(p, withTrees);
  const have = cache.get(key);
  if (have) return have;
  const scoped: GardenProject = { ...p, plants: withTrees ? p.plants.filter((q) => treeIds.has(q.plantId)) : [] };
  const grids = CHECK_MONTHS.map((month) => computeSunHours(scoped, { stage: 'mature', month, stepMinutes: 30 })).filter((g): g is SunGrid => g !== null);
  cache.set(key, grids);
  if (cache.size > 6) cache.delete(cache.keys().next().value as string);
  return grids;
}

/** A lookup of mean sun hours at a point for this garden, or null if the garden has no map (nothing drawn). */
export function makeSunLookup(p: GardenProject): SunLookup | null {
  if (!p.boundary && !p.house && !p.beds.length) return null;
  const bare = gridsFor(p, false);
  if (!bare.length) return null;
  let shaded: SunGrid[] | null = null;
  return (pos: Vec2, isTree: boolean): number | null => {
    const grids = isTree ? bare : (shaded ??= gridsFor(p, true));
    const hs = grids.map((g) => hoursAt(g, pos)).filter((h): h is number => h !== null);
    return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
  };
}

