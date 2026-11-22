'use strict';

const express = require('express');
const { pool } = require('../../db');
const { generateOutline, generateDeck } = require('../../services/presentations/generation');
const { text, DESIGN_IDS } = require('../../services/presentations/schema');
const { getBrand, resolveThemeForUser } = require('../../services/presentations/store');
const { startJob } = require('../../services/presentations/jobs');
const { resolveRequestedModel } = require('../../utils/userModelSelection');
const { sendError } = require('./shared');

const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const body = req.body || {};
    const brief = text(body.brief, 4000);
    const sourceText = text(body.sourceText, 24000);
    if (!brief && !sourceText) throw Object.assign(new Error('Write a brief or import a source first.'), { status: 400 });
    const imageRefs = Array.isArray(body.imageRefs) ? body.imageRefs.slice(0, 8).map((r) => text(r, 500)).filter(Boolean) : [];
    const applyBrand = body.applyBrand === true;
    const brand = await getBrand(pool, req.user.id);
    if (applyBrand && !brand.available) throw Object.assign(new Error('There is no Graphics Brand Kit to apply yet. Add one in Graphics first.'), { status: 400 });
    const theme = await resolveThemeForUser(pool, req.user.id, text(body.themeId, 80) || 'paper', brand, { applyBrand });
    const aspect = ['16:9', '4:3', '1:1'].includes(body.aspect) ? body.aspect : '16:9';
    const designId = DESIGN_IDS.includes(body.designId) ? body.designId : 'clean';
    // Optional explicit model. The shared helper ignores it for members unless Model Selection is on,
    // and only accepts a text id from this user's resolved vault_models. No id is hard-coded here.
    const selectedModel = await resolveRequestedModel({
      user: req.user,
      userId: req.user.id,
      requestedModel: text(body.model, 200),
    });
    const input = { userId: req.user.id, brief, sourceText, imageRefs, theme, aspect, designId, applyBrand, model: selectedModel };

    const job = startJob({
      userId: req.user.id,
      kind: 'create',
      input,
      runner: async ({ signal, setProgress }) => {
        const deps = { signal };
        setProgress(15, 'Planning the slides');
        const outline = await generateOutline({ ...input, deps });
        if (signal.aborted) return null;
        setProgress(55, 'Writing the slides');
        const deck = await generateDeck({ userId: req.user.id, outline, theme, designId, model: input.model, deps });
        if (signal.aborted) return null;
        return { deck };
      },
    });
    res.status(202).json({ jobId: job.id });
  } catch (err) { sendError(res, err, 'The deck could not be started.'); }
});

module.exports = router;
