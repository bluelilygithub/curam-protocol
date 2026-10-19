'use strict';

// The Web Extractor guide (the round button on Vault's /web-extractor page): points at the page's real tools and buttons for a job, or
// says one is missing / the job is beyond Web Extractor. JSON only; it reads no pages. Mounted at /api/web-extractor-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askWebExtractorTutor } = require('../services/webExtractorTutor');

module.exports = makeGuideRouter({ ask: askWebExtractorTutor, source: 'webExtractorTutor', productName: 'Web Extractor', logTag: '[web-extractor/tutor]' });
