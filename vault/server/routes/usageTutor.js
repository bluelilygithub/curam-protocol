'use strict';

// The Usage & Cost guide (the round button on Vault's /usage page): points at the page's real parts for a job, or says one is missing /
// the job is beyond this page. JSON only; it sees no spending, calls or settings. Mounted at /api/usage-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askUsageTutor } = require('../services/usageTutor');

module.exports = makeGuideRouter({ ask: askUsageTutor, source: 'usageTutor', productName: 'Usage & Cost', logTag: '[usage/tutor]' });
