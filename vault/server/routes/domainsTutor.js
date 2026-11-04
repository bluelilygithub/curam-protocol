'use strict';

// The Domain guide (the round button on Vault's /domains page): points at the page's real tools for a job, or says one is missing / the
// job is beyond Domain. JSON only; it sees no descriptions, names or results. Mounted at /api/domains-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askDomainsTutor } = require('../services/domainsTutor');

module.exports = makeGuideRouter({ ask: askDomainsTutor, source: 'domainsTutor', productName: 'Domain', logTag: '[domains/tutor]' });
