'use strict';

const express = require('express');
const { pool } = require('../../db');
const { getBrand, getBrandFont, resolveThemeForUser } = require('../../services/presentations/store');
const { inlineAssets } = require('../../services/presentations/export');
const { renderDeckHtml } = require('../../services/presentations/render');
const { sendError } = require('./shared');

const router = express.Router();

router.post('/preview', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.deck || !Array.isArray(body.deck.slides)) throw Object.assign(new Error('There is no deck to preview yet.'), { status: 400 });
    const applyBrand = body.applyBrand === true;
    const brand = await getBrand(pool, req.user.id);
    if (applyBrand && !brand.available) throw Object.assign(new Error('There is no Graphics Brand Kit to apply yet.'), { status: 400 });
    const theme = await resolveThemeForUser(pool, req.user.id, body.theme || body.deck.themeId, brand, { applyBrand });
    const font = applyBrand ? await getBrandFont(pool, req.user.id, brand) : null;
    // The live preview and slideshow run in a sandboxed iframe, which cannot send the Bearer token either.
    // Inline owned assets the same way the exported HTML does.
    const html = await inlineAssets(renderDeckHtml(body.deck, theme, { font }), req.user.id);
    res.json({ html });
  } catch (err) { sendError(res, err, 'The preview could not be made.'); }
});

module.exports = router;
