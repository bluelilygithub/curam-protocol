'use strict';

// Brand Kit storage for a brand read from a website (docs/brand-from-url.md, step 3).
//
//   POST   /api/graphics/brand-from-url/:id/apply   { use: { colours, radius, logoIndex, fonts: { heading, body } } } -> { ok, changed, kit, fonts }
//   GET    /api/graphics/brand-kit/fonts            -> [{ role, family, weight, renderFamily, ext, bytes, source, sourceUrl, updatedAt }]
//   GET    /api/graphics/brand-kit/fonts/:role/file -> the stored font file (heading | body)
//   DELETE /api/graphics/brand-kit/fonts/:role      -> removes the stored file; the kit keeps the font's name
//
// Everything is the signed-in person's own: every query filters by "userId", and a proposal id from another person answers 404.

const express = require('express');
const router = express.Router();
const { pool } = require('../../db');
const kitStore = require('../../services/graphicsBrandKit');
const { store } = require('./brandFromUrl');

function log() {
  try { return require('../../middleware/requestContext').getLogger(); } catch { return { info() {}, warn() {} }; }
}

const fail = (res, err, fallback) => {
  const status = err.status || 500;
  if (status >= 500) log().warn({ err: err.message }, `brand-kit: ${fallback}`);
  return res.status(status).json({ error: status >= 500 && !err.status ? fallback : err.message });
};

router.post('/brand-from-url/:id/apply', async (req, res) => {
  try {
    const proposal = store.get(req.user.id, req.params.id);
    if (!proposal) return res.status(404).json({ error: 'That website reading has expired. Read the website again.' });
    const out = await kitStore.applyProposal(pool, req.user.id, proposal, req.body && req.body.use);
    log().info({ userId: req.user.id, changed: out.changed }, 'brand-kit: applied a website reading');
    return res.json({ ok: true, ...out });
  } catch (err) {
    return fail(res, err, 'Could not save the brand.');
  }
});

router.get('/brand-kit/fonts', async (req, res) => {
  try {
    return res.json({ fonts: await kitStore.listFonts(pool, req.user.id) });
  } catch (err) {
    return fail(res, err, 'Could not read the brand fonts.');
  }
});

router.get('/brand-kit/fonts/:role/file', async (req, res) => {
  try {
    const f = await kitStore.getFontFile(pool, req.user.id, req.params.role);
    if (!f) return res.status(404).json({ error: 'No font is stored for that.' });
    res.set({ 'content-type': f.ext === 'otf' ? 'font/otf' : 'font/ttf', 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff', etag: `"${f.sha256}"` });
    return res.send(f.data);
  } catch (err) {
    return fail(res, err, 'Could not read the brand font.');
  }
});

router.delete('/brand-kit/fonts/:role', async (req, res) => {
  try {
    const removed = await kitStore.deleteFont(pool, req.user.id, req.params.role);
    if (!removed) return res.status(404).json({ error: 'No font is stored for that.' });
    return res.json({ ok: true });
  } catch (err) {
    return fail(res, err, 'Could not remove the brand font.');
  }
});

module.exports = router;
