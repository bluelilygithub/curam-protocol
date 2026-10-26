'use strict';

// node server/services/passwordVaultTutor.test.js   (npm run test:password-vault-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./passwordVaultTutor');

checkGuide({
  name: 'passwordVaultTutor',
  service,
  askName: 'askPasswordVaultTutor',
  feature: 'password_vault_guide',
  toolsFile: 'passwordVault/passwordVaultTools.mjs',
  menuExport: 'VAULT_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'passwords',
  exampleStepId: 'generator',
  facts: [
    ['passwords', 'notes', /locks again by itself/, 'the vault locks itself'],
    ['client-link', 'notes', /stored in plain form/, 'the client link is the one plain field'],
    ['copy-password', 'does', /30 seconds/, 'the clipboard is cleared'],
    ['delete-password', 'does', /Recycle bin for 30 days/, 'a delete goes to the bin'],
    ['generator', 'notes', /works even when the vault is locked/, 'the generator needs no unlock'],
    ['health', 'notes', /data breach/, 'no breach check'],
    ['master', 'notes', /never sent to Vault/, 'the master password stays on the device'],
    ['reset-vault', 'notes', /no other way back in/, 'a forgotten master password cannot be recovered'],
  ],
  gaps: [/Recovering a forgotten master password/, /Sharing a password/, /autofill/, /data breach/, /Importing from or exporting/, /Two-factor/],
  rules: [/never leaves the browser/, /there is no reset by email/, /Never ask the person to type or paste a password/],
  system: [/cannot be recovered/, /not to share it with you/],
}).catch((e) => { console.error(e); process.exit(1); });
