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
