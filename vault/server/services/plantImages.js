'use strict';

// Plant photos for Garden Planner (spec 6). Finds open-licensed photos of a plant by its botanical name in three places, keeps only what the
// licence filter allows, stores each with its creator, licence and source, and serves them from a cache.
//
//   iNaturalist          api.inaturalist.org            no key; per-photo licences; exact taxon match; best for wild and garden plants
//   Wikimedia Commons    commons.wikimedia.org          no key; per-file licences; best for cultivated exotics and cultivars
//   ALA (biocache)       biocache-ws.ala.org.au         ALA API key (server side only); exact taxon_name; the national database
//
// Rules this file enforces:
//   - Licence filter first (imageLicences.js): nothing is stored or shown without an allowed licence AND a named creator AND a source link.
//   - The Australian Plant Image Index (ANBG/APII, data resource dr413, canbr.gov.au / anbg.gov.au links) is never used: commercial use of
//     those images needs a paid licence. It is excluded by data resource and by text, even if ALA labels a record CC BY.
//   - Herbarium sheets, specimen scans, drawings and maps are dropped; small images (under 600 px wide) are dropped.
//   - Polite: every source is queried one request at a time with a gap (1.1 s), an identifying User-Agent, and backs off after an error.
//     Lookups never block the interface: the first request starts a background fetch and answers "pending"; a later one gets the photos.
//   - Cached 30 days. On refresh a photo that has disappeared from its source, or whose licence no longer allows it, is hidden.
//   - Images are shown from the source's own servers (thumbnails and full size), never copied here. Nothing is modified or cut out in v1.
const { classifyLicence } = require('./imageLicences');
const { userAgent } = require('./geocode');

const MIN_WIDTH = 600;
const GAP_MS = 1100;
const REFRESH_AFTER_MS = 30 * 24 * 3600 * 1000;
const ERROR_RETRY_MS = 3600 * 1000;
const TIMEOUT_MS = 12000;
const ROLES = ['flower', 'foliage', 'plant', 'habitat', 'other'];
const DEFAULT_ROLES = ['flower', 'foliage', 'plant'];
const SOURCE_LABEL = { inaturalist: 'iNaturalist', wikimedia: 'Wikimedia Commons', ala: 'Atlas of Living Australia' };

/** ALA data resources that are never used: the Australian Plant Image Index (ANBG). */
const EXCLUDED_ALA_RESOURCES = new Set(['dr413']);
const EXCLUDED_TEXT = /australian plant image index|\bapii\b|canbr\.gov\.au|anbg\.gov\.au/i;
const NOT_A_PHOTO = /herbarium|herbarien|specimen|holotype|isotype|syntype|type sheet|\bpressed\b|illustration|drawing|\bmap\b|diagram|\blogo\b|\bplate \d|\bscan\b/i;
const PHOTO_EXT = /\.(jpe?g|png|webp)(\?|$)/i;

const stripTags = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** One request at a time per source, at least `gap` ms apart. Never throws on behalf of a failed job: the caller sees its own result. */
function createGate(gap, now, sleep) {
  let chain = Promise.resolve();
  let last = 0;
  return {
    run(fn) {
      const job = chain.then(async () => {
        const wait = last + gap - now();
        if (wait > 0) await sleep(wait);
        last = now();
        return fn();
      });
      chain = job.then(() => undefined, () => undefined);
      return job;
    },
  };
}

// ---------------------------------------------------------------- what a photo is a photo OF

/** flower / foliage / plant (whole plant) / habitat / other, from words in the title, tags and categories. */
function classifyRole(text, phenology) {
  const s = String(text ?? '').toLowerCase();
  if (phenology === 'flowering') return 'flower';
  if (/\b(flowers?|blooms?|blossoms?|inflorescences?|flowering|buds?)\b/.test(s)) return 'flower';
  if (/\b(leaf|leaves|foliage|needles?|fronds?)\b/.test(s)) return 'foliage';
  if (/\b(habitat|landscape|bushland|forest|woodland|plantation|avenue)\b/.test(s)) return 'habitat';
  if (/\b(trees?|shrubs?|plants?|habit|whole|garden|growing|hedge)\b/.test(s)) return 'plant';
  return phenology === 'no_flowering' ? 'plant' : 'other';
}

// ---------------------------------------------------------------- sources: raw candidates

/** iNaturalist: observations of exactly this taxon with a photo licence we might accept. */
async function fromINat(botanical, ctx) {
  const lic = ['cc0', 'cc-by', 'cc-by-sa', ...(ctx.allowNonCommercial ? ['cc-by-nc', 'cc-by-nc-sa'] : [])].join(',');
  const url = `https://api.inaturalist.org/v1/observations?${new URLSearchParams({ taxon_name: botanical, photo_license: lic, quality_grade: 'research,casual', photos: 'true', identified: 'true', per_page: '40', order_by: 'votes', locale: 'en' })}`;
  const body = await ctx.get(url);
  const out = [];
  for (const obs of body.results ?? []) {
    if (String(obs.taxon?.name ?? '').toLowerCase() !== botanical.toLowerCase()) continue; // exact species only: iNaturalist's name search is fuzzy
    const phen = (obs.annotations ?? []).map((a) => String(a.controlled_value?.label ?? '').toLowerCase());
    const phenology = phen.includes('flowering') ? 'flowering' : phen.includes('no evidence of flowering') ? 'no_flowering' : undefined;
    const creator = obs.user?.name || obs.user?.login || '';
    for (const photo of (obs.photos ?? []).slice(0, 2)) {
      if (!photo.url || photo.hidden) continue;
      out.push({
        source: 'inaturalist', sourceId: `photo-${photo.id}`, sourceUrl: obs.uri || `https://www.inaturalist.org/observations/${obs.id}`,
        imageUrl: photo.url.replace('/square.', '/large.'), thumbUrl: photo.url.replace('/square.', '/medium.'),
        creator, licenceRaw: photo.license_code ?? obs.license_code, defaultVersion: '4.0',
        title: obs.species_guess || botanical, text: [...(obs.tags ?? []), obs.description ?? ''].join(' '), phenology,
        width: photo.original_dimensions?.width ?? null, height: photo.original_dimensions?.height ?? null,
      });
    }
  }
  return out;
}

/** Wikimedia Commons: files whose title or categories name the species, with the licence read from the file's own metadata. */
async function fromWikimedia(botanical, ctx) {
  const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: `"${botanical}" filetype:bitmap`, gsrnamespace: '6', gsrlimit: '30',
    prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '640', format: 'json', formatversion: '2',
  })}`;
  const body = await ctx.get(url);
  const out = [];
  const needle = botanical.toLowerCase();
  for (const page of body.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const m = info.extmetadata ?? {};
    const hay = `${page.title} ${m.Categories?.value ?? ''} ${m.ObjectName?.value ?? ''}`.toLowerCase();
    if (!hay.includes(needle)) continue; // it must be about this plant, not just contain a search word
    out.push({
      source: 'wikimedia', sourceId: `page-${page.pageid}`, sourceUrl: info.descriptionurl,
      imageUrl: info.url, thumbUrl: info.thumburl || info.url,
      creator: stripTags(m.Artist?.value) || stripTags(m.Credit?.value), licenceRaw: m.LicenseUrl?.value || m.LicenseShortName?.value,
      title: stripTags(m.ObjectName?.value) || page.title.replace(/^File:/, ''), text: `${m.Categories?.value ?? ''} ${stripTags(m.ImageDescription?.value)}`,
      width: info.width ?? null, height: info.height ?? null,
    });
  }
  return out;
}

/** ALA: exact-taxon occurrences with images, licence at record level. Needs the ALA key. iNaturalist records are skipped (fetched directly). */
async function fromALA(botanical, ctx) {
  const params = new URLSearchParams({ q: `taxon_name:"${botanical}"`, pageSize: '50', fl: 'occurrenceID,images,license,recordedBy,collector,dataResourceUid,dataResourceName,scientificName' });
  params.append('fq', 'multimedia:Image');
  params.append('fq', `-dataResourceUid:(${[...EXCLUDED_ALA_RESOURCES].join(' OR ')})`);
  const body = await ctx.get(`https://biocache-ws.ala.org.au/ws/occurrences/search?${params}`, ctx.env.ALA_API_KEY ? { 'x-api-key': ctx.env.ALA_API_KEY } : {});
  const out = [];
  for (const occ of body.occurrences ?? []) {
    if (EXCLUDED_ALA_RESOURCES.has(occ.dataResourceUid)) continue;
    if (/inaturalist\.org/i.test(String(occ.occurrenceID ?? ''))) continue; // the same photos come straight from iNaturalist
    if (String(occ.scientificName ?? '').toLowerCase() !== botanical.toLowerCase()) continue;
    const creator = (occ.recordedBy ?? occ.collector ?? [])[0] ?? '';
    const sourceUrl = /^https?:\/\//.test(String(occ.occurrenceID ?? '')) ? occ.occurrenceID : `https://biocache.ala.org.au/occurrences/search?q=${encodeURIComponent(`taxon_name:"${botanical}"`)}`;
    for (const id of (occ.images ?? []).slice(0, 2)) {
      out.push({
        source: 'ala', sourceId: `image-${id}`, sourceUrl, imageUrl: `https://images.ala.org.au/image/${id}/original`, thumbUrl: `https://images.ala.org.au/image/${id}/thumbnail_large`,
        creator, licenceRaw: occ.license, title: botanical, text: `${occ.dataResourceName ?? ''} ${occ.dataResourceUid ?? ''}`, width: null, height: null,
      });
    }
  }
  return out;
}

const SOURCES = {
  inaturalist: { fetch: fromINat, enabled: () => true },
  wikimedia: { fetch: fromWikimedia, enabled: () => true },
  // Spec 6.1: ALA needs an API key (kept server side). It works without one today, but we hold to the spec until a key is set,
  // unless ALA_ALLOW_ANONYMOUS=true is set deliberately.
  ala: { fetch: fromALA, enabled: (env) => Boolean(env.ALA_API_KEY) || env.ALA_ALLOW_ANONYMOUS === 'true' },
};

// ---------------------------------------------------------------- accept or reject a candidate

/** Returns the image record to store, or `{ rejected: 'why' }`. */
function acceptCandidate(c, o = {}) {
  const env = o.env ?? process.env;
  const hay = `${c.title ?? ''} ${c.text ?? ''} ${c.sourceUrl ?? ''}`;
  if (EXCLUDED_TEXT.test(`${hay} ${c.imageUrl ?? ''}`)) return { rejected: 'Australian Plant Image Index (ANBG): commercial use needs a paid licence' };
  const lic = classifyLicence(c.licenceRaw, { env, sourceDefaultVersion: c.defaultVersion, allowNonCommercial: o.allowNonCommercial });
  if (!lic.allowed) return { rejected: `licence: ${lic.reason}` };
  if (!String(c.creator ?? '').trim()) return { rejected: 'no creator to credit' };
  if (!c.sourceUrl || !c.imageUrl) return { rejected: 'no source link' };
  if (c.source !== 'ala' && !PHOTO_EXT.test(c.imageUrl)) return { rejected: 'not a jpeg, png or webp photo' };
  if (c.width !== null && c.width !== undefined && c.width < (o.minWidth ?? MIN_WIDTH)) return { rejected: `under ${o.minWidth ?? MIN_WIDTH} px wide` };
  if (NOT_A_PHOTO.test(`${c.title ?? ''} ${c.text ?? ''}`)) return { rejected: 'herbarium sheet, specimen scan, drawing or map' };
  return {
    source: c.source, sourceId: c.sourceId, sourceUrl: c.sourceUrl, imageUrl: c.imageUrl, thumbUrl: c.thumbUrl || c.imageUrl,
    creator: String(c.creator).trim(), licenceCode: lic.code, licenceUrl: lic.url, displayOnly: lic.displayOnly, nonCommercial: lic.nonCommercial,
    title: String(c.title ?? '').slice(0, 200), role: classifyRole(`${c.title} ${c.text}`, c.phenology), width: c.width ?? null, height: c.height ?? null,
    modified: false,
  };
}

// ---------------------------------------------------------------- the service

const creditOf = (img) => `Photo: ${img.creator}, ${img.licenceCode} via ${SOURCE_LABEL[img.source] ?? img.source}`;

/** What the client sees of an image (no internals). */
function publicImage(img, defaultRoles = []) {
  return {
    id: String(img.id), source: img.source, sourceLabel: SOURCE_LABEL[img.source] ?? img.source, sourceUrl: img.sourceUrl,
    imageUrl: img.imageUrl, thumbUrl: img.thumbUrl, creator: img.creator, licenceCode: img.licenceCode, licenceUrl: img.licenceUrl,
    displayOnly: Boolean(img.displayOnly), title: img.title, role: img.role, width: img.width, height: img.height, modified: Boolean(img.modified),
    credit: creditOf(img), defaultFor: defaultRoles,
  };
}

const quality = (img) => (img.width ?? 800) + (img.licenceCode === 'CC0 1.0' || img.licenceCode === 'Public domain' ? 300 : 0) - (img.displayOnly ? 100 : 0);

/**
 * @param {object} o
 * @param {object} o.store    listImages(plantId), upsertImage(plantId, img) -> id, updateImage(id, patch), getLookup, saveLookup, getImage
 * @param {(plantId: string) => string|null} o.names  botanical name for a plant id (the server's own list: clients cannot ask for arbitrary names)
 * @param {string[]} [o.allIds]  every plant id the server knows (for the curator overview and "fetch the missing ones")
 */
function createPlantImageService(o) {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const fetchFn = o.fetchFn ?? ((...a) => fetch(...a));
  const log = o.log ?? null;
  const ua = o.userAgent ?? userAgent(env);
  const allowNC = env.ALLOW_NONCOMMERCIAL === 'true';
  const gates = {};
  const gateFor = (s) => (gates[s] ??= createGate(o.gapMs ?? GAP_MS, now, sleep));
  const inflight = new Map();
  const enabledSources = () => Object.keys(SOURCES).filter((s) => SOURCES[s].enabled(env) && (!o.only || o.only.includes(s)));

  const get = (source) => async (url, extraHeaders = {}) => gateFor(source).run(async () => {
    let res;
    try { res = await fetchFn(url, { headers: { 'User-Agent': ua, Accept: 'application/json', ...extraHeaders }, signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (e) { throw new Error(`${source}: could not be reached`); }
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
    return res.json();
  });

  async function refresh(plantId) {
    const name = o.names(plantId);
    if (!name) return { status: 'unknown_plant' };
    const sources = enabledSources();
    const accepted = [], rejected = [];
    const succeeded = new Set();
    const errors = [];
    for (const s of sources) {
      try {
        const cands = await SOURCES[s].fetch(name, { get: get(s), env, allowNonCommercial: allowNC });
        succeeded.add(s);
        for (const c of cands) {
          const r = acceptCandidate(c, { env, allowNonCommercial: allowNC });
          if (r.rejected) rejected.push({ source: s, sourceId: c.sourceId, why: r.rejected }); else accepted.push(r);
        }
      } catch (e) {
        errors.push(e.message);
        if (log) log.warn({ source: s, plantId, err: e.message }, 'plant image source failed');
      }
    }
    if (succeeded.size === 0) { await o.store.saveLookup(plantId, { status: 'error', fetchedAt: now(), error: errors.join('; ').slice(0, 300) }); return { status: 'error', errors }; }

    const existing = await o.store.listImages(plantId);
    const key = (i) => `${i.source}/${i.sourceId}`;
    const byKey = new Map(existing.map((i) => [key(i), i]));
    const seen = new Set();
    for (const img of accepted) {
      seen.add(key(img));
      const had = byKey.get(key(img));
      if (!had) { await o.store.upsertImage(plantId, { ...img, hidden: false, fetchedAt: now() }); continue; }
      // known photo: refresh its details (a licence or creator can change); bring back one hidden only because it had gone or lost its licence
      const patch = { ...img, fetchedAt: now() };
      if (had.hidden && (had.hiddenReason === 'removed-or-relicensed')) { patch.hidden = false; patch.hiddenReason = null; }
      await o.store.updateImage(had.id, patch);
    }
    // a photo from a source that answered, but not in this answer, has been removed or no longer has an allowed licence: hide it
    for (const had of existing) {
      if (!succeeded.has(had.source) || seen.has(key(had)) || had.hidden) continue;
      await o.store.updateImage(had.id, { hidden: true, hiddenReason: 'removed-or-relicensed', defaultFor: null });
    }
    await o.store.saveLookup(plantId, { status: 'ok', fetchedAt: now(), error: errors.length ? errors.join('; ').slice(0, 300) : null });
    return { status: 'ok', accepted: accepted.length, rejected, errors };
  }

  function startRefresh(plantId) {
    if (inflight.has(plantId)) return inflight.get(plantId);
    const p = refresh(plantId).catch((e) => { if (log) log.error({ err: e, plantId }, 'plant image refresh failed'); return { status: 'error' }; }).finally(() => inflight.delete(plantId));
    inflight.set(plantId, p);
    return p;
  }

  function order(images) {
    const byRole = {};
    for (const img of images) if (img.defaultFor) byRole[img.defaultFor] = img;
    const rest = images.filter((i) => !i.defaultFor).sort((a, b) => quality(b) - quality(a));
    // curated defaults first (flower, foliage, whole plant), then, for roles with no curated default, the best photo of that role, then the rest
    const first = [];
    const roleOf = (r) => byRole[r] ?? rest.find((i) => i.role === r && !first.includes(i));
    for (const r of DEFAULT_ROLES) { const i = roleOf(r); if (i && !first.includes(i)) first.push(i); }
    return [...first, ...rest.filter((i) => !first.includes(i))];
  }

  return {
    refresh, startRefresh, enabledSources,
    /**
     * Photos for a plant, from the cache. Never waits on the network: a stale or missing cache starts a background refresh and the answer says
     * "pending" until it lands.
     */
    async images(plantId) {
      const name = o.names(plantId);
      if (!name) return { status: 'unknown_plant', images: [] };
      if (enabledSources().length === 0) return { status: 'disabled', images: [] };
      const [rows, lookup] = await Promise.all([o.store.listImages(plantId), o.store.getLookup(plantId)]);
      const age = lookup ? now() - lookup.fetchedAt : Infinity;
      const stale = !lookup || age > (lookup.status === 'error' ? ERROR_RETRY_MS : REFRESH_AFTER_MS);
      if (stale) startRefresh(plantId);
      const visible = order(rows.filter((r) => !r.hidden));
      const status = inflight.has(plantId) ? 'pending' : lookup?.status === 'error' ? 'error' : visible.length ? 'ready' : 'none';
      return { status, images: visible.map((i) => publicImage(i, i.defaultFor ? [i.defaultFor] : [])) };
    },

    /** Credits for every photo that could be shown for these plants (spec 6.4). */
    async credits(plantIds) {
      const out = [];
      for (const id of [...new Set(plantIds)].slice(0, 300)) {
        if (!o.names(id)) continue;
        const rows = order((await o.store.listImages(id)).filter((r) => !r.hidden)).slice(0, 20);
        for (const r of rows) out.push({ plantId: id, ...publicImage(r, r.defaultFor ? [r.defaultFor] : []) });
      }
      return out;
    },

    // ---- curator tools (admin)
    /** One row per plant that has anything stored or a lookup on record: how many photos are shown / hidden, how many defaults are set, and the lookup status. */
    async summary() {
      const rows = await o.store.summary();
      return rows.map((r) => ({ plantId: r.plantId, visible: r.visible, hidden: r.hidden, defaults: r.defaults, status: r.status ?? null, fetchedAt: r.fetchedAt ?? null }));
    },
    /** Start a background fetch for every plant that has never been looked up, or whose last lookup failed. Returns how many were queued. */
    async refreshMissing() {
      const ids = o.allIds ?? [];
      const queued = [];
      for (const id of ids) {
        const l = await o.store.getLookup(id);
        if (!l || l.status === 'error') queued.push(id);
      }
      for (const id of queued) startRefresh(id);
      return queued.length;
    },
    /** Every candidate for a plant, hidden ones too. */
    async allImages(plantId) {
      const rows = await o.store.listImages(plantId);
      return rows.map((r) => ({ ...publicImage(r, r.defaultFor ? [r.defaultFor] : []), hidden: Boolean(r.hidden), hiddenReason: r.hiddenReason ?? null }));
    },
    async setHidden(imageId, hidden) {
      const img = await o.store.getImage(imageId);
      if (!img) return null;
      await o.store.updateImage(img.id, { hidden: Boolean(hidden), hiddenReason: hidden ? 'curator' : null, ...(hidden ? { defaultFor: null } : {}) });
      return true;
    },
    /** Make an image the default for flower / foliage / plant (or clear it with imageId = null). One default per role per plant. */
    async setDefault(plantId, role, imageId) {
      if (!DEFAULT_ROLES.includes(role)) throw new Error('role must be flower, foliage or plant');
      const rows = await o.store.listImages(plantId);
      for (const r of rows) if (r.defaultFor === role && String(r.id) !== String(imageId)) await o.store.updateImage(r.id, { defaultFor: null });
      if (imageId === null || imageId === undefined) return true;
      const img = rows.find((r) => String(r.id) === String(imageId));
      if (!img || img.hidden) return null;
      await o.store.updateImage(img.id, { defaultFor: role });
      return true;
    },
    /** Change what an image is a photo of (flower, foliage, ...). */
    async setRole(imageId, role) {
      if (!ROLES.includes(role)) throw new Error('unknown role');
      const img = await o.store.getImage(imageId);
      if (!img) return null;
      await o.store.updateImage(img.id, { role, ...(img.defaultFor && img.defaultFor !== role ? { defaultFor: null } : {}) });
      return true;
    },
  };
}

// ---------------------------------------------------------------- stores

/** In memory (tests, and local runs without a database). */
function createMemoryStore() {
  const images = [];
  const lookups = new Map();
  let seq = 0;
  return {
    images,
    async listImages(plantId) { return images.filter((i) => i.plantId === plantId).map((i) => ({ ...i })); },
    async getImage(id) { const i = images.find((x) => String(x.id) === String(id)); return i ? { ...i } : null; },
    async upsertImage(plantId, img) { const row = { id: ++seq, plantId, hidden: false, hiddenReason: null, defaultFor: null, ...img }; images.push(row); return row.id; },
    async updateImage(id, patch) { const i = images.find((x) => String(x.id) === String(id)); if (i) Object.assign(i, patch); },
    async getLookup(plantId) { return lookups.get(plantId) ?? null; },
    async saveLookup(plantId, l) { lookups.set(plantId, l); },
    async summary() {
      const ids = new Set([...images.map((i) => i.plantId), ...lookups.keys()]);
      return [...ids].sort().map((plantId) => {
        const mine = images.filter((i) => i.plantId === plantId);
        const l = lookups.get(plantId);
        return { plantId, visible: mine.filter((i) => !i.hidden).length, hidden: mine.filter((i) => i.hidden).length, defaults: new Set(mine.filter((i) => !i.hidden && i.defaultFor).map((i) => i.defaultFor)).size, status: l?.status ?? null, fetchedAt: l?.fetchedAt ?? null };
      });
    },
  };
}

const COLS = `id, "plantId", source, "sourceId", "sourceUrl", "imageUrl", "thumbUrl", creator, "licenceCode", "licenceUrl", "displayOnly", "nonCommercial", title, role, width, height, modified, hidden, "hiddenReason", "defaultFor", "fetchedAt"`;
const fromRow = (r) => ({ ...r, fetchedAt: new Date(r.fetchedAt).getTime() });

/** Postgres (tables plant_images and plant_image_lookups). */
function createPgStore(pool) {
  return {
    async listImages(plantId) { const { rows } = await pool.query(`SELECT ${COLS} FROM plant_images WHERE "plantId" = $1 ORDER BY id`, [plantId]); return rows.map(fromRow); },
    async getImage(id) { if (!/^\d{1,10}$/.test(String(id))) return null; const { rows } = await pool.query(`SELECT ${COLS} FROM plant_images WHERE id = $1`, [id]); return rows[0] ? fromRow(rows[0]) : null; },
    async upsertImage(plantId, img) {
      const { rows } = await pool.query(
        `INSERT INTO plant_images ("plantId", source, "sourceId", "sourceUrl", "imageUrl", "thumbUrl", creator, "licenceCode", "licenceUrl", "displayOnly", "nonCommercial", title, role, width, height, modified, hidden, "fetchedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,to_timestamp($17 / 1000.0))
         ON CONFLICT ("plantId", source, "sourceId") DO UPDATE SET "sourceUrl" = EXCLUDED."sourceUrl", "imageUrl" = EXCLUDED."imageUrl", "thumbUrl" = EXCLUDED."thumbUrl",
           creator = EXCLUDED.creator, "licenceCode" = EXCLUDED."licenceCode", "licenceUrl" = EXCLUDED."licenceUrl", "displayOnly" = EXCLUDED."displayOnly", "nonCommercial" = EXCLUDED."nonCommercial", "fetchedAt" = EXCLUDED."fetchedAt"
         RETURNING id`,
        [plantId, img.source, img.sourceId, img.sourceUrl, img.imageUrl, img.thumbUrl, img.creator, img.licenceCode, img.licenceUrl, img.displayOnly, img.nonCommercial, img.title, img.role, img.width, img.height, img.modified, img.fetchedAt],
      );
      return rows[0].id;
    },
    async updateImage(id, patch) {
      const cols = { sourceUrl: '"sourceUrl"', imageUrl: '"imageUrl"', thumbUrl: '"thumbUrl"', creator: 'creator', licenceCode: '"licenceCode"', licenceUrl: '"licenceUrl"', displayOnly: '"displayOnly"', nonCommercial: '"nonCommercial"', title: 'title', role: 'role', width: 'width', height: 'height', hidden: 'hidden', hiddenReason: '"hiddenReason"', defaultFor: '"defaultFor"' };
      const sets = [], vals = [];
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'fetchedAt') { vals.push(v); sets.push(`"fetchedAt" = to_timestamp($${vals.length} / 1000.0)`); continue; }
        if (!cols[k]) continue;
        vals.push(v); sets.push(`${cols[k]} = $${vals.length}`);
      }
      if (!sets.length) return;
      vals.push(id);
      await pool.query(`UPDATE plant_images SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    },
    async getLookup(plantId) {
      const { rows } = await pool.query(`SELECT status, "fetchedAt", "lastError" FROM plant_image_lookups WHERE "plantId" = $1`, [plantId]);
      return rows[0] ? { status: rows[0].status, fetchedAt: new Date(rows[0].fetchedAt).getTime(), error: rows[0].lastError } : null;
    },
    async summary() {
      const { rows } = await pool.query(
        `SELECT COALESCE(i."plantId", l."plantId") AS "plantId",
                COALESCE(i.visible, 0) AS visible, COALESCE(i.hidden, 0) AS hidden, COALESCE(i.defaults, 0) AS defaults, l.status, l."fetchedAt"
           FROM (SELECT "plantId",
                        COUNT(*) FILTER (WHERE NOT hidden) AS visible,
                        COUNT(*) FILTER (WHERE hidden) AS hidden,
                        COUNT(DISTINCT "defaultFor") FILTER (WHERE "defaultFor" IS NOT NULL AND NOT hidden) AS defaults
                   FROM plant_images GROUP BY "plantId") i
           FULL OUTER JOIN plant_image_lookups l ON l."plantId" = i."plantId"
          ORDER BY 1`,
      );
      return rows.map((r) => ({ plantId: r.plantId, visible: Number(r.visible), hidden: Number(r.hidden), defaults: Number(r.defaults), status: r.status ?? null, fetchedAt: r.fetchedAt ? new Date(r.fetchedAt).getTime() : null }));
    },
    async saveLookup(plantId, l) {
      await pool.query(
        `INSERT INTO plant_image_lookups ("plantId", status, "fetchedAt", "lastError") VALUES ($1, $2, to_timestamp($3 / 1000.0), $4)
         ON CONFLICT ("plantId") DO UPDATE SET status = EXCLUDED.status, "fetchedAt" = EXCLUDED."fetchedAt", "lastError" = EXCLUDED."lastError"`,
        [plantId, l.status, l.fetchedAt, l.error ?? null],
      );
    },
  };
}

module.exports = {
  createPlantImageService, createMemoryStore, createPgStore, createGate, acceptCandidate, classifyRole, creditOf, publicImage,
  fromINat, fromWikimedia, fromALA, SOURCES, MIN_WIDTH, GAP_MS, REFRESH_AFTER_MS, ERROR_RETRY_MS, EXCLUDED_ALA_RESOURCES, ROLES, DEFAULT_ROLES,
};
