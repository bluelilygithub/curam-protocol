'use strict';

/**
 * Route Tracer "Places near this route": significant buildings, landmarks and entertainment venues within X km of ANY point on a route.
 * The data is OpenStreetMap's, asked of an Overpass server (OVERPASS_URL) with the route as a polyline, so it does not depend on what the
 * map happens to be showing. Only the (simplified) route line and a distance leave the server, never who asked.
 *
 * Kept deliberately modest: the route is simplified before it is sent, the area asked about is capped, answers are cached, there is one
 * request at a time, and the results are ranked (places with a Wikipedia or Wikidata entry first) and capped per category, so a long route
 * through a city gives its notable places and not every church.
 */

const CATEGORIES = [
  { id: 'landmarks', label: 'Landmarks and attractions', color: '#d9480f' },
  { id: 'museums', label: 'Museums and galleries', color: '#7048e8' },
  { id: 'shows', label: 'Theatres and cinemas', color: '#c2255c' },
  { id: 'sport', label: 'Stadiums and arenas', color: '#2b8a3e' },
  { id: 'fun', label: 'Zoos and theme parks', color: '#e8590c' },
  { id: 'nightlife', label: 'Nightclubs and casinos', color: '#9c36b5' },
  { id: 'worship', label: 'Notable places of worship', color: '#5f3dc4' },
  { id: 'civic', label: 'Civic buildings and libraries', color: '#1971c2' },
  { id: 'campus', label: 'Universities and hospitals', color: '#0b7285' },
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

// One Overpass clause per tag key (the route polyline is repeated per clause, so few clauses keeps the question small); classify() sorts them out.
const CLAUSES = [
  ['tourism', ['attraction', 'viewpoint', 'museum', 'gallery', 'zoo', 'aquarium', 'theme_park']],
  ['historic', ['monument', 'memorial', 'castle', 'ruins', 'fort', 'lighthouse', 'archaeological_site']],
  ['amenity', ['arts_centre', 'theatre', 'cinema', 'nightclub', 'casino', 'events_venue', 'place_of_worship', 'townhall', 'courthouse', 'library', 'university', 'hospital', 'planetarium']],
  ['leisure', ['stadium', 'water_park']],
  ['man_made', ['lighthouse']],
];

const RADIUS_MIN_KM = 0.1;
const RADIUS_MAX_KM = 10;
const MAX_ROUTE_KM = 200;
const MAX_AREA_KM2 = 1500; // route length x 2 x distance: what Overpass is asked to search
const MAX_INPUT_POINTS = 20000;
const SEND_POINTS = 120;
const PER_CATEGORY = 40;
const MAX_RAW = 1500;
const CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 40;
const FETCH_TIMEOUT_MS = 30000; // one server only
const TRY_TIMEOUT_MS = 18000; // each of several servers: a dead one is given up on quickly so the next can answer
// the public Overpass servers (OpenStreetMap data), tried in this order; OVERPASS_URL (one address, or several separated by commas) replaces them
const DEFAULT_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

class PlacesError extends Error { constructor(status, message) { super(message); this.status = status; } }

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversineM(a, b) {
  const dLat = rad(b[1] - a[1]); const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isPos = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Metres from point p to the segment a-b (flat maths about the segment, fine at these distances). */
function distToSegmentM(p, a, b) {
  const k = Math.cos(rad((a[1] + b[1]) / 2));
  const px = (p[0] - a[0]) * k; const py = p[1] - a[1];
  const bx = (b[0] - a[0]) * k; const by = b[1] - a[1];
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return haversineM(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
}
function distToLineM(p, line) {
  if (line.length === 1) return haversineM(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) best = Math.min(best, distToSegmentM(p, line[i - 1], line[i]));
  return best;
}

/** The route as one list of points, checked, de-duplicated and thinned (Douglas-Peucker, tolerance grown until it fits) to at most `max`. */
function prepareLine(input, max = SEND_POINTS) {
  if (!Array.isArray(input) || input.length < 2) throw new PlacesError(400, 'Choose a route first: open a track, or plan one.');
  if (input.length > MAX_INPUT_POINTS) throw new PlacesError(400, 'That route has too many points.');
  const pts = [];
  for (const p of input) {
    if (!isPos(p)) throw new PlacesError(400, 'The route has a point that is not on the map.');
    const q = [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
  }
  if (pts.length < 2) throw new PlacesError(400, 'Choose a route that goes somewhere.');
  let tol = 0.00002; // degrees, about 2 m
  let line = pts;
  while (line.length > max) { line = simplify(pts, tol); tol *= 1.6; }
  return line;
}

function simplify(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0; let idx = -1;
    for (let i = s + 1; i < e; i += 1) {
      const d = flatDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > -1 && maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function flatDist(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function lineKm(line) { let m = 0; for (let i = 1; i < line.length; i += 1) m += haversineM(line[i - 1], line[i]); return m / 1000; }

function checkRadius(radiusKm) {
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm < RADIUS_MIN_KM || radiusKm > RADIUS_MAX_KM) {
    throw new PlacesError(400, `Choose a distance from ${RADIUS_MIN_KM} to ${RADIUS_MAX_KM} km.`);
  }
  return Math.round(radiusKm * 1000) / 1000;
}

/** The Overpass question. Coordinates are latitude, longitude, as Overpass wants them. */
function buildQuery(line, radiusM) {
  const poly = line.map((p) => `${p[1]},${p[0]}`).join(',');
  const clauses = CLAUSES.map(([key, values]) => `  nwr(around:${Math.round(radiusM)},${poly})["name"]["${key}"~"^(${values.join('|')})$"];`);
  return `[out:json][timeout:25];\n(\n${clauses.join('\n')}\n);\nout center tags ${MAX_RAW};`;
}

const notable = (t) => !!(t.wikidata || t.wikipedia);

/** The category of one OSM element by its tags, or null if it is not one we show. Places of worship must be notable: a suburb has dozens of churches. */
function classify(tags) {
  if (!tags || typeof tags !== 'object') return null;
  const { tourism, historic, amenity, leisure, man_made: manMade } = tags;
  if (amenity === 'place_of_worship') return notable(tags) || tags.building === 'cathedral' || tags.building === 'basilica' ? 'worship' : null;
  if (tourism === 'museum' || tourism === 'gallery' || amenity === 'arts_centre') return 'museums';
  if (amenity === 'theatre' || amenity === 'cinema' || amenity === 'planetarium') return 'shows';
  if (leisure === 'stadium') return 'sport';
  if (tourism === 'zoo' || tourism === 'aquarium' || tourism === 'theme_park' || leisure === 'water_park') return 'fun';
  if (amenity === 'nightclub' || amenity === 'casino' || amenity === 'events_venue') return 'nightlife';
  if (amenity === 'townhall' || amenity === 'courthouse' || amenity === 'library') return 'civic';
  if (amenity === 'university' || amenity === 'hospital') return 'campus';
  if (tourism === 'attraction' || tourism === 'viewpoint' || historic || manMade === 'lighthouse') return 'landmarks';
  return null;
}

const score = (t) => (t.wikidata ? 3 : 0) + (t.wikipedia ? 2 : 0) + (t.tourism === 'attraction' ? 1 : 0) + (t.heritage ? 1 : 0);

/** Overpass elements -> ranked, capped places with their distance from the route. */
function rank(elements, line, radiusM) {
  const byKey = new Map();
  for (const el of Array.isArray(elements) ? elements : []) {
    if (!el || typeof el !== 'object') continue;
    const tags = el.tags && typeof el.tags === 'object' ? el.tags : null;
    const name = tags && typeof tags.name === 'string' ? tags.name.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const lat = Number(el.lat ?? el.center?.lat); const lng = Number(el.lon ?? el.center?.lon);
    if (!name || !isPos([lng, lat])) continue;
    const category = classify(tags);
    if (!category) continue;
    const distM = distToLineM([lng, lat], line);
    if (distM > radiusM * 1.02) continue;
    const key = `${category}|${name.toLowerCase()}|${Math.round(lat * 500)}|${Math.round(lng * 500)}`; // a building and its outline are one place
    const place = { id: `${el.type ?? 'x'}${el.id ?? ''}`, name, category, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, distKm: Math.round(distM) / 1000, notable: notable(tags), _s: score(tags) };
    const prev = byKey.get(key);
    if (!prev || place._s > prev._s) byKey.set(key, place);
  }
  const perCat = {};
  const out = [];
  let truncated = false;
  for (const p of [...byKey.values()].sort((a, b) => b._s - a._s || a.distKm - b.distKm)) {
    perCat[p.category] = (perCat[p.category] || 0) + 1;
    if (perCat[p.category] > PER_CATEGORY) { truncated = true; continue; }
    const { _s, ...rest } = p; void _s;
    out.push(rest);
  }
  out.sort((a, b) => a.distKm - b.distKm);
  const counts = {}; for (const id of CATEGORY_IDS) counts[id] = out.filter((p) => p.category === id).length;
  return { places: out, counts, truncated };
}

/** The service: one at a time, cached, with a plain-language error for every way Overpass can say no. */
function createPlacesService({ fetchFn = (...a) => fetch(...a), now = Date.now, getUrl, getUrls = () => (process.env.OVERPASS_URL ? process.env.OVERPASS_URL.split(',').map((u) => u.trim()).filter(Boolean) : DEFAULT_URLS), log = () => {}, userAgent = () => `VaultRouteTracer/1.0 (${process.env.APP_URL || 'https://curam-vault.up.railway.app'})` } = {}) {
  const cache = new Map();
  let chain = Promise.resolve();
  const queue = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

  async function near({ line: rawLine, radiusKm: rawRadius }) {
    const radiusKm = checkRadius(rawRadius);
    const line = prepareLine(rawLine);
    const km = lineKm(line);
    if (km > MAX_ROUTE_KM) throw new PlacesError(422, `That route is over ${MAX_ROUTE_KM} km. Places can be shown along a route up to ${MAX_ROUTE_KM} km.`);
    if (km * 2 * radiusKm > MAX_AREA_KM2) throw new PlacesError(422, 'That is too much ground to search. Choose a smaller distance for a route this long.');
    const key = `${radiusKm}|${line.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';')}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return { ...hit.value, cached: true };
    const value = await queue(async () => {
      const again = cache.get(key); // another request for the same route may have finished while this waited
      if (again && now() - again.at < CACHE_MS) return again.value;
      const urls = getUrl ? [getUrl()] : getUrls();
      const body = `data=${encodeURIComponent(buildQuery(line, radiusKm * 1000))}`;
      let res = null;
      let failure = null;
      for (let i = 0; i < urls.length && !res; i += 1) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), urls.length > 1 ? TRY_TIMEOUT_MS : FETCH_TIMEOUT_MS);
        const host = (() => { try { return new URL(urls[i]).host; } catch { return 'places server'; } })();
        try {
          const r = await fetchFn(urls[i], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent(), Accept: 'application/json' }, body, signal: ctl.signal });
          // busy or broken servers (429, 5xx) are not the end: the next one may answer. A refusal of the query itself (4xx) will be the same everywhere.
          if (r.status === 429 || r.status >= 500) {
            failure = new PlacesError(r.status === 500 || r.status === 502 ? 502 : 503, r.status === 500 || r.status === 502 ? 'The places service did not answer properly. Try again in a minute.' : 'The places service is busy. Try again in a minute.');
            log('route places: server not usable', `${host} answered ${r.status}`);
          } else res = r;
        } catch (e) {
          const timedOut = e && e.name === 'AbortError';
          failure = new PlacesError(502, timedOut ? 'The places service took too long. Try a smaller distance, or try again in a minute.' : 'The places service could not be reached. Try again in a minute.');
          log('route places: request failed', `${host}: ${e && e.name}: ${e && e.message}${e && e.cause && (e.cause.code || e.cause.message) ? ` (${e.cause.code || e.cause.message})` : ''}`);
        } finally { clearTimeout(timer); }
      }
      if (!res) throw failure;
      if (!res.ok) throw new PlacesError(502, 'The places service did not answer properly. Try again in a minute.');
      let json;
      try { json = await res.json(); } catch { throw new PlacesError(502, 'The places service sent something unreadable. Try again in a minute.'); }
      if (typeof json?.remark === 'string' && /timed out|out of memory|runtime error/i.test(json.remark) && !Array.isArray(json.elements)) throw new PlacesError(503, 'That was too much to search. Choose a smaller distance.');
      const ranked = { ...rank(json?.elements, line, radiusKm * 1000), radiusKm, routeKm: Math.round(km * 10) / 10 };
      cache.set(key, { at: now(), value: ranked });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return ranked;
    });
    return { ...value, cached: false };
  }
  return { near };
}

module.exports = { createPlacesService, PlacesError, CATEGORIES, CATEGORY_IDS, classify, rank, buildQuery, prepareLine, distToLineM, checkRadius, lineKm, RADIUS_MIN_KM, RADIUS_MAX_KM, MAX_ROUTE_KM, MAX_AREA_KM2, PER_CATEGORY };
