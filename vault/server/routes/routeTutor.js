'use strict';

// The Route Tracer guide (the round button on Vault's /route-tracer page): points at the app's real screens for a job, or says one is missing / the job
// is beyond Route Tracer. JSON only; it reads no tracks. Mounted at /api/route-tutor behind the `routeTracer` feature flag and the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askRouteTutor } = require('../services/routeTutor');

module.exports = makeGuideRouter({ ask: askRouteTutor, source: 'routeTutor', productName: 'Route Tracer', logTag: '[route/tutor]' });
