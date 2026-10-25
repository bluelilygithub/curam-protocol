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

/**
 * TCX 2.0 Course (the format Garmin and Zepp read as a route to follow). A course point needs a time, but a drawn route has none, so
 * the times are made up from distance at a steady walking pace; they only keep the file valid and carry no meaning.
 * The schema limits a course name to 15 characters.
 */
const TCX_PACE_MS = 1.4;
const TCX_EPOCH = Date.UTC(2000, 0, 1);
function toTcx(name, notes, lines) {
  let run = 0;
  let prev = null;
  const pts = [];
  for (const line of lines) {
    line.forEach((p, i) => {
      if (prev && i > 0) run += segmentM(prev, p);
      prev = p;
      const t = new Date(TCX_EPOCH + Math.round((run / TCX_PACE_MS) * 1000)).toISOString();
      pts.push(`        <Trackpoint><Time>${t}</Time><Position><LatitudeDegrees>${p[1]}</LatitudeDegrees><LongitudeDegrees>${p[0]}</LongitudeDegrees></Position><DistanceMeters>${run.toFixed(1)}</DistanceMeters></Trackpoint>`);
    });
    prev = null; // the gap between two strokes is not distance
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n  <Courses>\n    <Course>\n      <Name>${esc(String(name).slice(0, 15))}</Name>\n      <Track>\n${pts.join('\n')}\n      </Track>\n    </Course>\n  </Courses>\n</TrainingCenterDatabase>\n`;
}

/** KML 2.2, one <LineString> per stroke inside a single placemark. */
function toKml(name, notes, lines) {
  const strings = lines
    .map((l) => `      <LineString>\n        <tessellate>1</tessellate>\n        <coordinates>${l.map(([lng, lat]) => `${lng},${lat},0`).join(' ')}</coordinates>\n      </LineString>`)
    .join('\n');
  const desc = notes ? `\n    <description>${esc(notes)}</description>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${esc(name)}</name>\n    <Placemark>\n    <name>${esc(name)}</name>${desc}\n      <MultiGeometry>\n${strings}\n      </MultiGeometry>\n    </Placemark>\n  </Document>\n</kml>\n`;
}

/** The same route walked the other way: the last stroke first, and every stroke's points backwards. The distance is unchanged. */
const reverseLines = (lines) => lines.map((l) => [...l].reverse()).reverse();

/**
 * A saved line thinned to at most `max` waypoints that still follow its shape (for asking the routing service for directions along it):
 * every stroke joined in order, best-first Douglas-Peucker down to `max` points, then neighbours under `minGapM` apart merged.
 * The first and last points are always kept.
 */
function waypointsAlong(lines, max, minGapM = 30) {
  const pts = lines.flat();
  if (pts.length < 2) return pts;
  const mx = (lat) => 111320 * Math.cos(rad(lat));
  const perp = (p, a, b) => { // distance in metres from p to the segment a-b, on a flat patch of the earth
    const k = mx(a[1]);
    const ax = a[0] * k, ay = a[1] * 111320, bx = b[0] * k, by = b[1] * 111320, px = p[0] * k, py = p[1] * 111320;
    const dx = bx - ax, dy = by - ay; const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  // best-first Douglas-Peucker: keep splitting the stretch that strays furthest from a straight line until `max` points are kept, so a long
  // winding track keeps its main bends instead of collapsing to two points
  const worstOf = (i, j) => { let worst = 0; let at = -1; for (let k = i + 1; k < j; k += 1) { const d = perp(pts[k], pts[i], pts[j]); if (d > worst) { worst = d; at = k; } } return { i, j, worst, at }; };
  const keep = new Set([0, pts.length - 1]);
  const open = [worstOf(0, pts.length - 1)];
  while (keep.size < max && open.length) {
    open.sort((x, y) => y.worst - x.worst);
    const top = open.shift();
    if (top.at < 0 || top.worst < 2) break; // what is left is straighter than 2 metres: not worth a waypoint
    keep.add(top.at);
    open.push(worstOf(top.i, top.at), worstOf(top.at, top.j));
  }
  const out = pts.filter((_, k) => keep.has(k));
  const spaced = [out[0]];
  for (let i = 1; i < out.length; i += 1) {
    if (segmentM(spaced[spaced.length - 1], out[i]) >= minGapM) spaced.push(out[i]);
    else if (i === out.length - 1) spaced[spaced.length - 1] = out[i]; // the end of the line always stays
  }
  return spaced.slice(0, max);
}

module.exports = { waypointsAlong, reverseLines, distanceM, bboxOf, validateGeometry, cleanLines, toGpx, toTcx, toKml, MAX_POINTS, MAX_LINES };
