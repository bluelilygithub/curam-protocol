'use strict';

// The guide chat for /presentations: JSON only, no decks or files. The shared core and router give it the same behaviour as
// the other Vault guides. Mounted in server/index.js behind requireAuth, requireFeature('presentations') and aiLimiter.

const { makeGuideRouter } = require('./guideRouter');
const { ask } = require('../services/presentationsTutor');

module.exports = makeGuideRouter({
  ask,
  source: 'presentationsTutor',
  productName: 'Presentations',
  logTag: '[presentations/tutor]',
});
