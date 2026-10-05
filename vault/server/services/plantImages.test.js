#!/usr/bin/env node
/**
 * Plant photos: sources, licence enforcement, quality filter, the APII exclusion, polite spacing, caching and refresh, curator rules.
 * Fixtures have the shape of real responses from iNaturalist, Wikimedia Commons and ALA (captured 2026-10-10). No network.
 * Run: node server/services/plantImages.test.js
 */
'use strict';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const assert = require('assert');
const {
  createPlantImageService, createMemoryStore, acceptCandidate, classifyRole, fromINat, fromWikimedia, fromALA, SOURCES, REFRESH_AFTER_MS, ERROR_RETRY_MS, GAP_MS,
} = require('./plantImages');

const DAY = 24 * 3600 * 1000;
let passed = 0, failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------- fixtures (real shapes)
const photo = (id, licence, w = 2048) => ({ id, license_code: licence, original_dimensions: { width: w, height: 1365 }, url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/square.jpeg`, hidden: false });
const obs = (id, taxon, photos, extra = {}) => ({ id, uri: `https://www.inaturalist.org/observations/${id}`, species_guess: 'silk oak', taxon: { name: taxon }, user: { login: `user${id}`, name: `Person ${id}` }, tags: [], description: null, photos, annotations: [], ...extra });
const INAT = {
  results: [
    obs(1, 'Grevillea robusta', [photo(101, 'cc-by'), photo(102, 'cc0')]),
    obs(2, 'Grevillea robusta', [photo(103, 'cc-by-sa')], { annotations: [{ controlled_attribute: { label: 'Plant Phenology' }, controlled_value: { label: 'Flowering' } }] }),
    obs(3, 'Grevillea robusta', [photo(104, 'cc-by-nc')]),
    obs(4, 'Grevillea banksii', [photo(105, 'cc-by')]), // a different species: iNaturalist's name search is fuzzy
    obs(5, 'Grevillea robusta', [photo(106, 'cc-by', 400)]), // too small
    obs(6, 'Grevillea robusta', [photo(107, 'cc-by')], { user: { login: '', name: '' } }), // nobody to credit
    obs(7, 'Grevillea robusta', [photo(108, 'cc-by')], { tags: ['herbarium'], description: 'pressed specimen' }),
  ],
};
const wm = (pageid, title, lic, licUrl, o = {}) => ({
  pageid, title: `File:${title}.jpg`,
  imageinfo: [{ url: `https://upload.wikimedia.org/wikipedia/commons/a/a0/${title.replace(/ /g, '_')}.jpg`, thumburl: `https://thumb.wikimedia.org/${pageid}/640px.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`, width: o.width ?? 4000, height: 3000,
    extmetadata: { LicenseShortName: { value: lic }, LicenseUrl: { value: licUrl }, Artist: { value: o.artist ?? '<a href="//commons.wikimedia.org/wiki/User:Jo" title="User:Jo">Jo Bloggs</a>' }, Categories: { value: o.cats ?? 'Grevillea robusta|Flora of Queensland' }, ObjectName: { value: title }, ImageDescription: { value: o.desc ?? '' } } }],
});
const WIKI = {
  query: {
    pages: [
      wm(11, 'Grevillea robusta inflorescences Gold Coast', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0'),
      wm(12, 'Grevillea robusta tree in a park', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'),
      wm(13, 'Grevillea robusta old print', 'GFDL', ''),
      wm(14, 'Grevillea robusta herbarium sheet', 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'),
      wm(15, 'Grevillea robusta leaves', 'CC BY-NC 4.0', 'https://creativecommons.org/licenses/by-nc/4.0/'),
      wm(16, 'Some cat', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', { cats: 'Cats' }), // not about the plant
      wm(17, 'Grevillea robusta thumbnail', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', { width: 300 }),
      wm(18, 'Grevillea robusta anon', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', { artist: '' }),
    ],
  },
};
const occ = (o) => ({ scientificName: 'Grevillea robusta', dataResourceUid: 'dr19123', dataResourceName: 'NatureMapr', recordedBy: ['Ryu Callaway'], license: 'CC-BY 3.0 (Au)', images: ['img-aaa'], occurrenceID: 'https://naturemapr.org/sightings/1', ...o });
const ALA = {
  occurrences: [
    occ({}),
    occ({ occurrenceID: 'https://www.inaturalist.org/observations/9', images: ['img-inat'], dataResourceUid: 'dr1411' }), // fetched directly from iNaturalist instead
    occ({ dataResourceUid: 'dr413', dataResourceName: 'Australian Plant Image Index', license: 'CC BY 3.0 AU', images: ['img-apii'], occurrenceID: 'https://canbr.gov.au/photo/apii/id/x/475' }),
    occ({ license: 'CC-BY-NC 4.0 (Int)', images: ['img-nc'] }),
    occ({ license: 'UNSPECIFIED', images: ['img-unspec'] }),
    occ({ scientificName: 'Grevillea banksii', images: ['img-other'] }),
    occ({ license: 'CC0', images: ['img-cc0'], occurrenceID: 'urn:catalog:xyz' }),
  ],
};

/** A fake clock, sleep and upstream. `world` can be changed between calls to simulate sources changing. */
function rig(opts = {}) {
  let t = 1_000_000;
  const calls = [];
  const world = { inat: INAT, wiki: WIKI, ala: ALA, fail: new Set(opts.fail ?? []), ...(opts.world ?? {}) };
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    const source = u.hostname.includes('inaturalist') ? 'inaturalist' : u.hostname.includes('wikimedia') ? 'wikimedia' : 'ala';
    calls.push({ source, at: t, url, ua: init.headers['User-Agent'], key: init.headers['x-api-key'] });
    if (world.fail.has(source)) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => world[source === 'inaturalist' ? 'inat' : source === 'wikimedia' ? 'wiki' : 'ala'] };
  };
  const store = createMemoryStore();
  const env = { APP_URL: 'https://vault.example', ...(opts.env ?? {}) };
  const service = createPlantImageService({
    store, env, fetchFn, now: () => t, sleep: async (ms) => { t += ms; }, allIds: ['grevillea-robusta', 'rosa-iceberg', 'never-looked-up'], names: (id) => ({ 'grevillea-robusta': 'Grevillea robusta', 'rosa-iceberg': "Rosa 'Iceberg'", 'never-looked-up': 'Banksia integrifolia' }[id] ?? null),
  });
  return { service, store, calls, world, advance: (ms) => { t += ms; }, now: () => t };
}
const settle = async (r, id = 'grevillea-robusta') => { await r.service.images(id); await r.service.startRefresh(id); return r.service.images(id); };

// ---------------------------------------------------------------- acceptance rules
const cand = (o) => ({ source: 'wikimedia', sourceId: 'x', sourceUrl: 'https://commons.example/x', imageUrl: 'https://upload.example/x.jpg', thumbUrl: 'https://upload.example/t.jpg', creator: 'Jo', licenceRaw: 'CC BY 4.0', title: 'Grevillea robusta', text: '', width: 3000, ...o });
test('a good photo is accepted with creator, licence code and URL, source link and role stored', () => {
  const a = acceptCandidate(cand({ title: 'Grevillea robusta flowers' }), { env: {} });
  assert.strictEqual(a.rejected, undefined);
  assert.deepStrictEqual([a.creator, a.licenceCode, a.licenceUrl, a.sourceUrl, a.role, a.modified], ['Jo', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'https://commons.example/x', 'flower', false]);
});

test('rejected: NC, ND, unknown, "all rights reserved", GFDL (licence), no creator, no source, small, not a photo, herbarium/specimen', () => {
  const why = (o) => acceptCandidate(cand(o), { env: {} }).rejected;
  assert.match(why({ licenceRaw: 'CC BY-NC 4.0' }), /licence.*non-commercial/);
  assert.match(why({ licenceRaw: 'CC BY-ND 4.0' }), /licence.*no-derivatives/);
  assert.match(why({ licenceRaw: 'All rights reserved' }), /licence.*unrecognised/);
  assert.match(why({ licenceRaw: 'GFDL' }), /licence/);
  assert.match(why({ licenceRaw: '' }), /licence/);
  assert.match(why({ creator: '  ' }), /no creator/);
  assert.match(why({ sourceUrl: '' }), /no source link/);
  assert.match(why({ width: 599 }), /under 600 px/);
  assert.strictEqual(why({ width: 600 }), undefined);
  assert.match(why({ imageUrl: 'https://x.example/a.svg' }), /not a jpeg/);
  assert.match(why({ imageUrl: 'https://x.example/a.tif' }), /not a jpeg/);
  assert.match(why({ title: 'Grevillea robusta herbarium sheet' }), /herbarium/);
  assert.match(why({ text: 'type specimen' }), /specimen/);
  assert.match(why({ title: 'Grevillea robusta botanical illustration' }), /illustration|drawing/);
});

test('NC is accepted only when ALLOW_NONCOMMERCIAL is on, and is then flagged; ND never', () => {
  assert.ok(acceptCandidate(cand({ licenceRaw: 'CC BY-NC 4.0' }), { env: {}, allowNonCommercial: true }).nonCommercial);
  assert.ok(acceptCandidate(cand({ licenceRaw: 'CC BY-NC-ND 4.0' }), { env: {}, allowNonCommercial: true }).rejected);
  assert.ok(acceptCandidate(cand({ licenceRaw: 'CC BY-NC 4.0' }), { env: {}, allowNonCommercial: false }).rejected);
});

test('the Australian Plant Image Index (ANBG) is never used, even when labelled CC BY, by data resource or by text', () => {
  assert.match(acceptCandidate(cand({ source: 'ala', licenceRaw: 'CC BY 3.0 AU', text: 'Image in the Australian Plant Image Index (APII)' }), { env: {} }).rejected, /Australian Plant Image Index/);
  assert.match(acceptCandidate(cand({ licenceRaw: 'CC BY 4.0', sourceUrl: 'https://canbr.gov.au/photo/apii/id/x/475' }), { env: {} }).rejected, /Australian Plant Image Index/);
  assert.match(acceptCandidate(cand({ imageUrl: 'https://www.anbg.gov.au/images/photo.jpg' }), { env: {} }).rejected, /Australian Plant Image Index/);
});

test('roles: flower, foliage, plant, habitat, other', () => {
  assert.strictEqual(classifyRole('Grevillea inflorescences Gold Coast'), 'flower');
  assert.strictEqual(classifyRole('Dried leaf of Grevillea'), 'foliage');
  assert.strictEqual(classifyRole('Grevillea robusta tree in a park'), 'plant');
  assert.strictEqual(classifyRole('Grevillea in bushland habitat'), 'habitat');
  assert.strictEqual(classifyRole('IMG_0054'), 'other');
  assert.strictEqual(classifyRole('IMG_0054', 'flowering'), 'flower');
});

// ---------------------------------------------------------------- the three adapters
const ctxFor = (body, o = {}) => ({ get: async () => body, env: {}, allowNonCommercial: false, ...o });

test('iNaturalist: exact species only, per-photo licence, creator, observation link, medium and large URLs', async () => {
  const cands = await fromINat('Grevillea robusta', ctxFor(INAT));
  assert.ok(cands.every((c) => !c.sourceUrl.endsWith('/4')), 'the other species is excluded');
  const c1 = cands.find((c) => c.sourceId === 'photo-101');
  assert.strictEqual(c1.creator, 'Person 1');
  assert.strictEqual(c1.sourceUrl, 'https://www.inaturalist.org/observations/1');
  assert.match(c1.imageUrl, /\/large\.jpeg$/);
  assert.match(c1.thumbUrl, /\/medium\.jpeg$/);
  assert.strictEqual(c1.licenceRaw, 'cc-by');
  assert.strictEqual(c1.defaultVersion, '4.0');
  assert.strictEqual(cands.find((c) => c.sourceId === 'photo-103').phenology, 'flowering');
});

test('Wikimedia: only files about the plant; creator text without HTML; licence from the file', async () => {
  const cands = await fromWikimedia('Grevillea robusta', ctxFor(WIKI));
  assert.ok(!cands.some((c) => c.title === 'Some cat'));
  const c = cands.find((x) => x.sourceId === 'page-12');
  assert.strictEqual(c.creator, 'Jo Bloggs');
  assert.strictEqual(c.licenceRaw, 'https://creativecommons.org/licenses/by/4.0/');
  assert.match(c.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
});

test('ALA: skips APII, skips iNaturalist-origin records (fetched directly), other species; sends the key as a header only', async () => {
  let seen;
  const cands = await fromALA('Grevillea robusta', { get: async (url, headers) => { seen = { url, headers }; return ALA; }, env: { ALA_API_KEY: 'secret-key' }, allowNonCommercial: false });
  const ids = cands.map((c) => c.sourceId);
  assert.ok(!ids.includes('image-img-apii') && !ids.includes('image-img-inat') && !ids.includes('image-img-other'));
  assert.ok(ids.includes('image-img-aaa') && ids.includes('image-img-cc0'));
  assert.strictEqual(seen.headers['x-api-key'], 'secret-key');
  assert.ok(!seen.url.includes('secret-key'), 'the key is never in the URL');
  assert.match(seen.url, /dr413/, 'APII excluded at query time too');
  assert.match(cands[0].thumbUrl, /thumbnail_large$/);
  assert.strictEqual(cands[0].creator, 'Ryu Callaway');
});

// ---------------------------------------------------------------- the service
test('a first request answers "pending" without waiting on the network, then the photos arrive', async () => {
  const r = rig();
  const first = await r.service.images('grevillea-robusta');
  assert.strictEqual(first.status, 'pending');
  assert.deepStrictEqual(first.images, []);
  await r.service.startRefresh('grevillea-robusta');
  const second = await r.service.images('grevillea-robusta');
  assert.strictEqual(second.status, 'ready');
  assert.ok(second.images.length >= 4);
});

test('EVERY stored image has a creator, an allowed licence code and a source link; nothing excluded is stored', async () => {
  const r = rig();
  await settle(r);
  assert.ok(r.store.images.length >= 5);
  const allowed = new Set(['CC0 1.0', 'Public domain', 'CC BY 4.0', 'CC BY-SA 4.0', 'CC BY 3.0 AU', 'CC BY 4.0 AU', 'CC BY 2.5 AU', 'CC BY-SA 3.0 AU']);
  for (const i of r.store.images) {
    assert.ok(i.creator && i.creator.trim(), `creator on ${i.source}/${i.sourceId}`);
    assert.ok(allowed.has(i.licenceCode), `${i.sourceId} ${i.licenceCode}`);
    assert.ok(/^https?:\/\//.test(i.sourceUrl) && /^https?:\/\//.test(i.imageUrl), 'links');
    assert.strictEqual(i.nonCommercial, false);
    assert.strictEqual(i.modified, false);
  }
  const ids = r.store.images.map((i) => `${i.source}/${i.sourceId}`);
  for (const bad of ['inaturalist/photo-104', 'inaturalist/photo-105', 'inaturalist/photo-106', 'inaturalist/photo-107', 'inaturalist/photo-108', 'wikimedia/page-13', 'wikimedia/page-14', 'wikimedia/page-15', 'wikimedia/page-16', 'wikimedia/page-17', 'wikimedia/page-18']) assert.ok(!ids.includes(bad), `${bad} must not be stored`);
  assert.ok(ids.includes('inaturalist/photo-101') && ids.includes('wikimedia/page-12'));
});

test('share-alike photos are stored but flagged display only', async () => {
  const r = rig();
  const out = await settle(r);
  const sa = out.images.filter((i) => i.licenceCode.includes('SA'));
  assert.ok(sa.length >= 2);
  assert.ok(sa.every((i) => i.displayOnly === true));
  assert.ok(out.images.filter((i) => !i.licenceCode.includes('SA')).every((i) => i.displayOnly === false));
});

test('ALA is off until a key is set; with a key it runs and its photos are credited; APII never appears', async () => {
  const off = rig();
  await settle(off);
  assert.ok(!off.calls.some((c) => c.source === 'ala'));
  assert.deepStrictEqual(off.service.enabledSources(), ['inaturalist', 'wikimedia']);
  const on = rig({ env: { ALA_API_KEY: 'k' } });
  const out = await settle(on);
  assert.ok(on.calls.some((c) => c.source === 'ala' && c.key === 'k'));
  assert.ok(out.images.some((i) => i.source === 'ala' && i.creator === 'Ryu Callaway'));
  assert.ok(!on.store.images.some((i) => /apii|dr413|canbr/i.test(JSON.stringify(i))));
  assert.ok(!JSON.stringify(out).includes('"k"'), 'the key is never in a response');
});

test('NC photos are stored (and flagged) only when ALLOW_NONCOMMERCIAL is switched on', async () => {
  const r = rig({ env: { ALLOW_NONCOMMERCIAL: 'true' } });
  await settle(r);
  const nc = r.store.images.filter((i) => i.nonCommercial);
  assert.ok(nc.length >= 1);
  assert.ok(nc.every((i) => /NC/.test(i.licenceCode)));
  assert.ok(!r.store.images.some((i) => /ND/.test(i.licenceCode)));
});

test('polite: one request at a time per source, 1.1 s apart, always with the identifying User-Agent', async () => {
  const r = rig();
  await Promise.all(['grevillea-robusta', 'rosa-iceberg'].map((id) => r.service.startRefresh(id)));
  for (const source of ['inaturalist', 'wikimedia']) {
    const mine = r.calls.filter((c) => c.source === source);
    assert.strictEqual(mine.length, 2);
    assert.ok(mine[1].at - mine[0].at >= GAP_MS - 1, `${source} gap ${mine[1].at - mine[0].at}`);
  }
  for (const c of r.calls) { assert.match(c.ua, /^CuramVault-GardenPlanner\/1\.0 \(\+https:\/\/vault\.example\)/); assert.ok(!/node|undici|fetch/i.test(c.ua)); }
});

test('cached: a second request makes no upstream call; the cache is refreshed after 30 days', async () => {
  const r = rig();
  await settle(r);
  const n = r.calls.length;
  assert.strictEqual((await r.service.images('grevillea-robusta')).status, 'ready');
  assert.strictEqual(r.calls.length, n);
  r.advance(REFRESH_AFTER_MS - DAY);
  await r.service.images('grevillea-robusta');
  assert.strictEqual(r.calls.length, n);
  r.advance(2 * DAY);
  const stale = await r.service.images('grevillea-robusta'); // starts a refresh but answers from the cache straight away
  assert.strictEqual(stale.status, 'pending');
  assert.ok(stale.images.length > 0, 'old photos still shown while the refresh runs');
  await r.service.startRefresh('grevillea-robusta');
  assert.ok(r.calls.length > n);
});

test('the interface is never blocked: images() returns before the upstream answers', async () => {
  let release;
  const slow = new Promise((res) => { release = res; });
  const r = rig();
  const orig = r.service.refresh;
  void orig;
  // make the upstream hang until released
  const hung = createPlantImageService({
    store: createMemoryStore(), env: {}, now: () => 0, sleep: async () => undefined, names: () => 'Grevillea robusta',
    fetchFn: async () => { await slow; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  const t0 = Date.now();
  const res = await hung.images('grevillea-robusta');
  assert.strictEqual(res.status, 'pending');
  assert.ok(Date.now() - t0 < 200);
  release();
  await hung.startRefresh('grevillea-robusta');
});

test('every source down: status "error", retried only after an hour; one source down: the others still deliver', async () => {
  const dead = rig({ fail: ['inaturalist', 'wikimedia'] });
  await dead.service.images('grevillea-robusta');
  await dead.service.startRefresh('grevillea-robusta');
  assert.strictEqual((await dead.service.images('grevillea-robusta')).status, 'error');
  const n = dead.calls.length;
  dead.advance(ERROR_RETRY_MS / 2);
  await dead.service.images('grevillea-robusta');
  assert.strictEqual(dead.calls.length, n, 'no retry inside the hour (back-off)');
  dead.advance(ERROR_RETRY_MS);
  await dead.service.images('grevillea-robusta');
  await dead.service.startRefresh('grevillea-robusta');
  assert.ok(dead.calls.length > n);

  const half = rig({ fail: ['inaturalist'] });
  const out = await settle(half);
  assert.strictEqual(out.status, 'ready');
  assert.ok(out.images.every((i) => i.source === 'wikimedia'));
});

test('a photo that disappears from its source, or whose licence stops being allowed, is hidden on refresh; it returns if it comes back', async () => {
  const r = rig();
  await settle(r);
  const keyOf = (i) => `${i.source}/${i.sourceId}`;
  const find = (k) => r.store.images.find((i) => keyOf(i) === k);
  assert.strictEqual(find('inaturalist/photo-101').hidden, false);
  // 101 is removed from iNaturalist; 102's licence changes to NC; Wikimedia page 12 is relicensed to GFDL
  r.world.inat = { results: INAT.results.map((o) => ({ ...o, photos: o.photos.filter((p) => p.id !== 101).map((p) => (p.id === 102 ? { ...p, license_code: 'cc-by-nc' } : p)) })) };
  r.world.wiki = { query: { pages: WIKI.query.pages.map((p) => (p.pageid === 12 ? wm(12, 'Grevillea robusta tree in a park', 'GFDL', '') : p)) } };
  r.advance(REFRESH_AFTER_MS + DAY);
  await settle(r);
  for (const k of ['inaturalist/photo-101', 'inaturalist/photo-102', 'wikimedia/page-12']) { assert.strictEqual(find(k).hidden, true, k); assert.strictEqual(find(k).hiddenReason, 'removed-or-relicensed'); }
  const shown = (await r.service.images('grevillea-robusta')).images.map((i) => i.sourceUrl + i.imageUrl);
  assert.ok(!shown.some((s) => s.includes('/101/')), 'hidden photos are not served');
  // it comes back
  r.world.inat = INAT;
  r.advance(REFRESH_AFTER_MS + DAY);
  await settle(r);
  assert.strictEqual(find('inaturalist/photo-101').hidden, false);
});

test('a photo hidden by a curator stays hidden through refreshes', async () => {
  const r = rig();
  await settle(r);
  const img = r.store.images.find((i) => i.sourceId === 'photo-101');
  assert.ok(await r.service.setHidden(img.id, true));
  r.advance(REFRESH_AFTER_MS + DAY);
  await settle(r);
  assert.strictEqual(r.store.images.find((i) => i.sourceId === 'photo-101').hidden, true);
  assert.strictEqual(r.store.images.find((i) => i.sourceId === 'photo-101').hiddenReason, 'curator');
  assert.ok(!(await r.service.images('grevillea-robusta')).images.some((i) => i.id === String(img.id)));
});

test('curated defaults come first, one per role, and a hidden photo cannot be a default', async () => {
  const r = rig();
  const out = await settle(r);
  const plain = out.images.find((i) => i.role === 'plant' && !i.defaultFor.length);
  const flower = out.images.filter((i) => i.role === 'flower')[0];
  assert.ok(plain && flower);
  assert.ok(await r.service.setDefault('grevillea-robusta', 'flower', plain.id), 'a curator may pick any visible photo');
  assert.ok(await r.service.setDefault('grevillea-robusta', 'foliage', flower.id));
  const after = await r.service.images('grevillea-robusta');
  assert.strictEqual(after.images[0].id, String(plain.id), 'the curated flower default is first');
  assert.deepStrictEqual(after.images[0].defaultFor, ['flower']);
  // one default per role
  await r.service.setDefault('grevillea-robusta', 'flower', flower.id);
  assert.strictEqual(r.store.images.filter((i) => i.defaultFor === 'flower').length, 1);
  await r.service.setHidden(flower.id, true);
  assert.strictEqual(r.store.images.find((i) => String(i.id) === String(flower.id)).defaultFor, null, 'hiding clears the default');
  assert.strictEqual(await r.service.setDefault('grevillea-robusta', 'flower', flower.id), null, 'a hidden photo cannot be a default');
  await assert.rejects(() => r.service.setDefault('grevillea-robusta', 'habitat', plain.id), /role must be/);
  await r.service.setDefault('grevillea-robusta', 'flower', null);
  assert.strictEqual(r.store.images.filter((i) => i.defaultFor === 'flower').length, 0);
});

test('the credit line reads "Photo: creator, licence via source" and credits() lists every shown photo', async () => {
  const r = rig();
  await settle(r);
  const c = await r.service.credits(['grevillea-robusta', 'not-a-plant']);
  assert.ok(c.length >= 4);
  for (const x of c) {
    assert.strictEqual(x.plantId, 'grevillea-robusta');
    assert.ok(x.credit.startsWith(`Photo: ${x.creator}, ${x.licenceCode} via `), x.credit);
    assert.ok(x.licenceUrl && x.sourceUrl);
  }
  assert.ok(c.some((x) => x.credit.endsWith('via iNaturalist')) && c.some((x) => x.credit.endsWith('via Wikimedia Commons')));
  const img = r.store.images.find((i) => i.sourceId === 'photo-101');
  await r.service.setHidden(img.id, true);
  assert.ok(!(await r.service.credits(['grevillea-robusta'])).some((x) => x.id === String(img.id)), 'a hidden photo is not credited as used');
});

test('unknown plants are refused (the server never searches a name a client made up); no sources means "disabled"', async () => {
  const r = rig();
  assert.strictEqual((await r.service.images('made-up-plant')).status, 'unknown_plant');
  assert.strictEqual(r.calls.length, 0);
  const none = createPlantImageService({ store: createMemoryStore(), env: {}, only: ['ala'], names: () => 'Grevillea robusta', fetchFn: async () => { throw new Error('no'); } });
  assert.strictEqual((await none.images('x')).status, 'disabled');
  assert.ok(SOURCES.ala && SOURCES.inaturalist && SOURCES.wikimedia);
});

test('cultivars without a species are searched by their full name', async () => {
  const r = rig();
  await r.service.startRefresh('rosa-iceberg');
  assert.ok(r.calls.some((c) => decodeURIComponent(c.url.replace(/\+/g, ' ')).includes("Rosa 'Iceberg'")));
});

test('summary counts shown, hidden and defaults per plant, with the lookup status', async () => {
  const r = rig();
  await settle(r);
  const first = r.store.images.find((i) => i.sourceId === 'photo-101');
  const second = r.store.images.find((i) => i.sourceId === 'photo-102');
  await r.service.setDefault('grevillea-robusta', 'flower', first.id);
  await r.service.setHidden(second.id, true);
  const s = (await r.service.summary()).find((x) => x.plantId === 'grevillea-robusta');
  assert.strictEqual(s.status, 'ok');
  assert.strictEqual(s.hidden, 1);
  assert.strictEqual(s.defaults, 1);
  assert.strictEqual(s.visible, r.store.images.filter((i) => !i.hidden).length);
  assert.ok(s.fetchedAt > 0);
  assert.ok(!(await r.service.summary()).some((x) => x.plantId === 'never-looked-up'), 'a plant never looked up has no row');
});

test('refreshMissing queues only plants never looked up (or whose last lookup failed), and fetches them politely', async () => {
  const r = rig();
  await settle(r); // grevillea-robusta is done
  r.calls.length = 0;
  const n = await r.service.refreshMissing();
  assert.strictEqual(n, 2, 'rosa-iceberg and never-looked-up');
  await settleAll(r, ['rosa-iceberg', 'never-looked-up']);
  assert.ok(r.calls.every((c) => c.ua.startsWith('CuramVault-GardenPlanner/1.0')));
  assert.strictEqual(await r.service.refreshMissing(), 0, 'nothing left to do');
  const dead = rig({ fail: ['inaturalist', 'wikimedia'] });
  await dead.service.refreshMissing();
  await settleAll(dead, ['grevillea-robusta', 'rosa-iceberg', 'never-looked-up']);
  assert.strictEqual(await dead.service.refreshMissing(), 3, 'failed lookups are tried again');
});

async function settleAll(r, ids) { for (const id of ids) await r.service.startRefresh(id); }

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS  ${name}`); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
