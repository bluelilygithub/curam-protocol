'use strict';

// /api/code-map: the admin Code Map (analysis of Vault's own source). Mounted behind requireAdmin in server/index.js, with no aiLimiter
// on the mount because the analysis makes no model calls; the one route that does (POST /findings/explain) has aiLimiter itself.
// Runs are background jobs (server/services/codeMap/jobs.js). Named routes before /:id.
// Injectable (jobs, explain, limiter) so the route test needs no database or model.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const { compareRuns } = require('../services/codeMap/compare');

function createCodeMapRouter({ jobs, explain, limiter } = {}) {
  const router = express.Router();
  const J = () => jobs || require('../services/codeMap/jobs');
  const ask = explain || ((userId, input) => require('../services/codeMap/explain').explainFinding(userId, input));
  const ai = limiter || require('../middleware/aiRateLimit').aiLimiter;

  const fail = (res, err, what) => {
    const status = err.status || 500;
    if (status >= 500) getLogger().error({ err }, `[codeMap] ${what}`);
    // our own errors carry a status and a message meant for the admin (e.g. 503 "No AI model is set up"); anything else is hidden
    res.status(status).json({ error: err.status ? err.message : 'Something went wrong. Try again.', ...(err.runningId ? { runningId: err.runningId } : {}) });
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
