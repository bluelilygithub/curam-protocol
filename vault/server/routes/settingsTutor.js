'use strict';

// The Settings guide (the round button on Vault's /settings and /admin pages): points at the real controls for a job, or says one is missing / the job is beyond Settings.
// JSON only; it sees no settings, keys or users. Mounted at /api/settings-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askSettingsTutor } = require('../services/settingsTutor');

module.exports = makeGuideRouter({ ask: askSettingsTutor, source: 'settingsTutor', productName: 'Settings', logTag: '[settings/tutor]' });
