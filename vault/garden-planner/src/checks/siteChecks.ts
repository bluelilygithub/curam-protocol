// Checks about the built garden rather than the plants: path width, gate swing, mower access. None of these uses plant data, except a gate
// blocked by a plant (the plant's size is part of the reason, so that message carries the draft label).
import { footprintCorners } from '@planner-core/engine/footprints';
import { pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { circleOverlapsPolygon, fmt, gateSwingSector, polygonsOverlap } from './geom';
import { withDraftLabel } from './draft';
import type { Placed } from './plantChecks';
import type { CheckSettings, Issue } from './types';
import { polylineLength, sampleShape } from '../domain/shapes';
import type { GardenProject, Structure, Vec2 } from '../domain/types';

// ---------------------------------------------------------------- paths

export function pathWidthIssues(p: GardenProject, s: CheckSettings): Issue[] {
  const out: Issue[] = [];
  for (const pa of p.paths) {
    if (pa.points.length < 2 || pa.width >= s.pathMinWidth - 1e-9) continue;
    const mid = pa.points[Math.floor(pa.points.length / 2)];
    out.push({
      id: `path_width:${pa.id}`, type: 'path_width', severity: 'warning', title: 'Path too narrow', usesPlantData: false, items: [{ kind: 'path', id: pa.id }], at: mid,
      message: `"${pa.name}" is ${fmt(pa.width, 2)} m wide (${fmt(polylineLength(pa.points), 0)} m long). Paths need at least ${fmt(s.pathMinWidth, 2)} m to walk comfortably, and a wheelbarrow or mower needs about ${fmt(s.mowerWidth, 2)} m.`,
      fix: { kind: 'replace', sel: { kind: 'path', id: pa.id }, next: { ...pa, width: s.pathMinWidth }, label: `Widen to ${fmt(s.pathMinWidth, 2)} m` },
    });
  }
  return out;
}

// ---------------------------------------------------------------- gates

const SOLID_FOR_GATE: Array<Structure['kind']> = ['shed', 'deck', 'raised_bed', 'water_tank', 'retaining_wall', 'pool', 'gate'];

function structurePolygon(s: Structure): Vec2[] {
  if (s.kind === 'water_tank') {
    return Array.from({ length: 16 }, (_, i) => ({ x: s.position.x + (s.width / 2) * Math.cos((i / 16) * Math.PI * 2), y: s.position.y + (s.width / 2) * Math.sin((i / 16) * Math.PI * 2) }));
  }
  return footprintCorners({ position: s.position, width: s.width, length: Math.max(s.length, 0.1), rotation: s.rotation });
}

/** What stands in the way of a gate opening toward `swing`, as readable names (empty = clear). */
export function gateBlockers(p: GardenProject, gate: Structure, swing: 1 | -1, plants: Placed[]): { names: string[]; byPlant: boolean } {
  const sector = gateSwingSector(gate.position, gate.width, gate.rotation, swing);
  const names: string[] = [];
  let byPlant = false;
  if (p.house && polygonsOverlap(sector, p.house.vertices.map((v) => v.position))) names.push('the house');
  for (const s of p.structures) {
    if (s.id === gate.id || !SOLID_FOR_GATE.includes(s.kind)) continue;
    if (polygonsOverlap(sector, structurePolygon(s))) names.push(`the ${s.name.toLowerCase()}`);
  }
  for (const pl of plants) {
    if (pl.g.height < 0.3) continue;
    // a tree blocks with its trunk; a shrub or perennial with its foliage near the ground
    const r = pl.g.tree ? pl.g.core : pl.g.radius * 0.8;
    if (circleOverlapsPolygon(pl.inst.position, r, sector)) { names.push(`a ${pl.rec.common[0] ?? pl.rec.botanical}`); byPlant = true; }
  }
  return { names: [...new Set(names)], byPlant };
}

export function gateSwingIssues(p: GardenProject, plants: Placed[]): Issue[] {
  const out: Issue[] = [];
  for (const s of p.structures) {
    if (s.kind !== 'gate') continue;
    const swing = s.swing ?? 1;
    const here = gateBlockers(p, s, swing, plants);
    if (!here.names.length) continue;
    const other = gateBlockers(p, s, swing === 1 ? -1 : 1, plants);
    const list = here.names.join(', ');
    const msg = `The ${s.name.toLowerCase()} cannot open fully: its swing (${fmt(s.width, 2)} m) is blocked by ${list}.`;
    out.push({
      id: `gate_swing:${s.id}`, type: 'gate_swing', severity: 'error', title: 'Gate swing blocked', usesPlantData: here.byPlant, items: [{ kind: 'structure', id: s.id }], at: s.position,
      message: here.byPlant ? withDraftLabel(`${msg} The plant's size at maturity is part of the reason.`) : msg,
      ...(other.names.length === 0 ? { fix: { kind: 'replace' as const, sel: { kind: 'structure' as const, id: s.id }, next: { ...s, swing: swing === 1 ? -1 : 1 }, label: 'Swing the other way' } } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------- mower access

/**
 * Can a mower of `mowerWidth` get from a gate (or an open stretch of fence) to each lawn? A grid over the plot: cells inside the house,
 * sheds, decks, tanks, pools or any bed are blocked, as is everything outside the boundary except the gate and open fence gaps; a cell is
 * passable only if there is at least half the mower's width of clear space around it. Lawns the flood fill from the exits cannot reach are
 * reported. An approximation (it does not model turning circles or steps), good enough to catch a lawn walled in by beds and a narrow gate.
 */
export function mowerAccessIssues(p: GardenProject, s: CheckSettings): Issue[] {
  if (!p.boundary || p.lawns.length === 0) return [];
  const poly = p.boundary.vertices.map((v) => v.position);
  const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
  const margin = 1; // a metre outside the plot, so a gate in the fence has somewhere to lead
  const x0 = Math.min(...xs) - margin, y0 = Math.min(...ys) - margin, x1 = Math.max(...xs) + margin, y1 = Math.max(...ys) + margin;
  let cell = 0.2;
  while (((x1 - x0) / cell) * ((y1 - y0) / cell) > 90000) cell *= 1.25;
  const nx = Math.ceil((x1 - x0) / cell), ny = Math.ceil((y1 - y0) / cell);
  const at = (i: number, j: number): Vec2 => ({ x: x0 + (i + 0.5) * cell, y: y0 + (j + 0.5) * cell });
  const idx = (i: number, j: number): number => j * nx + i;

  const blocked = new Uint8Array(nx * ny);
  const solids: Vec2[][] = [];
  if (p.house) solids.push(p.house.vertices.map((v) => v.position));
  for (const st of p.structures) if (['shed', 'deck', 'water_tank', 'pool', 'retaining_wall'].includes(st.kind)) solids.push(structurePolygon(st));
  for (const b of p.beds) solids.push(sampleShape(b.shape));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = at(i, j);
      let b = !pointInPolygonInclusive(c, poly, 0);
      if (!b) for (const sp of solids) if (pointInPolygonInclusive(c, sp, 0)) { b = true; break; }
      blocked[idx(i, j)] = b ? 1 : 0;
    }
  }

  // exits: gates wide enough for the mower, and gaps in the fence
  const exits: Vec2[][] = [];
  let anyGate = false;
  for (const st of p.structures) {
    if (st.kind !== 'gate') continue;
    anyGate = true;
    if (st.width + 1e-9 < s.mowerWidth) continue; // too narrow to be an exit
    exits.push(footprintCorners({ position: st.position, width: st.width, length: 1.2, rotation: st.rotation }));
  }
  const v = p.boundary.vertices;
  for (let k = 0; k < v.length; k++) {
    const seg = p.boundary.segments[k];
    if (seg && seg.fence !== 'open') continue;
    const a = v[k].position, b = v[(k + 1) % v.length].position;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    if (len < s.mowerWidth) continue;
    exits.push(footprintCorners({ position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, width: len, length: 1.2, rotation: Math.atan2(dy, dx) }));
  }
  const isExit = new Uint8Array(nx * ny);
  for (const e of exits) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (pointInPolygonInclusive(at(i, j), e, 0)) isExit[idx(i, j)] = 1;
  for (let k = 0; k < isExit.length; k++) if (isExit[k]) blocked[k] = 0;

  // clearance: distance (in cells) to the nearest blocked cell, by a two-pass chamfer; passable = at least half the mower width from any block
  const INF = 1e9;
  const d = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = blocked[k] ? 0 : INF;
  const D = 1, D2 = Math.SQRT2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = idx(i, j);
    if (!d[k]) continue;
    if (i > 0) d[k] = Math.min(d[k], d[idx(i - 1, j)] + D);
    if (j > 0) d[k] = Math.min(d[k], d[idx(i, j - 1)] + D);
    if (i > 0 && j > 0) d[k] = Math.min(d[k], d[idx(i - 1, j - 1)] + D2);
    if (i < nx - 1 && j > 0) d[k] = Math.min(d[k], d[idx(i + 1, j - 1)] + D2);
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = idx(i, j);
    if (!d[k]) continue;
    if (i < nx - 1) d[k] = Math.min(d[k], d[idx(i + 1, j)] + D);
    if (j < ny - 1) d[k] = Math.min(d[k], d[idx(i, j + 1)] + D);
    if (i < nx - 1 && j < ny - 1) d[k] = Math.min(d[k], d[idx(i + 1, j + 1)] + D2);
    if (i > 0 && j < ny - 1) d[k] = Math.min(d[k], d[idx(i - 1, j + 1)] + D2);
  }
  // half the mower's width, less a little for the grid's resolution (a gate exactly as wide as the mower must still count)
  const need = Math.max(0, s.mowerWidth / 2 - 0.6 * cell) / cell;
  const passable = new Uint8Array(nx * ny);
  for (let k = 0; k < passable.length; k++) passable[k] = isExit[k] || (!blocked[k] && d[k] >= need) ? 1 : 0;

  // flood fill from every exit cell
  const reached = new Uint8Array(nx * ny);
  const stack: number[] = [];
  for (let k = 0; k < isExit.length; k++) if (isExit[k]) { reached[k] = 1; stack.push(k); }
  while (stack.length) {
    const k = stack.pop() as number;
    const i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const nk = idx(ni, nj);
      if (passable[nk] && !reached[nk]) { reached[nk] = 1; stack.push(nk); }
    }
  }

  const out: Issue[] = [];
  const noExit = exits.length === 0;
  for (const lawn of p.lawns) {
    const lp = sampleShape(lawn.shape);
    let anyPassable = false, anyReached = false;
    for (let j = 0; j < ny && !anyReached; j++) for (let i = 0; i < nx; i++) {
      const k = idx(i, j);
      if (!passable[k] || isExit[k]) continue;
      if (!pointInPolygonInclusive(at(i, j), lp, 0)) continue;
      anyPassable = true;
      if (reached[k]) { anyReached = true; break; }
    }
    if (anyReached) continue;
    const mid = { x: lp.reduce((a, q) => a + q.x, 0) / lp.length, y: lp.reduce((a, q) => a + q.y, 0) / lp.length };
    const w = fmt(s.mowerWidth, 2);
    let why: string;
    if (!anyPassable) why = `it is narrower than a ${w} m mower, or every part of it is closer than ${fmt(s.mowerWidth / 2, 2)} m to a bed, wall or building`;
    else if (noExit) why = anyGate ? `the only gate is narrower than ${w} m and there is no other opening in the fence` : `there is no gate or opening in the fence at least ${w} m wide`;
    else why = `the way from the gate is blocked or narrower than ${w} m somewhere (beds, buildings or a tight gap)`;
    out.push({
      id: `mower_access:${lawn.id}`, type: 'mower_access', severity: 'warning', title: 'Mower cannot reach the lawn', usesPlantData: false, items: [{ kind: 'lawn', id: lawn.id }], at: mid,
      message: `A ${w} m mower cannot get to "${lawn.name}": ${why}. Widen the gap or the gate, or add a path in.`,
    });
  }
  return out;
}

