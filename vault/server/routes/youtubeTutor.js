'use strict';

// The YouTube guide (the round button on Vault's /youtube page): points at the page's real controls for a job, or says one is missing / the
// job is beyond YouTube in Vault. JSON only; it sees no searches, videos or notes. Mounted at /api/youtube-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askYoutubeTutor } = require('../services/youtubeTutor');

module.exports = makeGuideRouter({ ask: askYoutubeTutor, source: 'youtubeTutor', productName: 'YouTube', logTag: '[youtube/tutor]' });
