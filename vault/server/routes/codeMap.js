'use strict';

// /api/code-map: the admin Code Map (analysis of Vault's own source). Mounted behind requireAdmin in server/index.js, with no aiLimiter
// on the mount because the analysis makes no model calls; the one route that does (POST /findings/explain) has aiLimiter itself.
// Runs are background jobs (server/services/codeMap/jobs.js). Named routes before /:id. The Context tab's briefing routes
// (/briefings, /briefing/*) use server/services/codeMap/briefing/ and make no model call either.
// Injectable (jobs, explain, limiter, briefing) so the route test needs no database or model.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const { compareRuns } = require('../services/codeMap/compare');
const { getAppUrl } = require('../utils/appUrl');

function createCodeMapRouter({ jobs, explain, limiter, briefing, aiReview, liveChecks } = {}) {
  const router = express.Router();
  const J = () => jobs || require('../services/codeMap/jobs');
  const R = () => aiReview || require('../services/codeMap/aiReview');
  const L = () => liveChecks || require('../services/codeMap/liveCheck');
  let briefingService = briefing || null;
  const B = () => briefingService || (briefingService = require('../services/codeMap/briefing').createBriefingService({ jobs }));
  const ask = explain || ((userId, input) => require('../services/codeMap/explain').explainFinding(userId, input));
  const ai = limiter || require('../middleware/aiRateLimit').aiLimiter;

  const fail = (res, err, what) => {
    const status = err.status || 500;
    if (status >= 500) getLogger().error({ err }, `[codeMap] ${what}`);
    // our own errors carry a status and a message meant for the admin (e.g. 503 "No AI model is set up"); anything else is hidden
    res.status(status).json({ error: err.status ? err.message : 'Something went wrong. Try again.', ...(err.runningId ? { runningId: err.runningId, runningKind: err.runningKind || null } : {}) });
  };

  // start a run; answers at once with its id (409 while another run is going)
  router.post('/runs', async (req, res) => {
    try {
      res.status(202).json({ id: await J().start(req.user.id) });
    } catch (err) { fail(res, err, 'start'); }
  });

  router.get('/runs', async (req, res) => {
    try {
      res.json({ runs: await J().list() });
    } catch (err) { fail(res, err, 'list'); }
  });

  // the newest finished run with its full result ({ run: null } before the first one)
  router.get('/runs/latest', async (req, res) => {
    try {
      res.json({ run: await J().latest() });
    } catch (err) { fail(res, err, 'latest'); }
  });

  // drift between two finished runs: ?from=<older id>&to=<newer id> (server/services/codeMap/compare.js)
  router.get('/compare', async (req, res) => {
    const { from, to } = req.query;
    if (!/^\d{1,9}$/.test(String(from || '')) || !/^\d{1,9}$/.test(String(to || ''))) {
      return res.status(400).json({ error: 'Pick two runs to compare (from and to must be run ids).' });
    }
    try {
      const [a, b] = await Promise.all([J().get(Number(from)), J().get(Number(to))]);
      if (!a || !b) return res.status(404).json({ error: 'One of those runs is no longer here (the last 30 are kept).' });
      if (a.status !== 'done' || b.status !== 'done' || !a.result || !b.result) {
        return res.status(400).json({ error: 'Only finished runs can be compared.' });
      }
      const meta = (r) => ({ id: r.id, createdAt: r.createdAt, finishedAt: r.finishedAt, commitHint: r.commitHint, durationMs: r.durationMs });
      res.json({ from: meta(a), to: meta(b), ...compareRuns(a.result, b.result) });
    } catch (err) { fail(res, err, 'compare'); }
  });

  // "Explain and plan a fix" for one finding: the only route here that calls a model, so the only one behind aiLimiter
  // (server/services/codeMap/explain.js reads the run's evidence and excerpts from server/ and client/src/ only)
  router.post('/findings/explain', ai, async (req, res) => {
    const { runId, ruleId, toolId, findingId } = req.body || {};
    try {
      res.json(await ask(req.user.id, { runId: Number(runId), ruleId, toolId, findingId }));
    } catch (err) { fail(res, err, 'explain'); }
  });

  // ── Security tab, live site: checks the running site at its own public address (APP_URL via getAppUrl, never a typed address).
  // No model calls; about 15 GET requests and one broken POST to a path that does not exist (server/services/codeMap/liveCheck.js).
  router.post('/live-checks', async (req, res) => {
    try { res.status(201).json({ check: await L().check(req.user.id, getAppUrl(req)) }); } catch (err) { fail(res, err, 'live check'); }
  });

  router.get('/live-checks/latest', async (req, res) => {
    try { res.json({ check: await L().latest() }); } catch (err) { fail(res, err, 'live check latest'); }
  });

  // ── AI reviews (server/services/codeMap/aiReview.js): ?kind=plainCode (default, the AI review tab: model calls plain code could do)
  // or ?kind=security (the Security tab's AI security review of every route file). Started only by the admin's button (no cron).
  // POST makes model calls, so it is behind aiLimiter; the GETs make none. An unknown kind is a 400.
  const kindParam = (req) => (req.query.kind === undefined ? undefined : String(req.query.kind));
  router.get('/ai-reviews/estimate', async (req, res) => {
    try { res.json(await R().estimate(kindParam(req))); } catch (err) { fail(res, err, 'ai review estimate'); }
  });

  router.post('/ai-reviews', ai, async (req, res) => {
    try { res.status(202).json({ id: await R().start(req.user.id, kindParam(req)) }); } catch (err) { fail(res, err, 'ai review start'); }
  });

  router.get('/ai-reviews', async (req, res) => {
    try { res.json({ reviews: await R().list(kindParam(req)) }); } catch (err) { fail(res, err, 'ai review list'); }
  });

  router.get('/ai-reviews/latest', async (req, res) => {
    try { res.json({ review: await R().latest(kindParam(req)) }); } catch (err) { fail(res, err, 'ai review latest'); }
  });

  router.get('/ai-reviews/:id', async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(400).json({ error: 'Review id must be a number.' });
    try {
      const r = await R().get(Number(req.params.id));
      if (!r) return res.status(404).json({ error: 'That review is no longer here (the last 10 are kept).' });
      res.json({ review: r });
    } catch (err) { fail(res, err, 'ai review get'); }
  });

  // ── Context tab: a briefing about how Vault is built, for a Claude conversation (server/services/codeMap/briefing/). No model calls.
  // POST builds and stores one (the last 10 are kept); GET lists them / fetches one to copy again.
  router.post('/briefings', async (req, res) => {
    try {
      res.status(201).json(await B().build(req.user.id));
    } catch (err) { fail(res, err, 'briefing build'); }
  });

  router.get('/briefings', async (req, res) => {
    try {
      res.json({ briefings: await B().list(req.user.id) });
    } catch (err) { fail(res, err, 'briefing list'); }
  });

  router.get('/briefings/:id', async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(400).json({ error: 'Briefing id must be a number.' });
    try {
      const b = await B().get(req.user.id, Number(req.params.id));
      if (!b) return res.status(404).json({ error: 'That briefing is no longer here (the last 10 are kept).' });
      res.json({ briefing: b });
    } catch (err) { fail(res, err, 'briefing get'); }
  });

  router.get('/briefing/notes', async (req, res) => {
    try {
      res.json({ notes: await B().getNotes(req.user.id) });
    } catch (err) { fail(res, err, 'notes get'); }
  });

  router.put('/briefing/notes', async (req, res) => {
    const { notes } = req.body || {};
    if (notes !== undefined && typeof notes !== 'string') return res.status(400).json({ error: 'notes must be text.' });
    try {
      res.json({ notes: await B().saveNotes(req.user.id, notes || '') });
    } catch (err) { fail(res, err, 'notes save'); }
  });

  // CLAUDE.md read-only, every doc that can go with it (size, one-line summary), and which are ticked for this admin
  router.get('/briefing/claude-md', async (req, res) => {
    try {
      res.json(await B().claudeMd(req.user.id));
    } catch (err) { fail(res, err, 'claude-md'); }
  });

  // the ticked docs, saved per admin (only paths on the allow-list or in docs/ are kept); DELETE goes back to the defaults
  router.put('/briefing/docs', async (req, res) => {
    try {
      res.json(await B().saveDocs(req.user.id, (req.body || {}).paths));
    } catch (err) { fail(res, err, 'docs save'); }
  });

  router.delete('/briefing/docs', async (req, res) => {
    try {
      res.json(await B().resetDocs(req.user.id));
    } catch (err) { fail(res, err, 'docs reset'); }
  });

  // the block to copy: CLAUDE.md, the ticked docs and the "Docs not included in this copy" list, read on the server from the allow-list
  router.post('/briefing/docs-copy', async (req, res) => {
    const { paths } = req.body || {};
    if (paths !== undefined && !Array.isArray(paths)) return res.status(400).json({ error: 'paths must be a list of doc paths.' });
    try {
      res.json(await B().docsCopy(req.user.id, paths));
    } catch (err) { fail(res, err, 'docs copy'); }
  });

  router.get('/runs/:id', async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(400).json({ error: 'Run id must be a number.' });
    try {
      const run = await J().get(Number(req.params.id));
      if (!run) return res.status(404).json({ error: 'That run is no longer here (the last 30 are kept).' });
      res.json({ run });
    } catch (err) { fail(res, err, 'get'); }
  });

  return router;
}

module.exports = createCodeMapRouter();
module.exports.createCodeMapRouter = createCodeMapRouter;
