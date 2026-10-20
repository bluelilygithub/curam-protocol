'use strict';

// The PC Health guide (the round button on Vault's /pc-health page, admin only): points at the page's real tools and controls for a
// job, or says one is missing / the job is beyond PC Health. JSON only; it sees no scan data. Mounted at /api/pc-health-tutor behind
// requireAdmin and the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askPcHealthTutor } = require('../services/pcHealthTutor');

module.exports = makeGuideRouter({ ask: askPcHealthTutor, source: 'pcHealthTutor', productName: 'PC Health', logTag: '[pc-health/tutor]' });
