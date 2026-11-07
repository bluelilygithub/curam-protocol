'use strict';

// SERP Tracker routes, mounted at /api/serp-tracker behind requireFeature('serpTracker') (server/index.js). Takes the pool and the
// outside pieces as arguments so tests need no database or network. Every query filters by the caller's "userId".
//   Sites:   several per person (one per client or website), each optionally linked to one of their CRM clients; delete goes to the recycle bin.
//   Runs:    the daily check per site, and "Run now".
//   Lookup:  ad-hoc live searches, for a site or as a Quick lookup (no site), saved, reopened, deleted (one, several or all).
// See docs/serp-tracker.md.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { getLogger } = require('../middleware/requestContext');
const { ownsRow } = require('../utils/ownedLinks');
const { validateProfile, DEFAULTS, localDate } = require('../services/serpTracker/siteProfile');
const { listSites, loadSite, createSite, updateSite, deleteSite, listRuns, setGscSiteUrl, SiteError, MAX_SITES } = require('../services/serpTracker/store');
const history = require('../services/gscHistory');
const { readRecord, betterRead, isFound } = require('../services/serpTracker/reads');
const rankings = require('../services/serpTracker/rankings');
const { runSite, RunAlreadyActive } = require('../services/serpTracker/runner');
const { monthSpend, monthlyCapUsd, logCost, capStatus, estimateLiveUsd, LIVE_PER_TEN_RESULTS_USD, AI_OVERVIEW_USD, QUEUED_PER_TEN_RESULTS_USD, TRACK_DEPTH_CAP, MAX_TRACK_READS } = require('../services/serpTracker/costs');
const { getBalance, hasCredentials, liveSerp, findLocation } =require('../services/serpTracker/dataforseo');
const { parseSerp, SerpParseError } = require('../services/serpTracker/serpParse');
const { saveLookup, listLookups, getLookup, deleteLookups, MAX_IDS } = require('../services/serpTracker/lookups');

const MAX_INT = 2147483647;
const MAX_KEYWORD = 200;
const MAX_LOOKUP_DEPTH = 200; // the most DataForSEO's Live mode returns; deeper needs the queued mode
// Seen on 6 Nov 2026: asking for 100 results usually returned only 8 to 14 (a short page) and only sometimes about 97. A short answer costs
// only a fraction of a cent, so a deep search is tried again (up to 4 attempts in all) until it comes back full or the site is found. The
// fullest answer is kept, every attempt's cost is logged, and a retry is never made if it would pass the monthly limit.
const RETRY_FROM_DEPTH = 50;
const MAX_ATTEMPTS = 4;
// 7 Nov 2026 (idea from OpenSEO): Google sometimes serves a scraper a results page that leaves out sites that really rank, so for a site a single
// "not found" is not trusted. A lookup that misses the site is read again, up to MISS_READS reads in all, and says "not found" only when every
// read missed; the best position wins (services/serpTracker/reads.js). Only up to MISS_RETRY_MAX_DEPTH results, where each read costs under a cent.
const MISS_READS = 3;
const MISS_RETRY_MAX_DEPTH = 50;
const cleanKeyword = (raw) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_KEYWORD) : '');
const parseId = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= MAX_INT ? n : null; };

function createRouter(pool, {
  deps = { getBalance, hasCredentials, logCost },
  live = liveSerp,
  getBin = () => { require('../services/recycleBin/adapters'); return require('../services/recycleBin'); },
  env = process.env,
  now = () => new Date(),
  modules = [],
  trackingModule = null, // the Rankings module for a manual "Run tracking now" (null = the real one, loaded when first needed)
  // Search Console, for the Keywords tab (replaced by a fake in tests): is it connected, which properties can the person see, and one page of rows
  gscApi = {
    connection: (uid) => require('../services/gscService').connection(uid),
    listProperties: (uid) => require('../services/gscService').listSites(uid),
    queryRows: (uid, siteUrl, body) => require('../services/gscService').queryRows(uid, siteUrl, body),
  },
  geocoder = null, // reverse place lookup for "Use my location" (services/geocode.js); null = that button says it is unavailable
  runsPerHour = 6,
  lookupsPerHour = 30,
} = {}) {
  const router = express.Router();
  const userId = (req) => req.user.id;

  const runLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: runsPerHour, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `serp-run:${req.user?.id || req.ip}`,
    message: { error: 'Too many manual runs this hour. The daily run happens by itself.' },
  });
  const lookupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: lookupsPerHour, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `serp-lookup:${req.user?.id || req.ip}`,
    message: { error: 'Too many lookups this hour. Each one costs money, so there is a limit.' },
  });

  const fail = (res, err, what, message) => {
    if (err instanceof SiteError) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err }, `serp-tracker ${what} failed`);
    return res.status(500).json({ error: message });
  };

  /** The CRM client a request asks for: undefined (not sent), null (remove) or a client that is the caller's own. */
  async function wantedClient(req) {
    const raw = req.body && req.body.clientId;
    if (raw === undefined) return { value: undefined };
    if (raw === null || raw === '') return { value: null };
    const id = parseId(raw);
    if (!id || !(await ownsRow(pool, 'client', id, userId(req)))) return { error: 'That client is not one of yours.' };
    return { value: id };
  }

  // what the page needs before a site exists: is DataForSEO set up, the cap, this month's and last month's spend (whole workspace), the prices
  router.get('/status', async (req, res) => {
    try {
      const today = localDate(now(), DEFAULTS.timezone);
      const [thisMonth, lastMonth] = await Promise.all([monthSpend(pool, today, 0), monthSpend(pool, today, 1)]);
      res.json({
        dataForSeoConfigured: deps.hasCredentials(env), capUsd: monthlyCapUsd(env), spentThisMonthUsd: thisMonth, spentLastMonthUsd: lastMonth, defaults: DEFAULTS,
        maxSites: MAX_SITES, maxLookupDepth: MAX_LOOKUP_DEPTH, pricing: { perTenResultsUsd: LIVE_PER_TEN_RESULTS_USD, aiOverviewUsd: AI_OVERVIEW_USD, queuedPerTenResultsUsd: QUEUED_PER_TEN_RESULTS_USD, trackDepthCap: TRACK_DEPTH_CAP, maxTrackReads: MAX_TRACK_READS },
      });
    } catch (err) {
      fail(res, err, 'status', 'Could not load the SERP Tracker status.');
    }
  });

  // what a typed place really is to DataForSEO (free call): { found, code, name, type }. The Site setup page shows it as a label.
  router.get('/location-check', async (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name.slice(0, 120) : '';
    if (!name.trim()) return res.json({ found: false });
    if (!deps.hasCredentials(env)) return res.json({ found: false, unavailable: true });
    try {
      const loc = await (deps.findLocation || findLocation)(name, { env });
      res.json(loc ? { found: true, code: loc.code, name: loc.name, type: loc.type } : { found: false });
    } catch (err) {
      getLogger().warn({ code: err && err.code }, 'serp-tracker location check failed');
      res.json({ found: false, unavailable: true });
    }
  });

  // "Use my location": the browser's position (in the body, never the URL, never logged) -> the suburb or city -> DataForSEO's matching place.
  // { found, code, name, type } or { found: false, reason }
  const pointLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `serp-point:${req.user?.id || req.ip}`,
    message: { error: 'Too many location checks. Wait a minute.' },
  });
  router.post('/location-from-point', pointLimiter, async (req, res) => {
    const lat = Number(req.body && req.body.lat);
    const lng = Number(req.body && req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'That is not a point on the map.' });
    if (!geocoder || !deps.hasCredentials(env)) return res.json({ found: false, reason: 'unavailable' });
    try {
      const r = await geocoder.reverse(lat, lng, { parts: true });
      const p = r && r.result;
      if (!p) return res.json({ found: false, reason: 'not_australia' });
      const find = deps.findLocation || findLocation;
      const tries = [];
      if (p.suburb && p.state) tries.push(`${p.suburb},${p.state},Australia`);
      if (p.city && p.state) tries.push(`${p.city},${p.state},Australia`);
      if (p.suburb && p.city && p.state) tries.push(`${p.suburb},${p.city},${p.state},Australia`);
      for (const t of tries) {
        const loc = await find(t, { env });
        if (loc) return res.json({ found: true, code: loc.code, name: loc.name, type: loc.type });
      }
      res.json({ found: false, reason: 'no_match', suburb: p.suburb || p.city || null });
    } catch (err) {
      getLogger().warn({ code: err && err.code }, 'serp-tracker location-from-point failed');
      res.json({ found: false, reason: 'unavailable' });
    }
  });

  // ---- Sites
  router.get('/sites', async (req, res) => {
    try { res.json({ sites: await listSites(pool, userId(req)) }); } catch (err) { fail(res, err, 'sites list', 'Could not load your sites.'); }
  });

  router.post('/sites', async (req, res) => {
    const v = validateProfile(req.body && req.body.profile);
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    const client = await wantedClient(req);
    if (client.error) return res.status(400).json({ error: client.error });
    try {
      res.json({ site: await createSite(pool, userId(req), v.profile, client.value === undefined ? null : client.value) });
    } catch (err) { fail(res, err, 'site create', 'Could not save the site.'); }
  });

  router.get('/sites/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const site = await loadSite(pool, userId(req), id);
      if (!site) return res.status(404).json({ error: 'Not found' });
      res.json({ site });
    } catch (err) { fail(res, err, 'site load', 'Could not load the site.'); }
  });

  router.put('/sites/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const v = validateProfile(req.body && req.body.profile);
    if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
    const client = await wantedClient(req);
    if (client.error) return res.status(400).json({ error: client.error });
    try {
      const site = await updateSite(pool, userId(req), id, v.profile, client.value);
      if (!site) return res.status(404).json({ error: 'Not found' });
      res.json({ site });
    } catch (err) { fail(res, err, 'site save', 'Could not save the site.'); }
  });

  // delete the site and its saved lookups: both go to the recycle bin for 30 days (Undo); its run history does not come back
  router.delete('/sites/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const bin = getBin();
      const out = await deleteSite(pool, bin, userId(req), id);
      if (!out.deleted) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true, binId: out.binId, retentionDays: bin.RETENTION_DAYS });
    } catch (err) { fail(res, err, 'site delete', 'The site could not be deleted. Nothing was removed.'); }
  });

  router.get('/sites/:id/runs', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      if (!(await loadSite(pool, userId(req), id))) return res.status(404).json({ error: 'Not found' });
      res.json({ runs: await listRuns(pool, userId(req), id) });
    } catch (err) { fail(res, err, 'runs', 'Could not load the runs.'); }
  });

  router.post('/sites/:id/run', runLimiter, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const site = await loadSite(pool, userId(req), id);
      if (!site) return res.status(404).json({ error: 'Not found' });
      // "Check connection" (the default) only reads the balance. { tracking: true } is "Run tracking now": it ALSO searches every keyword x device
      // (paid, in the standard queue), even when daily tracking is switched off for the site, because the person pressed it knowing the estimate.
      const wantsTracking = req.body && req.body.tracking === true;
      const runModules = wantsTracking ? [trackingModule || require('../services/serpTracker/rankCollect').rankingsModule] : modules;
      const runSiteArg = wantsTracking ? { ...site, profile: { ...site.profile, dailyTracking: true } } : site;
      const runDeps = { ...deps, now, log: (m) => getLogger().warn(m) };
      if (wantsTracking) {
        // A tracking run waits for DataForSEO's queue (about 4 minutes a round, up to three rounds), which is longer than a web request should stay
        // open, so it runs in the background and the page watches the Runs list. The "already running" refusal is made here, before answering.
        const active = await pool.query(`SELECT 1 FROM serp_runs WHERE "siteId" = $1 AND status = 'running' AND "startedAt" > NOW() - INTERVAL '2 hours' LIMIT 1`, [site.id]);
        if (active.rows.length) return res.status(409).json({ error: 'A run for this site is already in progress.' });
        runSite({ pool, site: runSiteArg, trigger: 'manual', deps: runDeps, modules: runModules }).catch((err) => getLogger().error({ err }, 'serp-tracker background tracking run failed'));
        return res.status(202).json({ started: true });
      }
      const result = await runSite({ pool, site: runSiteArg, trigger: 'manual', deps: runDeps, modules: runModules });
      res.json({ run: result });
    } catch (err) {
      if (err instanceof RunAlreadyActive) return res.status(409).json({ error: err.message });
      fail(res, err, 'manual run', 'The run could not be started.');
    }
  });

  // ---- Tracked rankings (daily tracking through DataForSEO): the latest row for each keyword and device, and one keyword's series over time
  router.get('/sites/:id/rankings', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      if (!(await loadSite(pool, userId(req), id))) return res.status(404).json({ error: 'Not found' });
      res.json({ rankings: await rankings.listLatest(pool, userId(req), id) });
    } catch (err) { fail(res, err, 'rankings', 'Could not load the tracked rankings.'); }
  });

  // POST with the keyword in the body (what people search for stays out of URLs and logs): { keyword, device, days }
  router.post('/sites/:id/rankings/history', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const keyword = cleanKeyword(req.body && req.body.keyword);
    if (!keyword) return res.status(400).json({ error: 'Choose a keyword.' });
    try {
      if (!(await loadSite(pool, userId(req), id))) return res.status(404).json({ error: 'Not found' });
      const days = req.body.days === 'all' ? 'all' : Number(req.body.days) || 90;
      res.json({ days: await rankings.series(pool, userId(req), id, keyword, req.body.device, days) });
    } catch (err) { fail(res, err, 'rankings history', 'Could not load that keyword\'s history.'); }
  });

  // ---- Keywords: what the site really ranks for, from Search Console (Google's own figures), kept as history. Nothing here is paid.
  // Every route checks the site is the caller's first, and every history query is filtered by "userId" and the site's own property.
  const gscFailMessage = (err) => {
    const m = String((err && err.message) || '');
    if (/not connected/i.test(m)) return 'Search Console is not connected. Connect it on the Search Console page first.';
    if (/invalid_grant|unauthor|401|403|permission/i.test(m)) return 'Google would not let Vault read that Search Console property. Reconnect Search Console, or check you have access to it.';
    return 'Could not reach Search Console just now. Try again in a minute.';
  };

  // the state of the connection for this site: connected?, the properties the person can see, the one chosen (or suggested), the history's progress
  router.get('/sites/:id/gsc', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const site = await loadSite(pool, userId(req), id);
      if (!site) return res.status(404).json({ error: 'Not found' });
      const conn = await gscApi.connection(userId(req));
      if (!conn.connected) return res.json({ connected: false });
      let properties = [];
      let propertiesError = null;
      try { properties = (await gscApi.listProperties(userId(req))).map((p) => ({ siteUrl: p.siteUrl, permissionLevel: p.permissionLevel })); } catch (err) { propertiesError = gscFailMessage(err); }
      const suggested = site.gscSiteUrl ? null : history.pickProperty(site.profile.domain, properties);
      const progress = site.gscSiteUrl ? await history.syncProgress(pool, userId(req), site.gscSiteUrl) : null;
      res.json({ connected: true, email: conn.email, properties, propertiesError, selected: site.gscSiteUrl, suggested, progress });
    } catch (err) { fail(res, err, 'gsc state', 'Could not load the Search Console state.'); }
  });

  // choose the property this site reads from (or clear it with { siteUrl: null }); it must be one the person can see
  router.put('/sites/:id/gsc', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const want = req.body && req.body.siteUrl;
    try {
      if (!(await loadSite(pool, userId(req), id))) return res.status(404).json({ error: 'Not found' });
      if (want === null) { await setGscSiteUrl(pool, userId(req), id, null); return res.json({ ok: true, selected: null }); }
      if (typeof want !== 'string' || !want) return res.status(400).json({ error: 'Choose a Search Console property.' });
      let properties;
      try { properties = await gscApi.listProperties(userId(req)); } catch (err) { return res.status(400).json({ error: gscFailMessage(err) }); }
      if (!properties.some((p) => p.siteUrl === want && p.permissionLevel !== 'siteUnverifiedUser')) return res.status(400).json({ error: 'That is not a Search Console property you can read.' });
      await setGscSiteUrl(pool, userId(req), id, want);
      res.json({ ok: true, selected: want });
    } catch (err) { fail(res, err, 'gsc select', 'Could not save the choice.'); }
  });

  // start (or carry on) loading the history in the background; the page polls GET /sites/:id/gsc for progress
  router.post('/sites/:id/gsc/sync', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const site = await loadSite(pool, userId(req), id);
      if (!site) return res.status(404).json({ error: 'Not found' });
      if (!site.gscSiteUrl) return res.status(400).json({ error: 'Choose the Search Console property for this site first.' });
      const uid = userId(req);
      const siteUrl = site.gscSiteUrl;
      const fetchRows = ({ startDate, endDate, startRow, rowLimit }) => gscApi.queryRows(uid, siteUrl, { startDate, endDate, dimensions: ['date', 'query'], rowLimit, startRow });
      // not awaited: a 16 month load takes a while, and the sync saves its progress after each month
      history.syncSite({ pool, userId: uid, siteUrl, fetchRows, log: (m) => getLogger().warn(m) })
        .catch((err) => getLogger().error({ err }, 'serp-tracker gsc sync crashed'));
      res.status(202).json({ ok: true });
    } catch (err) { fail(res, err, 'gsc sync', 'Could not start the update.'); }
  });

  // ?days=7|28|90|180|all &sort=clicks|impressions|position|keyword|change &dir=asc|desc &q=text &striking=1 &new=1 (first seen inside the period)
  router.get('/sites/:id/keywords', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const site = await loadSite(pool, userId(req), id);
      if (!site) return res.status(404).json({ error: 'Not found' });
      if (!site.gscSiteUrl) return res.json({ keywords: [], total: 0 });
      const days = req.query.days === 'all' ? 'all' : Number(req.query.days) || 28;
      const out = await history.listKeywords(pool, userId(req), site.gscSiteUrl, {
        days, sort: String(req.query.sort || 'clicks'), dir: req.query.dir === 'asc' || req.query.dir === 'desc' ? req.query.dir : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : '', striking: req.query.striking === '1', newOnly: req.query.new === '1',
      });
      res.json(out);
    } catch (err) { fail(res, err, 'keywords', 'Could not load the keywords.'); }
  });

  // POST with the keyword in the body (what people search for stays out of URLs and logs): { query, days }
  router.post('/sites/:id/keywords/history', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    const query = cleanKeyword(req.body && req.body.query);
    if (!query) return res.status(400).json({ error: 'Choose a keyword.' });
    try {
      const site = await loadSite(pool, userId(req), id);
      if (!site) return res.status(404).json({ error: 'Not found' });
      if (!site.gscSiteUrl) return res.json({ days: [] });
      const days = req.body.days === 'all' ? 'all' : Number(req.body.days) || 90;
      res.json({ days: await history.keywordHistory(pool, userId(req), site.gscSiteUrl, query, { days }) });
    } catch (err) { fail(res, err, 'keyword history', 'Could not load that keyword\'s history.'); }
  });

  // ---- Lookup: a live search now, saved so it can be reopened. For a site (its place, language and domain are used) or a Quick lookup (no site).
  router.post('/lookups', lookupLimiter, async (req, res) => {
    const keyword = cleanKeyword(req.body && req.body.keyword);
    if (!keyword) return res.status(400).json({ error: 'Type the search you want to look up.' });
    const device = req.body && req.body.device === 'mobile' ? 'mobile' : 'desktop';
    const rawDepth = req.body && req.body.depth != null && req.body.depth !== '' ? Number(req.body.depth) : 10;
    if (!Number.isInteger(rawDepth) || rawDepth < 10 || rawDepth > MAX_LOOKUP_DEPTH || rawDepth % 10) return res.status(400).json({ error: `Results to request must be a whole number from 10 to ${MAX_LOOKUP_DEPTH}, in steps of 10.` });
    const aiOverview = !(req.body && req.body.aiOverview === false);
    const rawSite = req.body && req.body.siteId;
    const wantsSite = rawSite !== undefined && rawSite !== null && rawSite !== '';
    if (wantsSite && !parseId(rawSite)) return res.status(400).json({ error: 'That site is not one of yours.' });
    if (!deps.hasCredentials(env)) return res.status(503).json({ error: 'DataForSEO is not connected on this server.' });
    try {
      const site = wantsSite ? await loadSite(pool, userId(req), parseId(rawSite)) : null;
      if (wantsSite && !site) return res.status(400).json({ error: 'That site is not one of yours.' });
      const profile = site ? site.profile : null;
      const costDate = localDate(now(), (profile && profile.timezone) || DEFAULTS.timezone);
      // refuse BEFORE searching if the limit is already reached, or if this search is expected to pass it
      const cap = await capStatus(pool, costDate, env);
      const estimate = estimateLiveUsd(rawDepth, aiOverview);
      if (cap.over) return res.status(402).json({ error: `The monthly spending limit (US$${cap.cap.toFixed(2)}) has been reached, so no more searches are made this month.` });
      if (cap.spent + estimate > cap.cap) return res.status(402).json({ error: `This search is expected to cost about US$${estimate.toFixed(3)}, which would pass the monthly spending limit (US$${cap.cap.toFixed(2)}; US$${cap.spent.toFixed(3)} spent so far). Choose fewer results, or raise the limit on the server.` });

      const task = { keyword, locationName: (profile && profile.locationName) || DEFAULTS.locationName, languageCode: (profile && profile.languageCode) || DEFAULTS.languageCode, searchDomain: (profile && profile.searchDomain) || DEFAULTS.searchDomain, device, depth: rawDepth, loadAiOverview: aiOverview };
      const myDomain = profile ? profile.domain : null;
      const competitors = profile ? profile.competitors.map((c) => c.domain) : [];
      let best = null; // { summary, raw } of the best readable answer so far (the best position for the site, else the fullest answer)
      let totalCost = 0;
      let attempts = 0;
      let unreadable = null;
      const reads = []; // one { position, organic } per readable read
      const missRetry = Boolean(myDomain) && rawDepth <= MISS_RETRY_MAX_DEPTH;
      const maxAttempts = rawDepth >= RETRY_FROM_DEPTH ? MAX_ATTEMPTS : (missRetry ? MISS_READS : 1);
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) {
          const again = await capStatus(pool, costDate, env); // a retry only goes ahead if it still fits under the limit
          if (again.over || again.spent + estimate > again.cap) break;
        }
        const got = await live(task, { env });
        attempts = attempt;
        totalCost += got.costUsd;
        // DataForSEO charges for each search whether or not it can be read, so every cost is logged first
        await deps.logCost(pool, { userId: userId(req), siteId: site ? site.id : null, runId: null, costDate, endpoint: `/v3/serp/google/organic/live/advanced depth=${rawDepth} ${device}${attempt > 1 ? ` (try ${attempt})` : ''}`, costUsd: got.costUsd });
        let parsed;
        try {
          parsed = parseSerp(got.result, { myDomain, competitors, depth: rawDepth });
        } catch (err) {
          if (!(err instanceof SerpParseError)) throw err;
          unreadable = err.message;
          continue;
        }
        reads.push(readRecord(parsed));
        if (betterRead(parsed, best && best.summary)) best = { summary: parsed, raw: got.raw };
        if (isFound(parsed)) break; // a find is trusted: done
        if (!missRetry && parsed.coverage.complete) break; // a full answer and no site to look for: done
        if (missRetry && attempt >= maxAttempts) break;
      }
      if (!best) return res.status(502).json({ error: `${unreadable} (The search was charged: US$${totalCost.toFixed(4)}.)` });
      const summary = { ...best.summary, attempts, reads };
      const saved = await saveLookup(pool, { userId: userId(req), siteId: site ? site.id : null, ...task, domain: myDomain, costUsd: totalCost, summary, raw: best.raw });
      res.json({ lookup: await getLookup(pool, userId(req), saved.id) });
    } catch (err) {
      // an error from DataForSEO (a refused login, an account that needs verifying) is worded safely and says what happened
      if (err && err.name === 'DataForSeoError') {
        getLogger().warn({ code: err.code, status: err.status }, 'serp-tracker lookup refused');
        return res.status(502).json({ error: err.message });
      }
      fail(res, err, 'lookup', 'The lookup could not be done.');
    }
  });

  // ?siteId=<n> the lookups of one site, ?siteId=quick the Quick lookups (no site), no parameter all of them
  router.get('/lookups', async (req, res) => {
    const q = req.query.siteId;
    let siteId;
    if (q === 'quick') siteId = null;
    else if (q !== undefined) { siteId = parseId(q); if (!siteId) return res.status(400).json({ error: 'That site is not valid.' }); }
    try {
      res.json({ lookups: await listLookups(pool, userId(req), { siteId }) });
    } catch (err) { fail(res, err, 'lookups list', 'Could not load the saved lookups.'); }
  });

  // delete several or all of the person's own lookups: { ids: [1,2,3] } or { all: true } (optionally { all: true, siteId: 'quick' | n } to
  // delete all of ONE list). Each goes to the recycle bin (30 days, Undo).
  router.delete('/lookups', async (req, res) => {
    const body = req.body || {};
    const all = body.all === true;
    let ids = [];
    let scope;
    if (all) {
      if (body.siteId === 'quick') scope = null;
      else if (body.siteId !== undefined && body.siteId !== null) { scope = parseId(body.siteId); if (!scope) return res.status(400).json({ error: 'That site is not valid.' }); }
    } else {
      if (!Array.isArray(body.ids) || !body.ids.length) return res.status(400).json({ error: 'Choose at least one lookup to delete.' });
      if (body.ids.length > MAX_IDS) return res.status(400).json({ error: `Delete at most ${MAX_IDS} at a time.` });
      ids = body.ids.map(parseId);
      if (ids.some((n) => n === null)) return res.status(400).json({ error: 'Those are not valid lookups.' });
    }
    try {
      const bin = getBin();
      const out = await deleteLookups(pool, bin, userId(req), { ids, all, siteId: scope });
      res.json({ ok: true, deleted: out.deleted, binIds: out.binIds, retentionDays: bin.RETENTION_DAYS });
    } catch (err) { fail(res, err, 'lookups delete', 'The lookups could not be deleted. Nothing was removed.'); }
  });

  router.get('/lookups/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Not found' });
    try {
      const lookup = await getLookup(pool, userId(req), id);
      if (!lookup) return res.status(404).json({ error: 'Not found' });
      res.json({ lookup });
    } catch (err) { fail(res, err, 'lookup load', 'Could not load that lookup.'); }
  });

  return router;
}

module.exports = { createRouter, MAX_LOOKUP_DEPTH };
