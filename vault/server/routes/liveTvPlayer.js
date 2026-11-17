'use strict';

// The Live TV player page (docs/live-tv.md): GET /api/live-tv-player/ and its two scripts. Mounted BEFORE requireAuth because a frame
// cannot send Vault's login header; it is safe without one because it holds no data and only plays a stream address the Live TV page
// passes it (same-origin postMessage). It has its OWN Content-Security-Policy so this one page may load video from outside servers while
// the rest of Vault keeps its strict rules: setHeader replaces the policy helmet set, rather than adding a second one.

const express = require('express');
const path = require('path');

const router = express.Router();
const DIR = path.join(__dirname, '../services/liveTv/player');
const FILES = { '/': 'index.html', '/player.js': 'player.js', '/hls.light.min.js': 'hls.light.min.js' };

const PLAYER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  // http: streams are blocked by the browser on an https page anyway; leaving them out keeps the rule honest.
  'media-src https: blob:',
  'connect-src https:',
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

for (const [route, file] of Object.entries(FILES)) {
  router.get(route, (req, res) => {
    res.setHeader('Content-Security-Policy', PLAYER_CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', file === 'hls.light.min.js' ? 'public, max-age=604800' : 'no-cache');
    res.sendFile(path.join(DIR, file));
  });
}

module.exports = router;
module.exports.PLAYER_CSP = PLAYER_CSP;
