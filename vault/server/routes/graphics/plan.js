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
    const result = await planGraphicsRequest(req.user.id, transcript, catalog);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
