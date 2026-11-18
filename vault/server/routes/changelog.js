'use strict';

// /api/changelog — admin only. Registered behind requireAdmin and aiLimiter in server/index.js. See docs/changelog.md.
// GET / lists every entry; POST /ask answers a question from the entries (server/services/changelogAsk.js), the one route that calls a model.
// Injectable (list, ask) so the route test needs no database or model.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');

function createChangelogRouter({ list, ask } = {}) {
  const router = express.Router();
  const listEntries = list || (() => require('../services/changelog').listChangelog());
  const askQuestion = ask || ((userId, question) => require('../services/changelogAsk').askChangelog(userId, question));

  router.get('/', async (req, res) => {
    try {
      res.json({ entries: await listEntries() });
    } catch (err) {
      getLogger().error({ err }, '[changelog] list');
      res.status(500).json({ error: 'The changelog could not be loaded.' });
    }
  });

  router.post('/ask', async (req, res) => {
    const { question } = req.body || {};
    try {
      res.json(await askQuestion(req.user.id, question));
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) getLogger().error({ err }, '[changelog] ask');
      // our own errors carry a status and a message meant for the admin; anything else is hidden
      res.status(status).json({ error: err.status ? err.message : 'The question could not be answered. Try again.' });
    }
  });

  return router;
}

module.exports = createChangelogRouter();
module.exports.createChangelogRouter = createChangelogRouter;
