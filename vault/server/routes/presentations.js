'use strict';

// Presentations API, mounted at /api/presentations. A thin index: each sidebar tool owns one module under ./presentations/.
// The canonical deck shape and all generation/export logic live in services/presentations/. See docs/presentations.md.

const express = require('express');
const { pool } = require('../db');
const { MAX_SLIDES } = require('../services/presentations/schema');
const { getBrand } = require('../services/presentations/store');
const { sendError } = require('./presentations/shared');

const router = express.Router();

router.get('/meta', async (req, res) => {
  try {
    const brand = await getBrand(pool, req.user.id);
    res.json({ maxSlides: MAX_SLIDES, brandKit: { available: brand.available, label: brand.label } });
  } catch (err) { sendError(res, err, 'Presentation settings could not be read.'); }
});

router.use(require('./presentations/create'));
router.use(require('./presentations/import'));
router.use(require('./presentations/preview'));
router.use(require('./presentations/jobs'));
router.use(require('./presentations/assets'));
router.use(require('./presentations/decks'));
router.use(require('./presentations/templates'));
router.use(require('./presentations/export'));

module.exports = router;
