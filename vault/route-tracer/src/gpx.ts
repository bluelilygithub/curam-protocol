import { MAX_POINTS, pointCount, simplifyLine, type Line, type Lines } from './geo';

/** GPX import. Parsing is local (the file never leaves the browser until the person saves the track). */

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_STROKES = 2000; // the server's limit on strokes per track
/** The server refuses a body over 1 MB; leave room for the name, notes and colour. */
const MAX_GEOMETRY_BYTES = 900_000;

export interface ParsedGpx {
  name: string | null;
  notes: string | null;
  lines: Lines;
  /** Points with a missing or out-of-range lat / lon, left out. */
  skipped: number;
  /** Waypoints (<wpt>) are not part of a path and are not imported. */
  waypoints: number;
}
export type ParseResult = { ok: true; gpx: ParsedGpx } | { ok: false; error: string };

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6; // about 0.1 m, and it keeps the saved body small

const kids = (el: Element, name: string): Element[] => Array.from(el.children).filter((c) => c.localName === name);
const text = (el: Element | undefined, ...names: string[]): string | null => {
  for (const n of names) {
    const t = el && kids(el, n)[0]?.textContent?.trim();
    if (t) return t;
  }
  return null;
};

/** Tracks (<trk>/<trkseg>/<trkpt>) and routes (<rte>/<rtept>) become strokes. Namespaces and extensions (heart rate etc.) are ignored. */
export function parseGpx(source: string): ParseResult {
  let doc: Document;
  try { doc = new DOMParser().parseFromString(source, 'application/xml'); } catch { return { ok: false, error: 'That file is not a GPX file.' }; }
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length || root.localName !== 'gpx') return { ok: false, error: 'That file is not a GPX file.' };

  let skipped = 0;
  const readLine = (points: Element[]): Line => {
    const line: Line = [];
    for (const p of points) {
      const lat = Number.parseFloat(p.getAttribute('lat') ?? '');
      const lon = Number.parseFloat(p.getAttribute('lon') ?? '');
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped += 1; continue; }
      const q: [number, number] = [round6(lon), round6(lat)];
      const prev = line[line.length - 1];
      if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) line.push(q); // a stop (the same point again and again) is not distance
    }
    return line;
  };

  const lines: Lines = [];
  const tracks = kids(root, 'trk');
  for (const trk of tracks) for (const seg of kids(trk, 'trkseg')) lines.push(readLine(kids(seg, 'trkpt')));
  const routes = kids(root, 'rte');
  for (const rte of routes) lines.push(readLine(kids(rte, 'rtept')));

  const waypoints = kids(root, 'wpt').length;
  const usable = lines.filter((l) => l.length >= 2);
  if (!usable.length) {
    return { ok: false, error: waypoints ? 'That file only has waypoints, no track or route to import.' : 'No track or route with at least two points was found in that file.' };
  }
  if (usable.length > MAX_STROKES) return { ok: false, error: `That file has ${usable.length} separate segments; a track can have at most ${MAX_STROKES}.` };

  const meta = kids(root, 'metadata')[0];
  const first = tracks[0] ?? routes[0];
  const name = (text(first, 'name') ?? text(meta, 'name'))?.slice(0, 120) ?? null;
  const notes = (text(first, 'desc', 'cmt') ?? text(meta, 'desc'))?.slice(0, 2000) ?? null;
  return { ok: true, gpx: { name, notes, lines: usable, skipped, waypoints } };
}

/**
 * Make a long import fit what the server accepts (20,000 points, 1 MB). A phone-recorded track is often a point a second, far more
 * than a map needs. Only when over the limit: simplify with a growing tolerance (from about 10 cm) until it fits. Endpoints are kept.
 */
export function fitToLimit(lines: Lines): { lines: Lines; before: number; after: number } {
  const before = pointCount(lines);
  const fits = (ls: Lines): boolean => pointCount(ls) <= MAX_POINTS && JSON.stringify(ls).length <= MAX_GEOMETRY_BYTES;
  if (fits(lines)) return { lines, before, after: before };
  let tolerance = 1e-6;
  let out = lines;
  for (let i = 0; i < 40 && !fits(out); i += 1) {
    out = lines.map((l) => simplifyLine(l, tolerance));
    tolerance *= 1.8;
  }
  return { lines: out, before, after: pointCount(out) };
}
