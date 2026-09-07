const express = require('express');
const router = express.Router();

// Railway sets these automatically for deployments built from a connected git repo — exposing
// them lets anyone verify exactly which commit is actually serving traffic (via curl) instead of
// inferring it from build timestamps or Docker digests, neither of which prove the checked-out
// commit. Undefined locally / on any host that doesn't set them (fine, this is a prod-verification
// aid, not a required field).
router.get('/', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    branch: process.env.RAILWAY_GIT_BRANCH || null,
  });
});

module.exports = router;
