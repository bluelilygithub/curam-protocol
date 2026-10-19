'use strict';

// The Font Customizer guide (the round button on Vault's /fonts page): points at the page's real tools and controls for a job, or says
// one is missing / the job is beyond the Font Customizer. JSON only; it sees no fonts. Mounted at /api/fonts-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askFontsTutor } = require('../services/fontsTutor');

module.exports = makeGuideRouter({ ask: askFontsTutor, source: 'fontsTutor', productName: 'Font Customizer', logTag: '[fonts/tutor]' });
