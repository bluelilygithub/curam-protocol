'use strict';

// Route Tracer geometry on the server: the client sends a MultiLineString, the server decides distance / point count / bbox itself and
// ignores any numbers the client sends. Great-circle (haversine) with the same earth radius turf uses (6371.0088 km), so the figure matches
// the client's live readout (route-tracer/src/geo.ts). Pure, no I/O.

const EARTH_RADIUS_M = 6371008.8;
const MAX_POINTS = 20000;
const MAX_LINES = 2000;

const rad = (d) => (d * Math.PI) / 180;

function segmentM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Each line on its own: the gap between two strokes is never counted. */
function distanceM(lines) {
  let m = 0;
  for (const line of lines) for (let i = 1; i < line.length; i += 1) m += segmentM(line[i - 1], line[i]);
  return m;
}

function bboxOf(lines) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const line of lines) for (const [lng, lat] of line) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** The reason a geometry is refused, or null. Expects a GeoJSON MultiLineString. */
function validateGeometry(g) {
  if (!g || typeof g !== 'object' || g.type !== 'MultiLineString' || !Array.isArray(g.coordinates)) return 'The track geometry must be a MultiLineString.';
  const lines = g.coordinates;
  if (!lines.length) return 'Draw at least two points first.';
  if (lines.length > MAX_LINES) return `A track can have at most ${MAX_LINES} strokes.`;
  let points = 0;
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) return 'Every stroke needs at least two points.';
    points += line.length;
    if (points > MAX_POINTS) return `A track can have at most ${MAX_POINTS} points.`;
    for (const p of line) {
      if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return 'A point is not a valid [lng, lat] pair.';
      if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return 'A point is outside the map.';
    }
  }
  return null;
}

/** Keep only [lng, lat] (a client may send altitude etc.), so what is stored is what was measured. */
const cleanLines = (g) => g.coordinates.map((line) => line.map((p) => [p[0], p[1]]));

const XML = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => XML[c]);

/** GPX 1.1, one <trkseg> per stroke. */
function toGpx(name, notes, lines) {
  const segs = lines
    .map((l) => `    <trkseg>\n${l.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n')}\n    </trkseg>`)
    .join('\n');
  const desc = notes ? `\n    <desc>${esc(notes)}</desc>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Route Tracer" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${esc(name)}</name>${desc}\n${segs}\n  </trk>\n</gpx>\n`;
}

module.exports = { distanceM, bboxOf, validateGeometry, cleanLines, toGpx, MAX_POINTS, MAX_LINES };
