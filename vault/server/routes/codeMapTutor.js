'use strict';

// The Code Map guide (the round button on the admin /code-map page): points at the page's real tabs and controls and explains the rules,
// or says something is beyond the page. JSON only; it sees no code, run or finding. Mounted at /api/code-map-tutor behind requireAdmin and
// the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askCodeMapTutor } = require('../services/codeMapTutor');

module.exports = makeGuideRouter({ ask: askCodeMapTutor, source: 'codeMapTutor', productName: 'Code Map', logTag: '[codeMap/tutor]' });
