// All the checks, in one pass over a garden.
import { dist } from '@planner-core/engine/geometry';
import { boundaryIssue, houseIssue, placedPlants, placementIssue, serviceIssues, spacingIssue, speciesIssues, sunIssue, type SunLookup } from './plantChecks';
import { gateSwingIssues, mowerAccessIssues, pathWidthIssues } from './siteChecks';
import { SEVERITY_ORDER, type CheckSettings, type CheckType, type Issue } from './types';
import type { GardenProject } from '../domain/types';

export * from './types';
export { DRAFT_LABEL, mentionsDraft, withDraftLabel } from './draft';
export { nearestValidPosition } from './fix';
export { makeSunLookup } from './sunLookup';

const MAX_SPACING_ISSUES = 40;
const TYPE_ORDER: CheckType[] = ['placement', 'spacing', 'boundary', 'house_distance', 'service_distance', 'gate_swing', 'path_width', 'mower_access', 'sun', 'climate', 'frost', 'weed', 'pets', 'weed_unknown'];

const movable: ReadonlySet<CheckType> = new Set(['placement', 'boundary', 'house_distance', 'service_distance']);

/**
 * Run every check. `sun` supplies sun hours at a spot (see `makeSunLookup`); without it the sun-mismatch check is skipped.
 * Plant sizes are mature sizes. Every issue that rests on plant data says "draft, unverified".
 */
export function computeChecks(p: GardenProject, s: CheckSettings, sun: SunLookup | null = null): Issue[] {
  const plants = placedPlants(p);
  const out: Issue[] = [];

  for (const pl of plants) {
    for (const issue of [placementIssue(p, pl), boundaryIssue(p, pl), houseIssue(p, pl)]) if (issue) out.push(issue);
    out.push(...serviceIssues(p, pl));
    if (sun) { const si = sunIssue(pl, sun, s); if (si) out.push(si); }
  }

  const spacing: Issue[] = [];
  for (let i = 0; i < plants.length; i++) {
    for (let j = i + 1; j < plants.length; j++) {
      const a = plants[i], b = plants[j];
      if (dist(a.inst.position, b.inst.position) > a.g.radius + b.g.radius) continue;
      const issue = spacingIssue(a, b);
      if (issue) spacing.push(issue);
    }
  }
  spacing.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || x.id.localeCompare(y.id));
  out.push(...spacing.slice(0, MAX_SPACING_ISSUES));
  if (spacing.length > MAX_SPACING_ISSUES) {
    out.push({
      id: 'spacing:more', type: 'spacing', severity: 'info', title: `${spacing.length - MAX_SPACING_ISSUES} more spacing problems`, usesPlantData: true, items: [],
      message: `Only the first ${MAX_SPACING_ISSUES} spacing problems are listed. Fix those, then the rest will appear. Spacing is judged on mature sizes (plant data is draft, unverified).`,
    });
  }

  out.push(...speciesIssues(p, plants));
  out.push(...pathWidthIssues(p, s), ...gateSwingIssues(p, plants), ...mowerAccessIssues(p, s));

  // position problems can be fixed by moving the plant; a crowded pair by moving the later of the two
  for (const issue of out) {
    if (issue.fix) continue;
    if (movable.has(issue.type) && issue.items[0]?.kind === 'plant') {
      issue.fix = { kind: 'move_plant', plantId: issue.items[0].id, label: 'Fix position' };
    } else if (issue.type === 'spacing' && issue.items.length === 2) {
      issue.fix = { kind: 'move_plant', plantId: issue.items[1].id, label: 'Fix position' };
    }
  }

  return out.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type) || x.id.localeCompare(y.id));
}
