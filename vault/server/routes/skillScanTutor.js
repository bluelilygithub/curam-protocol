'use strict';

// The Skill Scanner guide chat: JSON only, admin only, behind the AI rate limit. It sees no link, zip or scan.

const { makeGuideRouter } = require('./guideRouter');
const { askSkillScanTutor } = require('../services/skillScanTutor');

module.exports = makeGuideRouter({ ask: askSkillScanTutor, source: 'skillScanTutor', productName: 'Skill Scanner', logTag: '[skillScan/tutor]' });
