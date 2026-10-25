'use strict';

// The printer's own CMYK colour profile for Print Ready: GET /print-profile (anyone: what is in use), POST and DELETE (admin only).
// Press standards (FOGRA39, GRACoL ...) are licensed by their owners, so Vault does not bundle one: the printer supplies theirs, an admin
// uploads it once, and every TIFF/CMYK made in Print Ready uses it. Without one the built-in generic profile is used. See
// services/graphicsColour.js.

const express = require('express');
const router = express.Router();
const { pool } = require('./shared');
const colour = require('../../services/graphicsColour');

router.get('/print-profile', async (req, res) => {
  try {
    const custom = await colour.loadCustomProfile(pool);
    res.set('Cache-Control', 'no-store');
    res.json({
      builtin: { name: colour.BUILTIN_NAME },
      custom: custom ? { name: custom.name, bytes: custom.bytes, updatedAt: custom.updatedAt } : null,
      canEdit: Boolean(req.user?.isAdmin),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/print-profile', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Only an administrator can set the printer profile.' });
  try {
    const data = String(req.body?.dataBase64 || '').replace(/^data:[^,]*,/, '');
    const saved = await colour.saveCustomProfile(pool, Buffer.from(data, 'base64'));
    res.json({ ok: true, custom: saved });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Could not save the profile' });
  }
});

router.delete('/print-profile', async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Only an administrator can change the printer profile.' });
  try {
    await colour.removeCustomProfile(pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
