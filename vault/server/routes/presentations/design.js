'use strict';

// Quick, deterministic design transforms. Unlike generation this makes no model calls and changes no words: it only
// rewrites layout and composition hints on the canonical deck.

const express = require('express');
const { normalizeDeck } = require('../../services/presentations/schema');
const { remixDeck } = require('../../services/presentations/design');
const { sendError } = require('./shared');

const router = express.Router();

router.post('/remix-design', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.deck) throw Object.assign(new Error('There is no deck to remix yet.'), { status: 400 });
    const result = await remixDeck(normalizeDeck(body.deck), { userId: req.user.id });
    return res.json({
      deck: result.deck,
      score: result.score,
      previousScore: result.previousScore,
      improvements: result.improvements,
    });
  } catch (err) { return sendError(res, err, 'The design could not be remixed.'); }
});

module.exports = router;
