'use strict';

// The Shares guide (the round button on Vault's /shares page): points at the real controls for a job, or says one is missing / the job is beyond Shares.
// JSON only; it sees no holdings or figures. Mounted at /api/shares-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askSharesTutor } = require('../services/sharesTutor');

module.exports = makeGuideRouter({ ask: askSharesTutor, source: 'sharesTutor', productName: 'Shares', logTag: '[shares/tutor]' });
