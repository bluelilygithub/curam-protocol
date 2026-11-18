'use strict';

// /api/code-map: the admin Code Map (analysis of Vault's own source). Mounted behind requireAdmin in server/index.js, with no aiLimiter
// because the analysis makes no model calls. Runs are background jobs (server/services/codeMap/jobs.js). Named routes before /:id.
// Injectable (jobs) so the route test needs no database.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');

function createCodeMapRouter({ jobs } = {}) {
  const router = express.Router();
  const J = () => jobs || require('../services/codeMap/jobs');

  const fail = (res, err, what) => {
    const status = err.status || 500;
    if (status >= 500) getLogger().error({ err }, `[codeMap] ${what}`);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Try again.' : err.message, ...(err.runningId ? { runningId: err.runningId } : {}) });
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

  // drift between two runs: milestone 4
  router.get('/compare', (req, res) => {
    res.status(501).json({ error: 'Comparing runs is not built yet.' });
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
