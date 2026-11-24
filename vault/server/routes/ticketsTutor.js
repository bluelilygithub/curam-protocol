'use strict';

// The Tickets guide (the round button on Vault's /tickets page): points at the page's real views and controls for a job, or says one is
// missing / the job is beyond Tickets. JSON only; it sees no tickets. Mounted at /api/tickets-tutor behind the tickets feature and the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askTicketsTutor } = require('../services/ticketsTutor');

module.exports = makeGuideRouter({ ask: askTicketsTutor, source: 'ticketsTutor', productName: 'Tickets', logTag: '[tickets/tutor]' });
