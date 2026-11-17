'use strict';

// Live TV (docs/live-tv.md): the channel list behind /live-tv. It comes from the public iptv-org project (https://github.com/iptv-org/iptv),
// which keeps a list of freely available TV streams. Vault fetches the project's JSON files once a day, keeps a trimmed copy in memory and
// never stores or relays any video: the person's browser plays a stream straight from the broadcaster (see liveTvPlayer.js).
//
// What is left out, always: channels marked adult (is_nsfw), channels on the project's blocklist (copyright takedowns and adult channels),
// channels that have closed, and streams with no known channel (nothing says what they are or whether they are adult).

const { fetchPublicFile } = require('../../utils/safeFetch');

const API = 'https://iptv-org.github.io/api';
const FILES = ['channels', 'streams', 'blocklist', 'countries', 'categories'];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;   // fetch a fresh list once a day
const RETRY_AFTER_MS = 10 * 60 * 1000;    // after a failed refresh, keep the old list and try again in 10 minutes

// How a stream can be watched:
//   browser  an https stream with no special headers: the page can try it
//   http     a plain http stream: a browser blocks it on an https page, so it needs VLC (or another player)
//   headers  the stream wants a particular referrer or user agent, which a browser cannot send: it needs VLC
function howToWatch(stream) {
  if (stream.referrer || stream.user_agent) return 'headers';
  if (/^http:\/\//i.test(stream.url)) return 'http';
  return 'browser';
}

const qualityNumber = (q) => Number(String(q || '').replace(/\D/g, '')) || 0;

/** Turn the project's raw files into Vault's trimmed list. Pure: the test calls it with small made-up files. */
function buildCatalogue({ channels, streams, blocklist, countries, categories }, now = new Date()) {
  const blocked = new Set((blocklist || []).map((b) => b.channel));
  const today = now.toISOString().slice(0, 10);
  const keep = new Map();
  for (const c of channels || []) {
    if (!c || !c.id || c.is_nsfw || blocked.has(c.id)) continue;
    if (c.closed && String(c.closed) <= today) continue;
    keep.set(c.id, c);
  }

  const byChannel = new Map();
  for (const s of streams || []) {
    if (!s || !s.channel || !keep.has(s.channel)) continue;
    if (!/^https?:\/\//i.test(String(s.url || ''))) continue;
    const list = byChannel.get(s.channel) || [];
    if (list.some((x) => x.url === s.url)) continue;
    list.push({
      url: s.url,
      title: s.title || '',
      quality: s.quality || '',
      feed: s.feed || '',
      notes: Array.isArray(s.labels) ? s.labels.filter((l) => typeof l === 'string').slice(0, 3) : [],
      how: howToWatch(s),
      // only VLC can send these; they go into the playlist file the page makes (Open in VLC)
      referrer: s.referrer ? String(s.referrer).slice(0, 500) : '',
      userAgent: s.user_agent ? String(s.user_agent).slice(0, 500) : '',
    });
    byChannel.set(s.channel, list);
  }

  const order = { browser: 0, http: 1, headers: 2 };
  const out = [];
  for (const [id, list] of byChannel) {
    const c = keep.get(id);
    list.sort((a, b) => (order[a.how] - order[b.how]) || (qualityNumber(b.quality) - qualityNumber(a.quality)));
    out.push({
      id,
      name: String(c.name || id),
      altNames: Array.isArray(c.alt_names) ? c.alt_names.slice(0, 5) : [],
      network: c.network || '',
      country: c.country || '',
      categories: Array.isArray(c.categories) ? c.categories : [],
      website: /^https?:\/\//i.test(String(c.website || '')) ? c.website : '',
      streams: list.slice(0, 8),
      browserOk: list.some((s) => s.how === 'browser'),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const countryCount = new Map();
  const categoryCount = new Map();
  for (const c of out) {
    countryCount.set(c.country, (countryCount.get(c.country) || 0) + 1);
    for (const cat of c.categories) categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
  }
  const countryList = (countries || [])
    .filter((c) => countryCount.has(c.code))
    .map((c) => ({ code: c.code, name: c.name, flag: c.flag || '', count: countryCount.get(c.code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const categoryList = (categories || [])
    .filter((c) => categoryCount.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, count: categoryCount.get(c.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    channels: out,
    byId: new Map(out.map((c) => [c.id, c])),
    countries: countryList,
    categories: categoryList,
    countryNames: new Map(countryList.map((c) => [c.code, c])),
    fetchedAt: now.toISOString(),
    left: { adultOrBlocked: (channels || []).length - keep.size },
  };
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filter and page the list. `ids` (favourites or recent) keeps that order; otherwise A-Z. */
function filterChannels(cat, { country = '', category = '', q = '', ids = null, browserOnly = false, offset = 0, limit = 60 } = {}) {
  let list = ids ? ids.map((id) => cat.byId.get(id)).filter(Boolean) : cat.channels;
  if (country) list = list.filter((c) => c.country === country);
  if (category) list = list.filter((c) => c.categories.includes(category));
  if (browserOnly) list = list.filter((c) => c.browserOk);
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (words.length) {
    list = list.filter((c) => {
      const hay = norm([c.name, ...c.altNames, c.network, c.id].join(' '));
      return words.every((w) => hay.includes(w));
    });
  }
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(120, Math.max(1, Number(limit) || 60));
  return { total: list.length, channels: list.slice(start, start + size) };
}

// ---- the cached copy ----
let cache = null;          // the built catalogue
let failedAt = 0;          // last failed refresh (so a broken source is not hammered)
let inflight = null;

async function fetchJson(name, fetchFile) {
  const { buffer } = await fetchFile(`${API}/${name}.json`, { maxBytes: 40 * 1024 * 1024, timeoutMs: 45000, accept: 'application/json' });
  const data = JSON.parse(buffer.toString('utf8'));
  if (!Array.isArray(data)) throw new Error(`${name}.json was not a list`);
  return data;
}

/** The current list, fetching it if it is missing or more than a day old. A failed refresh keeps the old list. */
async function getCatalogue({ fetchFile = fetchPublicFile, now = () => Date.now(), force = false } = {}) {
  const age = cache ? now() - Date.parse(cache.fetchedAt) : Infinity;
  const fresh = cache && age < MAX_AGE_MS && !force;
  if (fresh) return cache;
  if (cache && !force && now() - failedAt < RETRY_AFTER_MS) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const files = {};
        for (const name of FILES) files[name] = await fetchJson(name, fetchFile); // one at a time: keeps the memory peak lower
        cache = buildCatalogue(files, new Date(now()));
        failedAt = 0;
        return cache;
      } catch (err) {
        failedAt = now();
        if (cache) return cache;
        throw Object.assign(new Error('The channel list could not be fetched from iptv-org just now. Try again in a few minutes.'), { status: 503, cause: err });
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

function _resetForTests() { cache = null; failedAt = 0; inflight = null; }

module.exports = { buildCatalogue, filterChannels, getCatalogue, howToWatch, MAX_AGE_MS, _resetForTests };
