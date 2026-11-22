'use strict';

const express = require('express');
const { pool } = require('../../db');
const { generateOutline, generateDeck } = require('../../services/presentations/generation');
const { text, clampInt, normalizeOutline, DESIGN_IDS } = require('../../services/presentations/schema');
const { getBrand, resolveThemeForUser } = require('../../services/presentations/store');
const { addDeckPlaceholders } = require('../../services/presentations/placeholders');
const { startJob } = require('../../services/presentations/jobs');
const { resolveRequestedModel } = require('../../utils/userModelSelection');
const { sendError } = require('./shared');

const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const body = req.body || {};
    const brief = text(body.brief, 4000);
    const sourceText = text(body.sourceText, 24000);
    const hasOutline = Boolean(body.outline && Array.isArray(body.outline.slides) && body.outline.slides.length);
    if (!brief && !sourceText && !hasOutline) throw Object.assign(new Error('Write a brief or import a source first.'), { status: 400 });
    const imageRefs = Array.isArray(body.imageRefs) ? body.imageRefs.slice(0, 8).map((r) => text(r, 500)).filter(Boolean) : [];
    const applyBrand = body.applyBrand === true;
    const brand = await getBrand(pool, req.user.id);
    if (applyBrand && !brand.available) throw Object.assign(new Error('There is no Graphics Brand Kit to apply yet. Add one in Graphics first.'), { status: 400 });
    const theme = await resolveThemeForUser(pool, req.user.id, text(body.themeId, 80) || 'paper', brand, { applyBrand });
    const aspect = ['16:9', '4:3', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
    const designId = DESIGN_IDS.includes(body.designId) ? body.designId : 'clean';
    const controls = {
      nSlides: clampInt(body.nSlides, 10, 6, 20),
      audience: text(body.audience, 160),
      tone: text(body.tone, 80),
      duration: clampInt(body.duration, 12, 1, 180),
    };
    // A reviewed (and possibly edited) outline skips the planning call. Otherwise the same model plans it here.
    const editedOutline = body.outline && Array.isArray(body.outline.slides) && body.outline.slides.length
      ? normalizeOutline({ ...body.outline, ...controls })
      : null;
    // Optional explicit model. The shared helper ignores it for members unless Model Selection is on,
    // and only accepts a text id from this user's resolved vault_models. No id is hard-coded here.
    const selectedModel = await resolveRequestedModel({
      user: req.user,
      userId: req.user.id,
      requestedModel: text(body.model, 200),
    });
    const placeholders = body.placeholders !== false;
    const placeholderLimit = clampInt(body.placeholderCount, 3, 0, 20);
    const input = {
      userId: req.user.id, brief, sourceText, imageRefs, theme, aspect, designId, applyBrand,
      controls, editedOutline, placeholders, placeholderLimit, model: selectedModel,
    };

    const job = startJob({
      userId: req.user.id,
      kind: 'create',
      input,
      runner: async ({ signal, setProgress }) => {
        const deps = { signal };
        let outline = editedOutline;
        if (outline) {
          setProgress(20, 'Using your reviewed outline');
        } else {
          setProgress(15, 'Planning the slides');
          outline = await generateOutline({ ...input, controls, deps });
        }
        if (signal.aborted) return null;
        setProgress(55, 'Writing the slides');
        let deck = await generateDeck({ userId: req.user.id, outline, theme, designId, model: input.model, deps });
        if (signal.aborted) return null;
        let warning = '';
        if (placeholders && placeholderLimit) {
          const withPictures = await addDeckPlaceholders({ userId: req.user.id, deck, limit: placeholderLimit, deps, onProgress: setProgress });
          deck = withPictures.deck;
          warning = withPictures.warning;
        }
        if (signal.aborted) return null;
        return { deck, outline, warning };
      },
    });
    res.status(202).json({ jobId: job.id });
  } catch (err) { sendError(res, err, 'The deck could not be started.'); }
});

module.exports = router;
