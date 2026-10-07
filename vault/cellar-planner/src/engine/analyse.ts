import { bayResult } from './capacity';
import { checkBay, checkCorners, checkWall } from './checks';
import { cutListForBay, mergeParts, partTotals, type PartTotals } from './cutlist';
import { adjacentWall, deadCorner, runExtent, wallLengthMm } from './layout';
import type { BayResult, CellarProject, Issue, Part } from './types';

export interface WallAnalysis {
  wallId: string;
  lengthMm: number;
  startOffsetMm: number;
  endOffsetMm: number;
  usableMm: number;
  bays: BayResult[];
  capacity: number;
}

export interface ProjectAnalysis {
  walls: WallAnalysis[];
  totalCapacity: number;
  issues: Issue[];
  parts: Part[];
  totals: PartTotals;
}

/** Everything the headless engine knows about a project: capacity, every check, and the merged cut list. Pure: the same project gives the same answer. */
export function analyseProject(project: CellarProject): ProjectAnalysis {
  const r = project.rules;
  const walls = project.room.walls;
  const issues: Issue[] = [...checkCorners(walls)];
  const wallResults: WallAnalysis[] = [];
  const parts: Part[] = [];

  for (const wall of walls) {
    const length = wallLengthMm(wall);
    const ownerDepth = (which: 'start' | 'end'): number => {
      const adj = adjacentWall(wall, which, walls);
      return adj ? Math.max(0, ...adj.bays.map((b) => b.outerDepthMm)) : 0;
    };
    const ext = runExtent(length, wall.startTermination, wall.endTermination, ownerDepth('start'), ownerDepth('end'), r);
    const bays = wall.bays.map((b) => bayResult(b, r));
    wallResults.push({ wallId: wall.id, lengthMm: length, startOffsetMm: ext.startOffsetMm, endOffsetMm: ext.endOffsetMm, usableMm: ext.usableMm, bays, capacity: bays.reduce((n, b) => n + b.capacity, 0) });

    issues.push(...checkWall(wall, walls, r));
    for (const b of wall.bays) { issues.push(...checkBay(b, project.room.heightMm, r)); parts.push(...cutListForBay(b, r)); }

    // a dead corner is not an error: it is space the yielding wall cannot use, and what that costs
    for (const which of ['start', 'end'] as const) {
      const term = which === 'start' ? wall.startTermination : wall.endTermination;
      const template = wall.bays[0];
      if (term !== 'CORNER_YIELDS' || !template) continue;
      const d = deadCorner(ownerDepth(which), template.outerDepthMm, template, r);
      issues.push({ code: 'DEAD_CORNER', severity: 'info', message: `Dead corner zone (${(d.areaMm2 / 1e6).toFixed(2)} m2). Capacity impact: ${d.lostCapacity} bottles.`, where: wall.id });
    }
  }

  const merged = mergeParts(parts);
  return { walls: wallResults, totalCapacity: wallResults.reduce((n, w) => n + w.capacity, 0), issues, parts: merged, totals: partTotals(merged) };
}
