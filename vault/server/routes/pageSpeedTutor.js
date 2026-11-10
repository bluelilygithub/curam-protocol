'use strict';

// The Page speed guide (the round button on Vault's /html page): points at the page's real parts for a job, or says one is missing /
// the job is beyond this page. JSON only; it sees no address, score or report. Mounted at /api/page-speed-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askPageSpeedTutor } = require('../services/pageSpeedTutor');

module.exports = makeGuideRouter({ ask: askPageSpeedTutor, source: 'pageSpeedTutor', productName: 'Page speed', logTag: '[page-speed/tutor]' });
