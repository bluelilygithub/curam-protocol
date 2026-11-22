'use strict';

// Pictures brought in through Import source. The URL carries the owner id; the route refuses to serve anyone else's folder.

const express = require('express');
const { assetDir, safeAssetName } = require('../../services/presentations/sources');

const router = express.Router();

router.get('/assets/:userId/:name', (req, res) => {
  const owner = Number(req.params.userId);
  if (!Number.isInteger(owner) || owner !== req.user.id) return res.status(404).json({ error: 'That picture was not found.' });
  let name;
  try { name = safeAssetName(req.params.name); } catch { return res.status(404).json({ error: 'That picture was not found.' }); }
  return res.sendFile(name, { root: assetDir(owner), headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'That picture was not found.' });
  });
});

module.exports = router;
