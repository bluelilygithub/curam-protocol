'use strict';

// Presentations API, mounted at /api/presentations. A thin index: each sidebar tool owns one module under ./presentations/.
// The canonical deck shape and all generation/export logic live in services/presentations/. See docs/presentations.md.

const express = require('express');
const { pool } = require('../db');
const { MAX_SLIDES } = require('../services/presentations/schema');
const { DESIGNS, LAYOUTS, plan } = require('../services/presentations/layouts');
const { getBrand } = require('../services/presentations/store');
const { sendError } = require('./presentations/shared');

const router = express.Router();

// Two sample slides per design style, laid out by the same plan() as the preview and exports, so the Themes gallery
// draws its thumbnails from the real geometry instead of a copy of it.
const SAMPLE_TITLE = { layout: 'title', title: 'Title', body: 'Subtitle' };
const SAMPLE_CONTENT = { layout: 'bullets', title: 'Heading', bullets: ['First point', 'Second point', 'Third point'] };
const DESIGN_GALLERY = DESIGNS.map((d) => ({
  ...d,
  samples: [plan(SAMPLE_TITLE, { designId: d.id }), plan(SAMPLE_CONTENT, { designId: d.id })],
}));

router.get('/meta', async (req, res) => {
  try {
    const brand = await getBrand(pool, req.user.id);
    res.json({
      maxSlides: MAX_SLIDES,
      brandKit: { available: brand.available, label: brand.label },
      designs: DESIGN_GALLERY,
      layouts: LAYOUTS,
    });
  } catch (err) { sendError(res, err, 'Presentation settings could not be read.'); }
});

router.use(require('./presentations/create'));
router.use(require('./presentations/outline'));
router.use(require('./presentations/import'));
router.use(require('./presentations/preview'));
router.use(require('./presentations/jobs'));
router.use(require('./presentations/assets'));
router.use(require('./presentations/decks'));
router.use(require('./presentations/templates'));
router.use(require('./presentations/export'));

module.exports = router;
