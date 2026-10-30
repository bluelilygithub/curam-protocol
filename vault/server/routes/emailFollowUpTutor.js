'use strict';

// The Email Follow-Up guide (the round button on Vault's /email-follow-up page): points at the page's real controls for a job, or says one is
// missing / the job is beyond Email Follow-Up. JSON only; it sees no cases, emails or drafts. Mounted at /api/email-follow-up-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askEmailFollowUpTutor } = require('../services/emailFollowUpTutor');

module.exports = makeGuideRouter({ ask: askEmailFollowUpTutor, source: 'emailFollowUpTutor', productName: 'Email Follow-Up', logTag: '[email-follow-up/tutor]' });
