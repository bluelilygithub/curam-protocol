'use strict';

// Place lookup for Garden Planner (suburb / postcode -> latitude, longitude, state) through OpenStreetMap's public Nominatim service.
// Written to its usage policy (https://operations.osmfoundation.org/policies/nominatim/, read 2026-10-07):
//   - at most 1 request per second for the WHOLE application, not per user: every lookup goes through this one server-side queue,
//     which spaces upstream calls at least MIN_GAP_MS apart however many users ask at once (and refuses, rather than piles up, when busy)
//   - a valid identifying User-Agent (set here; a browser cannot set one, and stock library agents are not allowed)
//   - no autocomplete / type-ahead: this only answers a deliberate search (the client sends one on a button press, never on typing)
//   - results must be cached: repeats are answered from the cache (memory, then the geocode_cache table) and never reach Nominatim
//   - attribution ("© OpenStreetMap contributors") is returned with every answer for the UI to display
//   - not bulk, not resold: a person looking up their own garden's location, one query at a time
// Override the endpoint with NOMINATIM_URL to point at a self-hosted Nominatim or another provider with the same API.

const MIN_GAP_MS = 1100; // policy says 1 per second; the extra margin covers timer jitter
const MAX_PENDING = 5; // waiting + running; beyond this we answer "busy" instead of queuing without limit
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const MIN_QUERY = 3;
const MAX_QUERY = 120;
const TIMEOUT_MS = 8000;
const ATTRIBUTION = '© OpenStreetMap contributors';

const STATE_BY_NAME = {
  'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD', 'south australia': 'SA', 'western australia': 'WA', tasmania: 'TAS',
  'northern territory': 'NT', 'australian capital territory': 'ACT',
};

class GeocodeError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = 'GeocodeError'; }
}

/** One query, normalised so "  Paddington  QLD" and "paddington qld" share a cache entry. */
function normalizeQuery(q) {
  if (typeof q !== 'string') return null;
  const n = q.trim().replace(/\s+/g, ' ').toLowerCase();
  return n.length >= MIN_QUERY && n.length <= MAX_QUERY ? n : null;
}

function userAgent(env = process.env) {
  const app = (env.APP_URL || '').trim();
  const contact = (env.NOMINATIM_CONTACT || '').trim(); // optional: an email or URL where OSM can reach whoever runs this
  return `CuramVault-GardenPlanner/1.0${app || contact ? ` (${[app && `+${app}`, contact].filter(Boolean).join('; ')})` : ''}`;
}

/** Nominatim rows -> what the app needs. Rows outside Australia or without usable coordinates are dropped. */
function mapResults(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const lat = Number(r.lat), lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (r.address?.country_code && String(r.address.country_code).toLowerCase() !== 'au') continue;
    const label = String(r.display_name ?? '').split(',').slice(0, 3).join(',').trim();
    if (!label) continue;
    const state = STATE_BY_NAME[String(r.address?.state ?? '').toLowerCase()] ?? null;
    out.push({ label, lat, lng, state, postcode: r.address?.postcode ? String(r.address.postcode) : null });
  }
  return out.slice(0, 5);
}

/**
 * @param {object} o
 * @param {Function} [o.fetchFn]  fetch-compatible
 * @param {() => number} [o.now]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {{get(key: string): Promise<any|null>, set(key: string, value: any): Promise<void>}} [o.store] persistent cache
 */
function createGeocoder(o = {}) {
  const fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const baseUrl = o.baseUrl ?? process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org/search';
  const ua = o.userAgent ?? userAgent();
  const memory = new Map(); // key -> { at, results }
  let lastUpstreamAt = 0;
  let chain = Promise.resolve();
  let pending = 0;
  const stats = { upstream: 0, cacheHits: 0 };

  async function cached(key) {
    const m = memory.get(key);
    if (m && now() - m.at < CACHE_TTL_MS) return m.results;
    if (o.store) {
      try {
        const row = await o.store.get(key);
        if (row && now() - row.at < CACHE_TTL_MS) { memory.set(key, row); return row.results; }
      } catch { /* a cache outage must not break lookups */ }
    }
    return null;
  }

  async function upstream(key) {
    const wait = lastUpstreamAt + MIN_GAP_MS - now();
    if (wait > 0) await sleep(wait);
    lastUpstreamAt = now();
    stats.upstream += 1;
    const url = `${baseUrl}?${new URLSearchParams({ format: 'jsonv2', countrycodes: 'au', limit: '5', addressdetails: '1', q: key })}`;
    let res;
    try {
      res = await fetchFn(url, { headers: { 'User-Agent': ua, Accept: 'application/json', 'Accept-Language': 'en-AU' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GeocodeError('unavailable', 'The place lookup service could not be reached.');
    }
    if (res.status === 429 || res.status === 403) throw new GeocodeError('busy', 'The place lookup service is busy. Try again in a minute.');
    if (!res.ok) throw new GeocodeError('unavailable', 'The place lookup service could not answer that.');
    let rows;
    try { rows = await res.json(); } catch { throw new GeocodeError('unavailable', 'The place lookup service sent something unreadable.'); }
    return mapResults(rows);
  }

  return {
    stats, attribution: ATTRIBUTION,
    /** Answer one deliberate search. `cached: true` when it did not touch Nominatim. */
    async search(q) {
      const key = normalizeQuery(q);
      if (!key) throw new GeocodeError('invalid', `Type at least ${MIN_QUERY} letters of a suburb, town or postcode.`);
      const hit = await cached(key);
      if (hit) { stats.cacheHits += 1; return { results: hit, cached: true, attribution: ATTRIBUTION }; }
      if (pending >= MAX_PENDING) throw new GeocodeError('busy', 'Lots of people are looking places up right now. Try again in a few seconds.');
      pending += 1;
      const run = chain.then(async () => {
        const again = await cached(key); // a queued twin of this query may have filled the cache while this one waited
        if (again) { stats.cacheHits += 1; return { results: again, cached: true, attribution: ATTRIBUTION }; }
        const results = await upstream(key);
        const row = { at: now(), results };
        memory.set(key, row);
        if (o.store) { try { await o.store.set(key, row); } catch { /* keep going: memory still has it */ } }
        return { results, cached: false, attribution: ATTRIBUTION };
      });
      chain = run.then(() => undefined, () => undefined); // one failure must not stall the queue
      try { return await run; } finally { pending -= 1; }
    },
  };
}

/** Persistent cache in Postgres (table geocode_cache). */
function pgStore(pool) {
  return {
    async get(key) {
      const { rows } = await pool.query(`SELECT results, "fetchedAt" FROM geocode_cache WHERE query = $1`, [key]);
      return rows[0] ? { at: new Date(rows[0].fetchedAt).getTime(), results: rows[0].results } : null;
    },
    async set(key, row) {
      await pool.query(
        `INSERT INTO geocode_cache (query, results, "fetchedAt") VALUES ($1, $2::jsonb, to_timestamp($3 / 1000.0))
         ON CONFLICT (query) DO UPDATE SET results = EXCLUDED.results, "fetchedAt" = EXCLUDED."fetchedAt"`,
        [key, JSON.stringify(row.results), row.at],
      );
    },
  };
}

module.exports = { createGeocoder, pgStore, normalizeQuery, mapResults, userAgent, GeocodeError, MIN_GAP_MS, MAX_PENDING, ATTRIBUTION, CACHE_TTL_MS };
