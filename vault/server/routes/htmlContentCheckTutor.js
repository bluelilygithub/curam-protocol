'use strict';

// The HTML Content Check guide (the round button on Vault's /html-content-check page): points at the page's real parts for a job, or says
// one is missing / the job is beyond the tool. JSON only; it sees no job, page, request or result. Mounted at /api/html-content-check-tutor
// behind the AI rate limit and the htmlContentCheck flag.

const { makeGuideRouter } = require('./guideRouter');
const { askHtmlContentCheckTutor } = require('../services/htmlContentCheckTutor');

module.exports = makeGuideRouter({ ask: askHtmlContentCheckTutor, source: 'htmlContentCheckTutor', productName: 'HTML Content Check', logTag: '[html-content-check/tutor]' });
