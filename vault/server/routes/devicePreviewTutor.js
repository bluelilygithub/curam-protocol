'use strict';

// The Device preview guide (the round button on Vault's /device-preview page): points at the page's real controls for a job, or says one is
// missing / the job is beyond Device preview. JSON only; it sees no addresses or pages. Mounted at /api/device-preview-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askDevicePreviewTutor } = require('../services/devicePreviewTutor');

module.exports = makeGuideRouter({ ask: askDevicePreviewTutor, source: 'devicePreviewTutor', productName: 'Device preview', logTag: '[device-preview/tutor]' });
