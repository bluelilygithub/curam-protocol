'use strict';

// The Graphics guide (the mini chat on the Graphics page): points at the real Graphics tools for a job, or says a piece is
// missing or is beyond Graphics. JSON only. It reads no images and writes none: the only thing it receives is the conversation.
// A "missing" or "partly" answer is a product gap, so it is also noted in the Suggestions inbox (once per distinct gap), the
// same way the Video Tools, PDF and Finance guides do.
// Mounted in server/index.js at /api/graphics-tutor behind requireAuth, the `graphics` feature flag and the AI rate limit.

const express = require('express');
const router = express.Router();
const { askGraphicsTutor } = require('../services/graphicsTutor');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { getLogger } = require('../middleware/requestContext');

router.post('/', async (req, res) => {
  try {
    const { messages, currentTool } = req.body || {};
    const reply = await askGraphicsTutor(req.user.id, { messages, currentTool: typeof currentTool === 'string' ? currentTool : '' });

    if ((reply.verdict === 'missing' || reply.verdict === 'partly') && reply.missing) {
      const asked = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m?.role === 'user')?.content || '';
      const key = reply.missing.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(' ').filter(Boolean).slice(0, 12).join(' ');
      captureIf(true, {
        userId: req.user.id,
        source: 'graphicsTutor',
        category: 'other',
        fingerprint: makeFingerprint('graphicsTutor', `gap:${key}`),
        title: `Graphics: people want "${reply.missing.slice(0, 70)}"`,
        body: `The Graphics guide could not fully help.\n\nAsked: "${String(asked).slice(0, 300)}"\nMissing: ${reply.missing}\n\nWorth considering as a new tool or an addition to an existing one.`,
        context: 'server/routes/graphicsTutor.js',
      }).catch(() => {});
    }
    res.json(reply);
  } catch (err) {
    getLogger().error({ err }, '[graphics/tutor]');
    res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'The Graphics guide could not answer just now. Try again in a moment.' });
  }
});

module.exports = router;
