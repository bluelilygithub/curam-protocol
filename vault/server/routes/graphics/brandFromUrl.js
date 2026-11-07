'use strict';

// "Brand from a website" (docs/brand-from-url.md, step 2).
//
//   POST /api/graphics/brand-from-url { url }          -> { ok, id, expiresInSec, colours, palette, dark, radius, fonts, logos, logoIndex, warnings, ... }
//   GET  /api/graphics/brand-from-url/:id/font/:role   -> the converted font file (role = heading | body), so the screen can show a sample
//
// It only READS a public website and proposes a brand. Nothing is saved: the proposal (with its font files) is kept in memory for 30
// minutes under a random id that only the person who made it can use, and a later "Use this" will refer to that id. Free to run (no
// paid API) but heavy (a browser page), so it is limited to one read at a time per person and 12 an hour.

const express = require('express');
const router = express.Router();
const { createProposalStore, createRunLimiter } = require('../../services/brandFromUrl/proposalStore');

const store = createProposalStore();
const limiter = createRunLimiter();

function log() {
  try { return require('../../middleware/requestContext').getLogger(); } catch { return { info() {}, warn() {} }; }
}

/** The proposal as the browser sees it: the font files stay on the server (only their facts go out). */
function publicProposal(brand) {
  const fonts = {};
  for (const role of ['heading', 'body']) {
    const f = brand.fonts && brand.fonts[role];
    if (!f) { fonts[role] = null; continue; }
    fonts[role] = {
      family: f.family, weight: f.weight, system: f.system, source: f.source,
      file: f.file ? {
        renderFamily: f.file.renderFamily, internalFamily: f.file.internalFamily, weight: f.file.weight, bytes: f.file.bytes,
        ext: f.file.ext, variable: f.file.variable, instanced: f.file.instanced, sha256: f.file.sha256,
      } : null,
    };
  }
  // `logo` repeated logos[0] (a whole picture twice); the screen just uses logos[logoIndex]
  const { logo: _repeat, ...rest } = brand;
  return { ...rest, fonts, logoIndex: brand.logos && brand.logos.length ? 0 : null };
}

router.post('/brand-from-url', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url || url.length > 2048) return res.status(400).json({ error: 'Enter a web address like example.com' });
  let end;
  try {
    end = limiter.begin(req.user.id);
  } catch (err) {
    return res.status(err.status || 429).json({ error: err.message });
  }
  const started = Date.now();
  try {
    // loaded on first use: the browser library is only needed when someone actually reads a website
    const brand = await require('../../services/brandFromUrl').extractBrand(url);
    const id = store.put(req.user.id, brand);
    let host = '';
    try { host = new URL(brand.finalUrl).hostname; } catch { /* leave blank */ }
    log().info({ userId: req.user.id, host, ms: Date.now() - started, logos: brand.logos.length, warnings: brand.warnings.length }, 'brand-from-url: read a website');
    return res.json({ ok: true, id, expiresInSec: store.ttlSeconds(), ...publicProposal(brand) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) log().warn({ userId: req.user.id, err: err.message }, 'brand-from-url: failed');
    // a plain-words message for the person; an unexpected failure does not leak internals
    return res.status(status).json({ error: status >= 500 && !err.status ? 'Could not read that website.' : err.message });
  } finally {
    end();
  }
});

router.get('/brand-from-url/:id/font/:role', (req, res) => {
  const role = req.params.role;
  if (role !== 'heading' && role !== 'body') return res.status(400).json({ error: 'role must be heading or body' });
  const brand = store.get(req.user.id, req.params.id);
  const file = brand && brand.fonts && brand.fonts[role] && brand.fonts[role].file;
  if (!file) return res.status(404).json({ error: 'That font is no longer available. Read the website again.' });
  res.set({ 'content-type': file.ext === 'otf' ? 'font/otf' : 'font/ttf', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  return res.send(file.buffer);
});

module.exports = router;
module.exports.publicProposal = publicProposal;
module.exports.store = store;
