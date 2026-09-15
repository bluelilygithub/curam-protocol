'use strict';

// Graphics tools API, mounted at /api/graphics. This file is a thin index —
// each sidebar tool group lives in its own module under ./graphics/, grouped
// to match vault/docs/graphics-tools.md. Shared setup (comfy/fal/replicate
// generation core, upscale/background helpers, cross-cutting image utils
// like clampInt/parseHexColor/GRAVITY_MAP/SOCIAL_PRESETS, and the
// import-by-URL route) lives in ./graphics/shared.js.
//
// External behavior (URL paths, methods, request/response shapes) is
// unchanged from the previous single-file implementation.

const express = require('express');
const router = express.Router();

const shared = require('./graphics/shared');
const create = require('./graphics/create');
const optimise = require('./graphics/optimise');
const transform = require('./graphics/transform');
const enhance = require('./graphics/enhance');
const compose = require('./graphics/compose');
const retouch = require('./graphics/retouch');
const analyse = require('./graphics/analyse');

router.use(shared.router);
router.use(create);
router.use(optimise);
router.use(transform);
router.use(enhance);
router.use(compose);
router.use(retouch);
router.use(analyse);

module.exports = router;
