'use strict';

// The AI Visibility guide (the round button on Vault's /ai-visibility page): points at the page's real parts for a
// job, or says one is missing / the job is beyond this page. JSON only; it sees no address, score or report.
// Mounted at /api/ai-visibility-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askAiVisibilityTutor } = require('../services/aiVisibilityTutor');

module.exports = makeGuideRouter({ ask: askAiVisibilityTutor, source: 'aiVisibilityTutor', productName: 'AI Visibility', logTag: '[ai-visibility/tutor]' });
