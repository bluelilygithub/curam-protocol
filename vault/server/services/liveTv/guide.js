'use strict';

// Live TV guide (docs/live-tv.md, "TV guide"): what is on each channel for the next week, programme search and favourite shows.
//
// Where it comes from: iptv-org does not host a guide; its guides.json says, per channel, which outside guide covers it. Vault uses only
// the entries for i.mjh.nz, a free set of ready-made guide files (XMLTV) that covers Australian free-to-air (by city), New Zealand and many
// free streaming channels. An entry's site_id is "<file>#<channel id inside the file>", e.g. "au/Sydney/epg#mjh-gem-nsw" means the file
// https://i.mjh.nz/au/Sydney/epg.xml.gz, channel "mjh-gem-nsw".
//
// What is fetched: the guide is shared by the workspace (programmes are public facts, not anyone's data). Every 6 hours (and on first use)
// it fetches the files that cover the Australian channels for the chosen city plus every channel someone has starred or played in the
// last 14 days, at most MAX_FILES files, and keeps programmes from 3 hours ago to 8 days ahead in live_tv_programmes.

const zlib = require('zlib');
const { fetchPublicFile } = require('../../utils/safeFetch');

const GUIDES_URL = 'https://iptv-org.github.io/api/guides.json';
const FILE_BASE = 'https://i.mjh.nz/';
const REGIONS = ['Sydney', 'Melbourne', 'Brisbane', 'Adelaide', 'Perth', 'Hobart', 'Darwin', 'Canberra'];
const DEFAULT_REGION = 'Sydney';
const REGION_KEY = 'live_tv_guide_region';
const MAX_FILES = 8;
const MAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const KEEP_BEFORE_MS = 3 * 60 * 60 * 1000;
const KEEP_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_XML_BYTES = 120 * 1024 * 1024;

// ---- pure helpers (tested in guide.test.js) ----

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

/** XMLTV time "20261117193000 +1100" (offset optional, UTC if missing) -> Date, or null. */
function parseXmltvTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?/.exec(String(s || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', off] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  if (off && off !== 'Z') {
    const sign = off[0] === '-' ? -1 : 1;
    ms -= sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5))) * 60000;
  }
  return Number.isFinite(ms) ? new Date(ms) : null;
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXml(m[2] ?? m[3]) : '';
};
const firstText = (body, name) => {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body);
  return m ? decodeXml(m[1]) : '';
};

/** Programmes for the wanted channel ids inside [from, to). Reads the file as text: XMLTV is flat, so a careful pattern is enough. */
function parseXmltv(xml, wanted, from, to) {
  const out = [];
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = re.exec(xml))) {
    const head = m[1];
    const id = attr(head, 'channel');
    if (!wanted.has(id)) continue;
    const start = parseXmltvTime(attr(head, 'start'));
    const stop = parseXmltvTime(attr(head, 'stop'));
    if (!start || !stop || stop <= start || stop < from || start >= to) continue;
    const body = m[2];
    const title = firstText(body, 'title').slice(0, 300);
    if (!title) continue;
    const onscreen = /<episode-num\b[^>]*system="onscreen"[^>]*>([\s\S]*?)<\/episode-num>/.exec(body);
    out.push({
      xmltvId: id,
      start,
      stop,
      title,
      subTitle: firstText(body, 'sub-title').slice(0, 300),
      description: firstText(body, 'desc').slice(0, 2000),
      category: firstText(body, 'category').slice(0, 100),
      episode: onscreen ? decodeXml(onscreen[1]).slice(0, 40) : '',
    });
  }
  return out;
}

/** A programme title reduced to a stable key, so "Doctor Who" and "doctor who!" are one show. */
function titleKey(title) {
  return String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 200);
}

/**
 * The i.mjh.nz entries out of guides.json (25 MB, 180,000 entries), without turning the whole file into text or a list: find each
 * '"site":"i.mjh.nz"' in the raw bytes and read just the small flat object around it. Takes a Buffer (or a string, for the tests).
 */
function guideMapFromText(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const needle = Buffer.from('"site":"i.mjh.nz"');
  const map = new Map();
  for (let at = buf.indexOf(needle); at !== -1; at = buf.indexOf(needle, at + needle.length)) {
    const open = buf.lastIndexOf(0x7b, at);   // {
    const close = buf.indexOf(0x7d, at);      // }
    if (open === -1 || close === -1 || close - open > 4000) continue;
    let e;
    try { e = JSON.parse(buf.toString('utf8', open, close + 1)); } catch { continue; }
    if (!e.channel || typeof e.site_id !== 'string') continue;
    const [file, xmltvId] = e.site_id.split('#');
    if (!file || !xmltvId || !/^[A-Za-z0-9_/.-]+$/.test(file) || file.includes('..')) continue;
    const list = map.get(e.channel) || [];
    if (!list.some((x) => x.file === file && x.xmltvId === xmltvId)) list.push({ file, xmltvId });
    map.set(e.channel, list);
  }
  return map;
}

/** The one guide entry used for a channel: the chosen Australian city first, never another Australian city if that one exists. */
function chooseEntry(entries, region) {
  if (!entries || !entries.length) return null;
  const own = entries.find((e) => e.file === `au/${region}/epg`);
  if (own) return own;
  const notCity = entries.find((e) => !/^au\/[A-Za-z]+\/epg$/.test(e.file));
  return notCity || entries[0];
}

/** Which files to fetch, and which channel each (file, id) pair belongs to. The region file always comes first. */
function planFetch(map, channelIds, region, maxFiles = MAX_FILES) {
  const byFile = new Map();
  for (const id of channelIds) {
    const e = chooseEntry(map.get(id), region);
    if (!e) continue;
    const f = byFile.get(e.file) || new Map();
    const ids = f.get(e.xmltvId) || [];
    ids.push(id);
    f.set(e.xmltvId, ids);
    byFile.set(e.file, f);
  }
  const regionFile = `au/${region}/epg`;
  const files = [...byFile.keys()].sort((a, b) => (b === regionFile) - (a === regionFile) || byFile.get(b).size - byFile.get(a).size);
  return { files: files.slice(0, maxFiles), skipped: files.slice(maxFiles), byFile };
}

const fileUrl = (file) => `${FILE_BASE}${file}.xml.gz`;

// ---- the refresh ----

let mapCache = null;       // { map, at }
let lastRun = null;        // { at, ok, files, programmes, skipped, error }
let failedAt = 0;
let running = null;

async function getRegion(pool) {
  const { rows } = await pool.query('SELECT value FROM workspace_settings WHERE key = $1', [REGION_KEY]);
  return REGIONS.includes(rows[0]?.value) ? rows[0].value : DEFAULT_REGION;
}

async function setRegion(pool, region) {
  if (!REGIONS.includes(region)) throw Object.assign(new Error('Choose one of the listed cities.'), { status: 400 });
  await pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt") VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`, [REGION_KEY, region]);
}

async function loadMap(fetchFile, now) {
  if (mapCache && now - mapCache.at < MAP_MAX_AGE_MS) return mapCache.map;
  const { buffer } = await fetchFile(GUIDES_URL, { maxBytes: 60 * 1024 * 1024, timeoutMs: 60000, accept: 'application/json' });
  const map = guideMapFromText(buffer);
  if (!map.size) throw new Error('guides.json had no i.mjh.nz entries');
  mapCache = { map, at: now };
  return map;
}

/** Channels the guide should cover: Australian channels in the list, plus anything starred or played in the last 14 days. */
async function wantedChannels(pool, catalogue) {
  const au = catalogue.channels.filter((c) => c.country === 'AU').map((c) => c.id);
  const { rows } = await pool.query(
    `SELECT "channelId" FROM live_tv_favourites
     UNION SELECT DISTINCT "channelId" FROM live_tv_plays WHERE "playedAt" > NOW() - INTERVAL '14 days'`);
  return [...new Set([...au, ...rows.map((r) => r.channelId)])].filter((id) => catalogue.byId.has(id));
}

async function insertProgrammes(client, rows) {
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    await client.query(
      `INSERT INTO live_tv_programmes ("channelId", start, stop, title, "subTitle", description, category, episode, "titleKey")
       SELECT * FROM UNNEST($1::text[], $2::timestamptz[], $3::timestamptz[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])`,
      [part.map((r) => r.channelId), part.map((r) => r.start), part.map((r) => r.stop), part.map((r) => r.title), part.map((r) => r.subTitle),
        part.map((r) => r.description), part.map((r) => r.category), part.map((r) => r.episode), part.map((r) => titleKey(r.title))]);
  }
}

/**
 * Fetch the guide files and replace the stored programmes for the channels they cover. Never throws: the outcome is kept for
 * GET /guide/status and a failure keeps the old programmes. `deps` lets the test run without the network or the database.
 */
async function refreshGuide({ pool, getCatalogue, fetchFile = fetchPublicFile, now = () => Date.now() } = {}) {
  if (running) return running;
  running = (async () => {
    const started = now();
    try {
      const catalogue = await getCatalogue();
      const region = await getRegion(pool);
      const map = await loadMap(fetchFile, started);
      const channels = await wantedChannels(pool, catalogue);
      const plan = planFetch(map, channels, region);
      const from = new Date(started - KEEP_BEFORE_MS);
      const to = new Date(started + KEEP_AHEAD_MS);
      const rows = [];
      const covered = new Set();
      const failedFiles = [];
      for (const file of plan.files) {
        try {
          const { buffer } = await fetchFile(fileUrl(file), { maxBytes: 15 * 1024 * 1024, timeoutMs: 60000 });
          const xml = zlib.gunzipSync(buffer, { maxOutputLength: MAX_XML_BYTES }).toString('utf8');
          const ids = plan.byFile.get(file);
          for (const p of parseXmltv(xml, new Set(ids.keys()), from, to)) {
            for (const channelId of ids.get(p.xmltvId)) rows.push({ ...p, channelId });
          }
          for (const list of ids.values()) list.forEach((id) => covered.add(id));
        } catch (err) {
          failedFiles.push(`${file}: ${err.message}`);
        }
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM live_tv_programmes WHERE "channelId" = ANY($1::text[]) OR stop < $2', [[...covered], from]);
        await insertProgrammes(client, rows);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally { client.release(); }
      failedAt = failedFiles.length === plan.files.length && plan.files.length ? now() : 0;
      lastRun = { at: new Date(now()).toISOString(), ok: failedFiles.length === 0, region, files: plan.files, skipped: plan.skipped,
        channels: covered.size, programmes: rows.length, failedFiles, seconds: Math.round((now() - started) / 1000) };
      return lastRun;
    } catch (err) {
      failedAt = now();
      lastRun = { at: new Date(now()).toISOString(), ok: false, error: err.message, files: [], channels: 0, programmes: 0 };
      return lastRun;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Start a refresh in the background when the guide is older than 6 hours (or missing), unless one failed in the last 15 minutes. */
async function ensureFresh(deps) {
  if (running) return;
  const now = (deps.now || Date.now)();
  if (failedAt && now - failedAt < RETRY_AFTER_MS) return;
  if (lastRun && lastRun.ok !== false && now - Date.parse(lastRun.at) < REFRESH_EVERY_MS) return;
  if (!lastRun) {
    const { rows } = await deps.pool.query('SELECT MAX("fetchedAt") AS at FROM live_tv_programmes');
    if (rows[0]?.at && now - new Date(rows[0].at).getTime() < REFRESH_EVERY_MS) {
      lastRun = { at: new Date(rows[0].at).toISOString(), ok: true, restored: true };
      return;
    }
  }
  refreshGuide(deps).catch(() => {});
}

const status = () => ({ running: !!running, lastRun });

function _resetForTests() { mapCache = null; lastRun = null; failedAt = 0; running = null; }

module.exports = {
  REGIONS, DEFAULT_REGION, decodeXml, parseXmltvTime, parseXmltv, titleKey, guideMapFromText, chooseEntry, planFetch, fileUrl,
  refreshGuide, ensureFresh, getRegion, setRegion, status, _resetForTests,
};
