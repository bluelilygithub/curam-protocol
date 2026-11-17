'use strict';

// The Live TV guide (the round button on Vault's /live-tv page): points at the page's real controls for a job, or says one is missing /
// the job is beyond Live TV. JSON only; it sees no channels, favourites or history. Mounted at /api/live-tv-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askLiveTvTutor } = require('../services/liveTvTutor');

module.exports = makeGuideRouter({ ask: askLiveTvTutor, source: 'liveTvTutor', productName: 'Live TV', logTag: '[live-tv/tutor]' });
