'use strict';

// The CRM guide (the round button on Vault's CRM pages): points at the real controls for a job, or says one is missing / the job is beyond CRM.
// JSON only; it sees no clients, deals or notes. Mounted at /api/crm-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askCrmTutor } = require('../services/crmTutor');

module.exports = makeGuideRouter({ ask: askCrmTutor, source: 'crmTutor', productName: 'CRM', logTag: '[crm/tutor]' });
