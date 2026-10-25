'use strict';

// The Burner Mail guide (the round button on Vault's /burner-mail page): points at the page's real controls for a job, or says one is
// missing / the job is beyond Burner Mail. JSON only; it sees no addresses or emails. Mounted at /api/burner-mail-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askBurnerMailTutor } = require('../services/burnerMailTutor');

module.exports = makeGuideRouter({ ask: askBurnerMailTutor, source: 'burnerMailTutor', productName: 'Burner Mail', logTag: '[burner-mail/tutor]' });
