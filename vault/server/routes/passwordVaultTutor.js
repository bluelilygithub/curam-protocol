'use strict';

// The Password Vault guide (the round button on Vault's /password-vault page): points at the page's real controls for a job, or says one
// is missing / the job is beyond the Password Vault. JSON only; it sees no passwords, titles or client names. Mounted at
// /api/password-vault-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askPasswordVaultTutor } = require('../services/passwordVaultTutor');

module.exports = makeGuideRouter({ ask: askPasswordVaultTutor, source: 'passwordVaultTutor', productName: 'Password Vault', logTag: '[password-vault/tutor]' });
