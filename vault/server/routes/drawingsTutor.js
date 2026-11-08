'use strict';

// The Drawings guide (the round button on Vault's /drawings page): points at the page's real views and controls for a job, or says one
// is missing / the job is beyond Drawings. JSON only; it sees no drawings. Mounted at /api/drawings-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askDrawingsTutor } = require('../services/drawingsTutor');

module.exports = makeGuideRouter({ ask: askDrawingsTutor, source: 'drawingsTutor', productName: 'Diagrams', logTag: '[drawings/tutor]' });
