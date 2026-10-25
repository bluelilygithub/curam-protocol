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

module.exports = { reverseLines, distanceM, bboxOf, validateGeometry, cleanLines, toGpx, toTcx, toKml, MAX_POINTS, MAX_LINES };
