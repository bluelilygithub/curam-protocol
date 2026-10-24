import bbox from '@turf/bbox';
import { lineString, multiLineString } from '@turf/helpers';
import length from '@turf/length';
import simplify from '@turf/simplify';

/** [lng, lat] */
export type Pos = [number, number];
export type Line = Pos[];
export type Lines = Line[];
export type BBox = [number, number, number, number];
export type Units = 'km' | 'mi';

export const MAX_POINTS = 20000;
const KM_PER_MI = 1.609344;

export const pointCount = (lines: Lines): number => lines.reduce((n, l) => n + l.length, 0);

/** Great-circle length of one line in km. Fewer than two points is 0. */
export function lineKm(line: Line): number {
  return line.length < 2 ? 0 : length(lineString(line), { units: 'kilometers' });
}

/** Total distance in km. Each line is measured on its own, so the gap between two strokes is never counted. */
export function totalKm(lines: Lines): number {
  let sum = 0;
  for (const l of lines) sum += lineKm(l);
  return sum;
}

/** Degrees of longitude per CSS pixel at a MapLibre zoom (512 px tiles); about one screen pixel. */
export const degreesPerPixel = (zoom: number): number => 360 / (512 * 2 ** zoom);

/** Douglas-Peucker at the given tolerance (degrees). Endpoints are always kept. */
export function simplifyLine(line: Line, toleranceDeg: number): Line {
  if (line.length < 3) return line.slice();
  const out = simplify(lineString(line), { tolerance: toleranceDeg, highQuality: true }).geometry.coordinates as Line;
  return out.length >= 2 ? out : [line[0], line[line.length - 1]];
}

/** [minLng, minLat, maxLng, maxLat], or null if there are no points. */
export function bboxOf(lines: Lines): BBox | null {
  const pts = lines.filter((l) => l.length > 0);
  if (!pts.length) return null;
  const b = bbox(multiLineString(pts.map((l) => (l.length === 1 ? [l[0], l[0]] : l))));
  return [b[0], b[1], b[2], b[3]];
}

/** What the readout shows: under 1 km -> metres; else km to 2 decimals. Miles: feet under 0.1 mi; else miles to 2 decimals. */
export function formatDistance(km: number, units: Units): string {
  if (units === 'km') return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
  const mi = km / KM_PER_MI;
  return mi < 0.1 ? `${Math.round(mi * 5280)} ft` : `${mi.toFixed(2)} mi`;
}

/** The reason the geometry is unusable, or null. Mirrors the server's rules. */
export function validateLines(lines: Lines): string | null {
  if (!lines.length || lines.every((l) => l.length < 2)) return 'Draw at least two points first.';
  if (pointCount(lines) > MAX_POINTS) return `A track can have at most ${MAX_POINTS} points.`;
  for (const l of lines) {
    for (const p of l) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return 'A point is outside the map.';
    }
  }
  return null;
}

const XML: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const esc = (s: string): string => s.replace(/[<>&"']/g, (c) => XML[c]);

/** GPX 1.1, one <trkseg> per stroke. */
export function toGpx(name: string, notes: string | null, lines: Lines): string {
  const segs = lines
    .filter((l) => l.length > 0)
    .map((l) => `    <trkseg>\n${l.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n')}\n    </trkseg>`)
    .join('\n');
  const desc = notes ? `\n    <desc>${esc(notes)}</desc>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Route Tracer" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${esc(name)}</name>${desc}\n${segs}\n  </trk>\n</gpx>\n`;
}

// ---- distance markers ----------------------------------------------------------------------------------------------------------

const EARTH_KM = 6371.0088; // the radius turf (and the server) use, so markers agree with the readout
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle length of one segment in km. */
export function segmentKm(a: Pos, b: Pos): number {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * EARTH_KM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const KM_PER_MILE = KM_PER_MI;
/** The marker spacing for the chosen units: every 1 km, or every 1 mi. */
export const stepKmFor = (units: Units): number => (units === 'mi' ? KM_PER_MI : 1);

export interface DistanceMarker { pos: Pos; /** 1 = first step (1 km), 2 = second ... */ n: number }

const MAX_MARKERS = 5000;

/**
 * A marker at every `stepKm` of drawn distance. The distance carries on across strokes (the gap between two strokes is not counted,
 * same as the readout), so marker 5 is where the readout would say 5 km. Positions are interpolated along the segment.
 */
export function markersAlong(lines: Lines, stepKm: number): DistanceMarker[] {
  if (!(stepKm > 0) || totalKm(lines) / stepKm > MAX_MARKERS) return [];
  const out: DistanceMarker[] = [];
  let done = 0; // km covered before the current segment
  let next = stepKm;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const len = segmentKm(a, b);
      while (len > 0 && next <= done + len + 1e-9) {
        const t = Math.min(1, Math.max(0, (next - done) / len));
        out.push({ pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n: Math.round(next / stepKm) });
        next += stepKm;
      }
      done += len;
    }
  }
  return out;
}

/** Ground metres per CSS pixel at a MapLibre zoom (512 px tiles) and latitude. */
export const metersPerPixel = (zoom: number, lat: number): number => (78271.516964 * Math.cos(rad(lat))) / 2 ** zoom;

const THIN = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** Show every Nth marker so labels do not pile up: the smallest N giving at least `minPx` between shown markers and at most `maxCount`. */
export function thinFactor(pxPerStep: number, count: number, minPx = 44, maxCount = 300): number {
  for (const n of THIN) if (pxPerStep * n >= minPx && count / n <= maxCount) return n;
  return THIN[THIN.length - 1];
}

// ---- tap a track: how far along is this point? -------------------------------------------------------------------------------

export interface OnTrack {
  /** The point on the line nearest the tap. */
  pos: Pos;
  /** Distance from the start of the track to `pos`, along the line (km). Strokes join up without counting the gap, as in the readout. */
  km: number;
  totalKm: number;
  /** How far the tap was from the line on screen (px). */
  px: number;
}

/**
 * The point on a track nearest to a screen position, if within maxPx. `project` turns lng/lat into screen px (map.project).
 * The foot of the perpendicular is found on screen and mapped back along the segment, so it matches the line as drawn.
 */
export function nearestOnLines(lines: Lines, project: (p: Pos) => { x: number; y: number }, at: { x: number; y: number }, maxPx: number): OnTrack | null {
  let best: { pos: Pos; km: number; px: number } | null = null;
  let done = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const len = segmentKm(a, b);
      const pa = project(a);
      const pb = project(b);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((at.x - pa.x) * dx + (at.y - pa.y) * dy) / l2));
      const px = Math.hypot(pa.x + dx * t - at.x, pa.y + dy * t - at.y);
      if (px <= maxPx && (!best || px < best.px)) {
        const pos: Pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        best = { pos, km: done + len * t, px };
      }
      done += len;
    }
  }
  return best ? { ...best, totalKm: done } : null;
}

/** The same strokes with the same points (to a millionth of a degree, about 0.1 m): is this still the line the directions were made for? */
export function sameLines(a: Lines, b: Lines, eps = 1e-6): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => l.length === b[i].length && l.every((p, k) => Math.abs(p[0] - b[i][k][0]) <= eps && Math.abs(p[1] - b[i][k][1]) <= eps));
}
