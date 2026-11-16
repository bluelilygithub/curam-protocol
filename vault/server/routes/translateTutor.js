'use strict';

// The Translate guide (the round button on Vault's /translate page): points at the page's real screens and controls for a job, or says
// one is missing / the job is beyond Translate. JSON only; it sees no documents or translations. Mounted at /api/translate-tutor
// behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askTranslateTutor } = require('../services/translateTutor');

module.exports = makeGuideRouter({ ask: askTranslateTutor, source: 'translateTutor', productName: 'Translate', logTag: '[translate/tutor]' });
