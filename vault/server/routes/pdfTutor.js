'use strict';

// The PDF Tools guide (the mini chat on the PDF page): points at the real PDF tools for a job, or says a piece is missing or
// is beyond PDF Tools. JSON only. It reads no documents and writes none: the only thing it receives is the conversation.
// A "missing" or "partly" answer is a product gap, so it is also noted in the Suggestions inbox (once per distinct gap), the
// same way the Video Tools and Finance guides do.
// Mounted in server/index.js at /api/pdf-tutor behind requireAuth (PDF Tools has no feature flag) and the AI rate limit.

const express = require('express');
const router = express.Router();
const { askPdfTutor } = require('../services/pdfTutor');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { getLogger } = require('../middleware/requestContext');

router.post('/', async (req, res) => {
  try {
    const { messages, currentTool } = req.body || {};
    const reply = await askPdfTutor(req.user.id, { messages, currentTool: typeof currentTool === 'string' ? currentTool : '' });

    if ((reply.verdict === 'missing' || reply.verdict === 'partly') && reply.missing) {
      const asked = [...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m?.role === 'user')?.content || '';
      const key = reply.missing.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(' ').filter(Boolean).slice(0, 12).join(' ');
      captureIf(true, {
        userId: req.user.id,
        source: 'pdfTutor',
        category: 'other',
        fingerprint: makeFingerprint('pdfTutor', `gap:${key}`),
        title: `PDF Tools: people want "${reply.missing.slice(0, 70)}"`,
        body: `The PDF guide could not fully help.\n\nAsked: "${String(asked).slice(0, 300)}"\nMissing: ${reply.missing}\n\nWorth considering as a new tool or an addition to an existing one.`,
        context: 'server/routes/pdfTutor.js',
      }).catch(() => {});
    }
    res.json(reply);
  } catch (err) {
    getLogger().error({ err }, '[pdf/tutor]');
    res.status(err.status || 500).json({ error: err.status === 400 ? err.message : 'The PDF guide could not answer just now. Try again in a moment.' });
  }
});

module.exports = router;
