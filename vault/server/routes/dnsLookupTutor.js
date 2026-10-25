'use strict';

// The DNS Lookup guide (the round button on Vault's /dns-lookup page): points at the page's real controls for a job, or says one is
// missing / the job is beyond DNS Lookup. JSON only; it sees no names or answers. Mounted at /api/dns-lookup-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askDnsLookupTutor } = require('../services/dnsLookupTutor');

module.exports = makeGuideRouter({ ask: askDnsLookupTutor, source: 'dnsLookupTutor', productName: 'DNS Lookup', logTag: '[dns-lookup/tutor]' });
