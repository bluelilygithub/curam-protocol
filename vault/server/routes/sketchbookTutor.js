'use strict';

// The Sketchbook guide (the round button on Vault's /sketchbook page): points at the page's real views and controls for a job, or says one
// is missing / the job is beyond Sketchbook. JSON only; it sees no sketches. Mounted at /api/sketchbook-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askSketchbookTutor } = require('../services/sketchbookTutor');

module.exports = makeGuideRouter({ ask: askSketchbookTutor, source: 'sketchbookTutor', productName: 'Sketchbook', logTag: '[sketchbook/tutor]' });
