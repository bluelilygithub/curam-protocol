'use strict';

// The Memory guide (the round button on Vault's /memory page): points at the page's real parts for a job, or says one is missing / the job is beyond
// this page. JSON only; it sees no memory, search or setting. Mounted at /api/memory-tutor behind the AI rate limit and the memory flag.

const { makeGuideRouter } = require('./guideRouter');
const { askMemoryTutor } = require('../services/memoryTutor');

module.exports = makeGuideRouter({ ask: askMemoryTutor, source: 'memoryTutor', productName: 'Memory', logTag: '[memory/tutor]' });
