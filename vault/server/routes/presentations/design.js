'use strict';

// Quick, deterministic design transforms. Unlike generation this makes no model calls and changes no words: it only
// rewrites layout and composition hints on the canonical deck.

const express = require('express');
const { normalizeDeck } = require('../../services/presentations/schema');
const { remixDeck } = require('../../services/presentations/design');
const { plan, DESIGN_IDS } = require('../../services/presentations/layouts');
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

// Thumbnails for the Themes gallery: the same plan() as the preview and exports, applied to the person's own slides.
// Geometry only — no images are fetched or sent — so it is quick and works with owned/private image refs.
router.post('/design-samples', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.deck || !Array.isArray(body.deck.slides) || !body.deck.slides.length) {
      throw Object.assign(new Error('There is no deck to preview designs on yet.'), { status: 400 });
    }
    const deck = normalizeDeck(body.deck);
    const ids = Array.isArray(body.designIds)
      ? body.designIds.filter((id) => DESIGN_IDS.includes(id))
      : DESIGN_IDS;
    const contentIndex = deck.slides.findIndex((s) => !['title', 'section', 'closing'].includes(s.layout));
    const indices = [...new Set([0, contentIndex].filter((i) => i >= 0))].slice(0, 2);
    res.json({
      samples: ids.map((id) => ({
        id,
        samples: indices.map((index) => plan(deck.slides[index], { designId: id })),
      })),
    });
  } catch (err) { return sendError(res, err, 'The design samples could not be made.'); }
});

module.exports = router;
