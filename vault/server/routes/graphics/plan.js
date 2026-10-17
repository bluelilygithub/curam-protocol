'use strict';

// "Ask Graphics" — plain-English/voice intake that turns a request into a checklist of real
// Graphics steps. See client/src/components/GraphicsAskPanel.jsx for the UI and
// server/services/graphicsPlanService.js for the parsing/validation. This route just wires auth
// + the service together, same shallow shape as every other route in ./graphics/.

const express = require('express');
const router = express.Router();
const { planGraphicsRequest } = require('../../services/graphicsPlanService');

router.post('/plan-request', async (req, res) => {
  try {
    const transcript = String(req.body?.transcript || '');
    const catalog = req.body?.catalog;
    // The catalog comes from the browser and goes into the model prompt, so bound it (the real one is about 20 modes).
    if (transcript.length > 2000) return res.status(400).json({ error: 'That request is too long. Keep it under 2,000 characters.' });
    if (Array.isArray(catalog) && (catalog.length > 60 || JSON.stringify(catalog).length > 80000)) {
      return res.status(400).json({ error: 'The list of editing modes is too large.' });
    }
    const result = await planGraphicsRequest(req.user.id, transcript, catalog);
    res.json({ ok: true, ...result });
  } catch (err) {
    // 400/422 are the person's request; 503 is a workspace setup gap; anything else is the AI provider failing.
    res.status(err.status || 502).json({ error: err.status ? err.message : 'The AI service could not plan that just now. Try again in a moment.' });
  }
});

module.exports = router;
