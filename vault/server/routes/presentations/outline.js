'use strict';

// Outline review, single-slide rewrite and low-cost placeholder pictures. These are quick calls, so unlike deck
// creation and export they answer directly instead of opening a background job.

const express = require('express');
const { generateOutline, rewriteSlide } = require('../../services/presentations/generation');
const { text, clampInt, normalizeDeck, normalizeOutline } = require('../../services/presentations/schema');
const { makePlaceholder } = require('../../services/presentations/placeholders');
const { resolveRequestedModel } = require('../../utils/userModelSelection');
const { sendError } = require('./shared');

const router = express.Router();

function controlsFrom(body) {
  return {
    nSlides: clampInt(body.nSlides, 10, 6, 20),
    audience: text(body.audience, 160),
    tone: text(body.tone, 80),
    duration: clampInt(body.duration, 12, 1, 180),
  };
}

async function pickedModel(req, body) {
  return resolveRequestedModel({
    user: req.user,
    userId: req.user.id,
    requestedModel: text(body.model, 200),
  });
}

router.post('/outline', async (req, res) => {
  try {
    const body = req.body || {};
    const brief = text(body.brief, 4000);
    const sourceText = text(body.sourceText, 24000);
    if (!brief && !sourceText) throw Object.assign(new Error('Write a brief or import a source first.'), { status: 400 });
    const imageRefs = Array.isArray(body.imageRefs) ? body.imageRefs.slice(0, 8).map((r) => text(r, 500)).filter(Boolean) : [];
    const outline = await generateOutline({
      userId: req.user.id,
      brief,
      sourceText,
      imageRefs,
      controls: controlsFrom(body),
      model: await pickedModel(req, body),
    });
    return res.json({ outline });
  } catch (err) { return sendError(res, err, 'The outline could not be planned.'); }
});

router.post('/rewrite-slide', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.deck) throw Object.assign(new Error('There is no deck to edit yet.'), { status: 400 });
    const result = await rewriteSlide({
      userId: req.user.id,
      deck: normalizeDeck(body.deck),
      index: body.index,
      instruction: text(body.instruction, 600),
      model: await pickedModel(req, body),
    });
    return res.json(result);
  } catch (err) { return sendError(res, err, 'That slide could not be rewritten.'); }
});

router.post('/placeholders', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await makePlaceholder({
      userId: req.user.id,
      deck: { title: text(body.deckTitle, 160) },
      slide: { title: text(body.title, 120), imagePrompt: text(body.imagePrompt || body.prompt, 300) },
      index: clampInt(body.index, 0, 0, 20),
    });
    return res.json({ ok: Boolean(result.imageRef), imageRef: result.imageRef, warning: result.warning });
  } catch (err) { return sendError(res, err, 'A placeholder picture could not be made.'); }
});

module.exports = router;
module.exports.controlsFrom = controlsFrom;
