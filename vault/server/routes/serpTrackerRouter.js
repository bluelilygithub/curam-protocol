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
const { listSites, loadSite, createSite, updateSite, deleteSite, listRuns, SiteError, MAX_SITES } = require('../services/serpTracker/store');
const { runSite, RunAlreadyActive } = require('../services/serpTracker/runner');
const { monthSpend, monthlyCapUsd, logCost, capStatus, estimateLiveUsd, LIVE_PER_TEN_RESULTS_USD, AI_OVERVIEW_USD } = require('../services/serpTracker/costs');
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
const cleanKeyword = (raw) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_KEYWORD) : '');
const parseId = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 && n <= MAX_INT ? n : null; };

function createRouter(pool, {
  deps = { getBalance, hasCredentials, logCost },
  live = liveSerp,
  getBin = () => { require('../services/recycleBin/adapters'); return require('../services/recycleBin'); },
  env = process.env,
  now = () => new Date(),
  modules = [],
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
        maxSites: MAX_SITES, maxLookupDepth: MAX_LOOKUP_DEPTH, pricing: { perTenResultsUsd: LIVE_PER_TEN_RESULTS_USD, aiOverviewUsd: AI_OVERVIEW_USD },
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
      const result = await runSite({ pool, site, trigger: 'manual', deps: { ...deps, now, log: (m) => getLogger().warn(m) }, modules });
      res.json({ run: result });
    } catch (err) {
      if (err instanceof RunAlreadyActive) return res.status(409).json({ error: err.message });
      fail(res, err, 'manual run', 'The run could not be started.');
    }
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
      let best = null; // { summary, raw } of the fullest readable answer so far
      let totalCost = 0;
      let attempts = 0;
      let unreadable = null;
      const maxAttempts = rawDepth >= RETRY_FROM_DEPTH ? MAX_ATTEMPTS : 1;
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
        if (!best || parsed.organicCount > best.summary.organicCount) best = { summary: parsed, raw: got.raw };
        if (parsed.coverage.complete || (parsed.mine && parsed.mine.status === 'ranked')) break; // a full answer, or the site is found: done
      }
      if (!best) return res.status(502).json({ error: `${unreadable} (The search was charged: US$${totalCost.toFixed(4)}.)` });
      const summary = { ...best.summary, attempts };
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
