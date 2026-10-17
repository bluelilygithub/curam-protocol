'use strict';

// The Finance tutor (the mini chat in Finance): points at the real Finance tabs for a job, explains how the app works, or says a
// piece is missing / is a question for the accountant. JSON only. It reads no Finance data and writes none: the only thing it
// receives is the conversation. A "missing" or "partly" answer is a product gap, so it is also noted in the Suggestions inbox
// (once per distinct gap), the same way the Video Tools tutor does.
// Mounted in server/index.js at /api/finance-tutor behind requireFeature('finance') and the AI rate limit.

const express = require('express');
const router = express.Router();
const { askFinanceTutor } = require('../services/financeTutor');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { getLogger } = require('../middleware/requestContext');

router.post('/', async (req, res) => {
  try {
    const { messages, currentTab } = req.body || {};
    const reply = await askFinanceTutor(req.user.id, { messages, currentTab: typeof currentTab === 'string' ? currentTab : '' });

    if ((reply.verdict === 'missing' || reply.verdict === 'partly') && reply.missing) {
      const asked = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m?.role === 'user')?.content || '';
      const key = reply.missing.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(' ').filter(Boolean).slice(0, 12).join(' ');
      captureIf(true, {
        userId: req.user.id,
        source: 'financeTutor',
        category: 'other',
        fingerprint: makeFingerprint('financeTutor', `gap:${key}`),
        title: `Finance: people want "${reply.missing.slice(0, 70)}"`,
        body: `The Finance tutor could not fully help.\n\nAsked: "${String(asked).slice(0, 300)}"\nMissing: ${reply.missing}\n\nWorth considering as a new feature or an addition to an existing tab.`,
        context: 'server/routes/financeTutor.js',
      }).catch(() => {});
    }
    res.json(reply);
  } catch (err) {
    getLogger().error({ err }, '[finance/tutor]');
    res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'The Finance guide could not answer just now. Try again in a moment.' });
  }
});

module.exports = router;
