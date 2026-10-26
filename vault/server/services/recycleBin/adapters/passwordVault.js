'use strict';

// How the recycle bin handles Password Vault entries. The payload is the row as stored: ciphertext only, so the bin never holds a
// readable password. An entry made under an older master password cannot be read any more (the vault was re-encrypted), so it is not
// put back. See docs/recycle-bin.md and docs/password-vault.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');
const { MAX_ENTRIES_PER_USER } = require('../../passwordVault/validate');

register('password-entry', {
  label: 'Saved password',
  async restore(db, userId, payload) {
    const e = payload?.entry;
    if (!e || !e.ciphertext) throw new Error('This deleted password has nothing to restore.');
    const key = (await db.query('SELECT "keyVersion" FROM password_vault_keys WHERE "userId" = $1', [userId])).rows[0];
    if (!key) throw new RestoreError('The vault has been reset since, so this password can no longer be read.', 409);
    if (Number(key.keyVersion) !== Number(e.keyVersion)) throw new RestoreError('The master password was changed after this was deleted, so it can no longer be read.', 409);
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM password_vault_entries WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_ENTRIES_PER_USER) throw new RestoreError(`You already have ${MAX_ENTRIES_PER_USER} saved passwords. Delete some to bring this one back.`, 409);
    const entityId = await insertRow(db, 'password_vault_entries', e, { userId });
    return { entityId };
  },
});
