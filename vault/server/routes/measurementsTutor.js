'use strict';

// The Measurements guide (the round button on Vault's /measurements page): points at the page's real tools and controls for a job, or
// says one is missing / the job is beyond Measurements. JSON only; it sees no values or documents. Mounted at /api/measurements-tutor
// behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askMeasurementsTutor } = require('../services/measurementsTutor');

module.exports = makeGuideRouter({ ask: askMeasurementsTutor, source: 'measurementsTutor', productName: 'Measurements', logTag: '[measurements/tutor]' });
