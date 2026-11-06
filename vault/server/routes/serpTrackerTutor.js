'use strict';

// The SERP Tracker guide (the round button on Vault's /serp-tracker page): points at the page's real parts for a job, or says one is missing /
// the job is beyond this page. JSON only; it sees no site, searches, results, costs or settings. Mounted at /api/serp-tracker-tutor behind the
// AI rate limit and the serpTracker flag.

const { makeGuideRouter } = require('./guideRouter');
const { askSerpTrackerTutor } = require('../services/serpTrackerTutor');

module.exports = makeGuideRouter({ ask: askSerpTrackerTutor, source: 'serpTrackerTutor', productName: 'SERP Tracker', logTag: '[serp-tracker/tutor]' });
