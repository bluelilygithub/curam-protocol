'use strict';

// The route half of a guide: POST { messages, currentTool, context } -> the guide's reply (see services/guideCore.js). A "missing" or
// "partly" answer is a product gap, so it is also noted once in the Suggestions inbox. Nothing here reads files or writes documents.
// New guides use this (the older guide routes carry their own copy of the same code).

const express = require('express');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { getLogger } = require('../middleware/requestContext');

/**
 * @param {{ ask: Function, source: string, productName: string, logTag: string, context?: string, suggestionUserId?: (req) => number }} opts
 */
function makeGuideRouter({ ask, source, productName, logTag, suggestionUserId }) {
  const router = express.Router();
  router.post('/', async (req, res) => {
    try {
      const { messages, currentTool, context } = req.body || {};
      const userId = req.user.id;
      const reply = await ask(userId, { messages, currentTool: typeof currentTool === 'string' ? currentTool : '', context: typeof context === 'string' ? context : '' });
      if ((reply.verdict === 'missing' || reply.verdict === 'partly') && reply.missing) {
        const asked = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m?.role === 'user')?.content || '';
        const key = reply.missing.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(' ').filter(Boolean).slice(0, 12).join(' ');
        captureIf(true, {
          userId: suggestionUserId ? suggestionUserId(req) : userId,
          source,
          category: 'other',
          fingerprint: makeFingerprint(source, `gap:${key}`),
          title: `${productName}: people want "${reply.missing.slice(0, 70)}"`,
          body: `The ${productName} guide could not fully help.\n\nAsked: "${String(asked).slice(0, 300)}"\nMissing: ${reply.missing}\n\nWorth considering as a new feature or an addition to an existing one.`,
          context: `server/routes/${source}.js`,
        }).catch(() => {});
      }
      res.json(reply);
    } catch (err) {
      getLogger().error({ err }, logTag);
      res.status(err.status || 500).json({ error: err.status ? err.message : `The ${productName} guide could not answer just now. Try again in a moment.` });
    }
  });
  return router;
}

module.exports = { makeGuideRouter };
