'use strict';

// The Business Profiler guide chat: JSON only, behind the AI rate limit. It sees no domain, profile or result.

const { makeGuideRouter } = require('./guideRouter');
const { askBipTutor } = require('../services/bipTutor');

module.exports = makeGuideRouter({ ask: askBipTutor, source: 'bipTutor', productName: 'Business Profiler', logTag: '[bip/tutor]' });
