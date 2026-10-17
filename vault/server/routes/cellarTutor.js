'use strict';

// The Cellar Planner guide for staff (the round button on Vault's /cellar-planner page): points at the planner's real screens for a job, or
// says one is missing / the job is beyond the planner. JSON only; it reads no designs. Mounted at /api/cellar-tutor behind the `cellarPlanner`
// feature flag and the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askCellarTutor } = require('../services/cellarTutor');

module.exports = makeGuideRouter({ ask: askCellarTutor, source: 'cellarTutor', productName: 'Cellar Planner', logTag: '[cellar/tutor]' });
