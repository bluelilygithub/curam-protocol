// Sun-hours map: for a chosen month, how many hours of direct sun each part of the garden gets on a typical day, given the shadows of the
// house, fences, structures and plants at the current growth stage. Spec 8: full sun 6+ h, part shade 3-6 h, shade under 3 h (the thresholds
// are settings, see plants/suitability.ts). "Sun hours" count only while the sun is at least MIN_SUN_ALTITUDE degrees up.
import { aabbOf, pointInPolygonInclusive } from '@planner-core/engine/geometry';
import { sampleShape } from '../domain/shapes';
import { MID_MONTH_DAY, solarPosition, sunDirectionOnPlan, type Place } from './solar';
import { placeFor } from './timezone';
import { MIN_SUN_ALTITUDE, obstaclesOf, shadowsFor, sunFractionAt } from './shadows';
import type { GardenProject, Vec2 } from '../domain/types';
import type { GrowthStage } from '../plants/growth';
import { sunLevelForHours, type SunThresholds } from '../plants/suitability';
import type { Sun } from '../plants/types';

/** Where the sun is computed for, with the zone's offset for that month (daylight saving included, so clock times match the wall clock). */
export const placeOf = (p: Pick<GardenProject, 'location'>, month: number): Place => placeFor(p.location, month);

export interface SunGrid {
  x0: number; y0: number; cell: number; nx: number; ny: number;
  /** Hours of sun per cell, row by row from y0 upward; NaN where the cell is outside the garden. */
  hours: Float32Array;
  month: number;
  /** Hours of sun that open, unshaded ground gets that day: the most any cell can have. */
  openGroundHours: number;
}

export interface SunOptions {
  stage: GrowthStage;
  month: number;
  /** Minutes between samples (default 20). */
  stepMinutes?: number;
  /** Cell size in metres (default 0.5; made larger for very big gardens to keep the map quick). */
  cell?: number;
}

const MAX_CELLS = 6000;

/** The area worth mapping: the plot, else the house and beds plus a margin. */
export function mapBounds(p: GardenProject): { min: Vec2; max: Vec2 } | null {
  const pts: Vec2[] = [];
  if (p.boundary) pts.push(...p.boundary.vertices.map((v) => v.position));
  if (!pts.length) {
    if (p.house) pts.push(...p.house.vertices.map((v) => v.position));
    for (const b of p.beds) pts.push(...sampleShape(b.shape));
    for (const l of p.lawns) pts.push(...sampleShape(l.shape));
    if (!pts.length) return null;
    const b = aabbOf(pts);
    return { min: { x: b.min.x - 3, y: b.min.y - 3 }, max: { x: b.max.x + 3, y: b.max.y + 3 } };
  }
  return aabbOf(pts);
}

export function computeSunHours(p: GardenProject, o: SunOptions): SunGrid | null {
  const bounds = mapBounds(p);
  if (!bounds) return null;
  const w = bounds.max.x - bounds.min.x, h = bounds.max.y - bounds.min.y;
  let cell = o.cell ?? 0.5;
  if ((w / cell) * (h / cell) > MAX_CELLS) cell = Math.sqrt((w * h) / MAX_CELLS);
  const nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
  const hours = new Float32Array(nx * ny);
  const inside = p.boundary ? p.boundary.vertices.map((v) => v.position) : null;
  const houseOutline = p.house && p.house.vertices.length >= 3 ? p.house.vertices.map((v) => v.position) : null;
  const centres: Array<Vec2 | null> = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = { x: bounds.min.x + (i + 0.5) * cell, y: bounds.min.y + (j + 0.5) * cell };
      const garden = !inside || pointInPolygonInclusive(c, inside);
      centres.push(garden && !(houseOutline && pointInPolygonInclusive(c, houseOutline)) ? c : null); // the house floor is not garden
    }
  }
  const place = placeOf(p, o.month);
  const step = (o.stepMinutes ?? 20) / 60;
  const obstacles = obstaclesOf(p, o.stage, o.month);
  let openGroundHours = 0;
  for (let t = step / 2; t < 24; t += step) {
    const sun = solarPosition(place, o.month, MID_MONTH_DAY, t);
    if (sun.altitude < MIN_SUN_ALTITUDE) continue;
    openGroundHours += step;
    const shadows = shadowsFor(obstacles, sunDirectionOnPlan(sun.azimuth, p.northDeg), sun.altitude);
    for (let k = 0; k < centres.length; k++) {
      const c = centres[k];
      if (c) hours[k] += step * sunFractionAt(c, shadows);
    }
  }
  for (let k = 0; k < centres.length; k++) if (!centres[k]) hours[k] = NaN;
  return { x0: bounds.min.x, y0: bounds.min.y, cell, nx, ny, hours, month: o.month, openGroundHours };
}

/** Hours of sun at one point (nearest cell), or null outside the map. */
export function hoursAt(g: SunGrid, at: Vec2): number | null {
  const i = Math.floor((at.x - g.x0) / g.cell), j = Math.floor((at.y - g.y0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
  const v = g.hours[j * g.nx + i];
  return Number.isNaN(v) ? null : v;
}

/** Average hours of sun over the cells whose centres are inside a polygon (a bed). Null if no cell is inside. */
export function averageHoursIn(g: SunGrid, polygon: Vec2[]): number | null {
  let sum = 0, n = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const v = g.hours[j * g.nx + i];
      if (Number.isNaN(v)) continue;
      if (pointInPolygonInclusive({ x: g.x0 + (i + 0.5) * g.cell, y: g.y0 + (j + 0.5) * g.cell }, polygon)) { sum += v; n++; }
    }
  }
  return n ? sum / n : null;
}

/** Sun hours for a bed in a month, and the light level that means (full sun / part shade / shade). */
export function bedSun(p: GardenProject, bedId: string, o: SunOptions, t: SunThresholds): { hours: number; level: Sun } | null {
  const bed = p.beds.find((b) => b.id === bedId);
  const g = bed ? computeSunHours(p, o) : null;
  if (!bed || !g) return null;
  const hrs = averageHoursIn(g, sampleShape(bed.shape));
  return hrs === null ? null : { hours: hrs, level: sunLevelForHours(hrs, t) };
}

/** Colours for the three light levels (full sun, part shade, shade). Status-style fixed colours: they carry meaning, so they do not follow the theme. */
export const SUN_COLOURS: Record<Sun, [number, number, number]> = {
  full_sun: [250, 190, 40], part_shade: [120, 180, 90], shade: [70, 100, 150],
};
