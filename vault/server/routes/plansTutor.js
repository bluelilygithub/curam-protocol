'use strict';

// The Plans guide (the round button on Vault's /plans page): points at the page's real views and controls for a job, or says one is missing /
// the job is beyond Plans. JSON only; it sees no plans. Mounted at /api/plans-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askPlansTutor } = require('../services/plansTutor');

module.exports = makeGuideRouter({ ask: askPlansTutor, source: 'plansTutor', productName: 'Plans', logTag: '[plans/tutor]' });
