#!/usr/bin/env node
/**
 * Password Vault API, end to end against the real app and a throwaway local Postgres, using the SAME browser-side crypto the page uses
 * (client/src/utils/vaultCrypto.mjs). Checks the feature switch, set-up, saving and reading ciphertext, linking a client (only your own),
 * that another person gets nothing, the recycle bin, changing the master password, and erasing the vault. It also checks the thing that
 * matters most: the database never holds a readable password.
 *
 * Run: DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/routes/passwordVault.test.js   (npm run test:password-vault-api)
 * Skips (exit 0) when DATABASE_URL is not a local database. Never makes an outside network call.
 */
'use strict';
const harness = require('../testing/crossUserHarness'); // must come first: it sets the environment and guards the network
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const SECRET = 'S3cret-Passw0rd-that-must-never-be-stored-readable';

(async () => {
  const crypto = await import(pathToFileURL(path.join(__dirname, '../../client/src/utils/vaultCrypto.mjs')).href);
  const { app, pool, server, base, makeUser, blocked } = await harness.start();
  const call = (m, p, token, body) => harness.call(base, m, p, { token, body });
  const j = (r) => { try { return JSON.parse(r.text); } catch { return {}; } };
  const ITER = 300000; // the smallest strength the server accepts
  let failures = 0;
  const step = async (name, fn) => { try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); } };

  const owner = await makeUser('vault-a', false);
  const other = await makeUser('vault-b', false);
  const admin = await makeUser('vault-admin', true);
  const aad = crypto.aadFor(owner.id);
  const V = '/api/password-vault';

  await pool.query(`DELETE FROM workspace_settings WHERE key='feature_passwordVault'`); // a run that was cut short may have left it on

  await step('off by default: a member is refused, an admin is not', async () => {
    assert.strictEqual((await call('GET', `${V}/status`, owner.token)).status, 403);
    assert.strictEqual((await call('GET', `${V}/status`, admin.token)).status, 200);
  });
  await pool.query(`INSERT INTO workspace_settings (key, value) VALUES ('feature_passwordVault','true') ON CONFLICT (key) DO UPDATE SET value='true'`);

  let { settings, key } = await crypto.createKeySettings('first master password', aad, ITER);
  await step('status says not set up, then set-up stores only key settings', async () => {
    assert.strictEqual(j(await call('GET', `${V}/status`, owner.token)).setUp, false);
    assert.strictEqual((await call('POST', `${V}/setup`, owner.token, { ...settings, kdfIterations: 1000 })).status, 400, 'a weak setting is refused');
    assert.strictEqual((await call('POST', `${V}/setup`, owner.token, { ...settings, kdf: 'md5' })).status, 400);
    assert.strictEqual((await call('POST', `${V}/setup`, owner.token, settings)).status, 201);
    assert.strictEqual((await call('POST', `${V}/setup`, owner.token, settings)).status, 409, 'cannot set up twice');
    const st = j(await call('GET', `${V}/status`, owner.token));
    assert.ok(st.setUp && st.keyVersion === 1 && st.salt && st.verifier);
    assert.ok(await crypto.unlockWith('first master password', st, aad), 'the stored settings open with the right password');
    assert.strictEqual(await crypto.unlockWith('wrong', st, aad), null);
  });

  const { rows: [client] } = await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'Acme Pty Ltd') RETURNING id`, [owner.id]);
  const { rows: [theirClient] } = await pool.query(`INSERT INTO clients ("userId", name) VALUES ($1,'Not yours') RETURNING id`, [other.id]);
  const enc = (data, k = key) => crypto.encryptJson(k, data, aad);
  let entry;

  await step('save an entry; it can be read back and opened; the database holds nothing readable', async () => {
    const blob = await enc({ title: 'Acme hosting', password: SECRET });
    assert.strictEqual((await call('POST', `${V}/entries`, owner.token, { ...blob, keyVersion: 1, clientId: theirClient.id })).status, 400, "another person's client is refused");
    assert.strictEqual((await call('POST', `${V}/entries`, owner.token, { ...blob, keyVersion: 1, clientId: 'abc' })).status, 400);
    assert.strictEqual((await call('POST', `${V}/entries`, owner.token, { ...blob, ciphertext: 'zzz', keyVersion: 1 })).status, 400);
    assert.strictEqual((await call('POST', `${V}/entries`, owner.token, { ...blob, keyVersion: 7 })).status, 409, 'a stale key version is refused');
    const r = await call('POST', `${V}/entries`, owner.token, { ...blob, keyVersion: 1, clientId: client.id });
    assert.strictEqual(r.status, 201);
    entry = j(r);
    assert.strictEqual(entry.clientName, 'Acme Pty Ltd');
    const list = j(await call('GET', `${V}/entries`, owner.token));
    assert.strictEqual(list.length, 1);
    assert.deepStrictEqual(await crypto.decryptJson(key, list[0], aad), { title: 'Acme hosting', password: SECRET });
    const dump = JSON.stringify((await pool.query('SELECT * FROM password_vault_entries')).rows) + JSON.stringify((await pool.query('SELECT * FROM password_vault_keys')).rows);
    assert.ok(!dump.includes(SECRET) && !dump.includes('Acme hosting') && !dump.includes('first master password'), 'no readable text in the database');
  });

  await step('change and unlink the client without the key', async () => {
    assert.strictEqual(j(await call('PATCH', `${V}/entries/${entry.id}/client`, owner.token, { clientId: null })).clientId, null);
    assert.strictEqual(j(await call('PATCH', `${V}/entries/${entry.id}/client`, owner.token, { clientId: client.id })).clientName, 'Acme Pty Ltd');
    assert.strictEqual((await call('PATCH', `${V}/entries/${entry.id}/client`, owner.token, { clientId: theirClient.id })).status, 400);
  });

  await step('update an entry with a new nonce', async () => {
    const blob = await enc({ title: 'Acme hosting', password: 'changed' });
    const r = j(await call('PUT', `${V}/entries/${entry.id}`, owner.token, { ...blob, keyVersion: 1, clientId: client.id }));
    assert.notStrictEqual(r.iv, entry.iv);
    assert.strictEqual((await crypto.decryptJson(key, r, aad)).password, 'changed');
  });

  await step("another person gets nothing and can change nothing of someone else's", async () => {
    // other has no vault of their own yet
    assert.deepStrictEqual(j(await call('GET', `${V}/entries`, other.token)), []);
    assert.strictEqual(j(await call('GET', `${V}/status`, other.token)).setUp, false);
    const blob = await enc({ title: 'x' });
    assert.strictEqual((await call('POST', `${V}/entries`, other.token, { ...blob, keyVersion: 1 })).status, 409, 'cannot save before setting up');
    const mine = await crypto.createKeySettings('other master password', crypto.aadFor(other.id), ITER);
    assert.strictEqual((await call('POST', `${V}/setup`, other.token, mine.settings)).status, 201);
    const theirs = await crypto.encryptJson(mine.key, { title: 'theirs' }, crypto.aadFor(other.id));
    assert.strictEqual((await call('PUT', `${V}/entries/${entry.id}`, other.token, { ...theirs, keyVersion: 1 })).status, 404);
    assert.strictEqual((await call('PATCH', `${V}/entries/${entry.id}/client`, other.token, { clientId: null })).status, 404);
    assert.strictEqual((await call('DELETE', `${V}/entries/${entry.id}`, other.token)).status, 404);
    assert.strictEqual(j(await call('GET', `${V}/entries`, other.token)).length, 0);
    // even if they could copy the ciphertext, it only opens in the owner's vault
    const stolen = j(await call('GET', `${V}/entries`, owner.token))[0];
    await assert.rejects(crypto.decryptJson(mine.key, stolen, crypto.aadFor(other.id)));
    assert.strictEqual((await call('POST', `${V}/reset`, other.token, { confirm: 'DELETE EVERYTHING' })).status, 200);
    assert.strictEqual(j(await call('GET', `${V}/entries`, owner.token)).length, 1, "another person's reset does not touch it");
  });

  let binId;
  await step('delete goes to the recycle bin as ciphertext, and restores', async () => {
    const d = j(await call('DELETE', `${V}/entries/${entry.id}`, owner.token));
    assert.ok(d.ok && d.binId);
    binId = d.binId;
    assert.strictEqual(j(await call('GET', `${V}/entries`, owner.token)).length, 0);
    const bin = (await pool.query('SELECT * FROM recycle_bin WHERE id=$1', [binId])).rows[0];
    assert.strictEqual(bin.entityType, 'password-entry');
    assert.ok(!JSON.stringify(bin).includes('changed') && !JSON.stringify(bin).includes('Acme hosting'), 'the bin holds no readable text');
    const back = await call('POST', `/api/recycle-bin/${binId}/restore`, owner.token);
    assert.strictEqual(back.status, 200, back.text);
    const list = j(await call('GET', `${V}/entries`, owner.token));
    assert.strictEqual(list.length, 1);
    assert.strictEqual((await crypto.decryptJson(key, list[0], aad)).password, 'changed');
    assert.strictEqual(list[0].clientName, 'Acme Pty Ltd');
    entry = list[0];
  });

  await step('change the master password: all-or-nothing, and old bin items cannot come back', async () => {
    const d = j(await call('DELETE', `${V}/entries/${entry.id}`, owner.token)); // into the bin under key version 1
    const second = await enc({ title: 'Second', password: 'two' });
    const r2 = j(await call('POST', `${V}/entries`, owner.token, { ...second, keyVersion: 1 }));
    const fresh = await crypto.createKeySettings('second master password', aad, ITER);
    const re = [{ id: r2.id, ...(await crypto.encryptJson(fresh.key, { title: 'Second', password: 'two' }, aad)) }];
    // a list that is not exactly what the person has is refused and changes nothing
    const wrongSet = await call('POST', `${V}/rekey`, owner.token, { ...fresh.settings, entries: [], expectedKeyVersion: 1 });
    assert.strictEqual(wrongSet.status, 409); assert.strictEqual(j(wrongSet).code, 'LIST_CHANGED');
    assert.strictEqual((await call('POST', `${V}/rekey`, owner.token, { ...fresh.settings, entries: re, expectedKeyVersion: 5 })).status, 409);
    assert.strictEqual((await call('POST', `${V}/rekey`, owner.token, { ...fresh.settings, kdfIterations: 5, entries: re, expectedKeyVersion: 1 })).status, 400);
    const st0 = j(await call('GET', `${V}/status`, owner.token));
    assert.strictEqual(st0.keyVersion, 1, 'a refused change left the key alone');
    assert.ok(await crypto.unlockWith('first master password', st0, aad));
    // the real change
    assert.strictEqual((await call('POST', `${V}/rekey`, owner.token, { ...fresh.settings, entries: re, expectedKeyVersion: 1 })).status, 200);
    const st = j(await call('GET', `${V}/status`, owner.token));
    assert.strictEqual(st.keyVersion, 2);
    assert.strictEqual(await crypto.unlockWith('first master password', st, aad), null, 'the old password no longer opens it');
    const k2 = await crypto.unlockWith('second master password', st, aad);
    assert.ok(k2);
    const list = j(await call('GET', `${V}/entries`, owner.token));
    assert.strictEqual((await crypto.decryptJson(k2, list[0], aad)).password, 'two');
    await assert.rejects(crypto.decryptJson(key, list[0], aad), 'the old key cannot read it');
    // writing with the old key version is refused (another window still on the old key)
    assert.strictEqual(j(await call('POST', `${V}/entries`, owner.token, { ...second, keyVersion: 1 })).code, 'KEY_CHANGED');
    // what was deleted under the old key cannot be put back: it could never be read
    const back = await call('POST', `/api/recycle-bin/${d.binId}/restore`, owner.token);
    assert.strictEqual(back.status, 409);
    assert.match(back.text, /master password was changed/);
    key = k2;
  });

  await step('erase everything needs the exact words, then clears vault, key and bin', async () => {
    assert.strictEqual((await call('POST', `${V}/reset`, owner.token, { confirm: 'yes' })).status, 400);
    assert.strictEqual(j(await call('GET', `${V}/entries`, owner.token)).length, 1, 'a refused erase changed nothing');
    const d = j(await call('POST', `${V}/reset`, owner.token, { confirm: 'DELETE EVERYTHING' }));
    assert.ok(d.ok && d.deleted === 1);
    assert.strictEqual(j(await call('GET', `${V}/status`, owner.token)).setUp, false);
    assert.strictEqual(j(await call('GET', `${V}/entries`, owner.token)).length, 0);
    assert.strictEqual((await pool.query(`SELECT 1 FROM recycle_bin WHERE "userId"=$1 AND "entityType"='password-entry'`, [owner.id])).rows.length, 0);
    // and a new vault can be made from scratch
    const again = await crypto.createKeySettings('brand new master', aad, ITER);
    assert.strictEqual((await call('POST', `${V}/setup`, owner.token, again.settings)).status, 201);
  });

  await step('deleting a client keeps the login (unlinked), and a deleted person takes their vault with them', async () => {
    const st = j(await call('GET', `${V}/status`, owner.token));
    const k = await crypto.unlockWith('brand new master', st, aad);
    const blob = await crypto.encryptJson(k, { title: 'Linked' }, aad);
    const e = j(await call('POST', `${V}/entries`, owner.token, { ...blob, keyVersion: st.keyVersion, clientId: client.id }));
    await pool.query('DELETE FROM clients WHERE id=$1', [client.id]);
    const after = j(await call('GET', `${V}/entries`, owner.token));
    assert.ok(after.length === 1 && after[0].id === e.id && after[0].clientId === null);
    await pool.query('DELETE FROM users WHERE id=$1', [owner.id]);
    assert.strictEqual((await pool.query('SELECT 1 FROM password_vault_entries WHERE "userId"=$1', [owner.id])).rows.length, 0);
    assert.strictEqual((await pool.query('SELECT 1 FROM password_vault_keys WHERE "userId"=$1', [owner.id])).rows.length, 0);
  });

  assert.strictEqual(blocked.length, 0, `no outside network calls (${blocked.join(', ')})`);
  await new Promise((r) => server.close(r));
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [[other.id, admin.id]]).catch(() => {});
  await pool.query(`DELETE FROM workspace_settings WHERE key='feature_passwordVault'`).catch(() => {});
  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\npasswordVault API tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
