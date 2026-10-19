'use strict';

// The CSS guide (the round button on Vault's /restyle page): points at the page's real tools and buttons for a job, or says one is
// missing / the job is beyond the tool. JSON only; it sees no pages. Mounted at /api/restyle-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askRestyleTutor } = require('../services/restyleTutor');

module.exports = makeGuideRouter({ ask: askRestyleTutor, source: 'restyleTutor', productName: 'CSS', logTag: '[restyle/tutor]' });
