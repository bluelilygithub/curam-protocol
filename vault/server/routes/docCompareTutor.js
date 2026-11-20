'use strict';

// The DocCompare guide (the round button on Vault's /doc-compare page): points at the page's real parts for a job, or says one is missing / the job
// is beyond DocCompare. JSON only; it sees no file or result. Mounted at /api/doc-compare-tutor behind the AI rate limit and the docCompare flag.

const { makeGuideRouter } = require('./guideRouter');
const { askDocCompareTutor } = require('../services/docCompareTutor');

module.exports = makeGuideRouter({ ask: askDocCompareTutor, source: 'docCompareTutor', productName: 'DocCompare', logTag: '[doc-compare/tutor]' });
