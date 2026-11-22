'use strict';

// The Contract Review guide (the round button on Vault's /contract-review page): points at the page's real parts for a job, or says one is
// missing / the job is beyond Contract Review. JSON only; it sees no contract or review. Mounted at /api/contract-review-tutor behind the
// AI rate limit and the contractReview flag.

const { makeGuideRouter } = require('./guideRouter');
const { askContractReviewTutor } = require('../services/contractReviewTutor');

module.exports = makeGuideRouter({ ask: askContractReviewTutor, source: 'contractReviewTutor', productName: 'Contract Review', logTag: '[contract-review/tutor]' });
