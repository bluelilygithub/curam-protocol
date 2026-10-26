'use strict';

// Password Vault API (/api/password-vault, flag `passwordVault`). Zero-knowledge: the browser turns the master password into a key and
// encrypts every entry (title, username, address, password, notes) before it is sent. This file only stores and returns base64 text, plus
// the one plain field "clientId" that links an entry to a CRM client. There is no endpoint that could decrypt anything, and no master
// password reset: forgetting it means starting again (POST /reset). See docs/password-vault.md.

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { blobError, keyParamsError, MAX_ENTRIES_PER_USER } = require('../services/passwordVault/validate');

const getBin = () => { require('../services/recycleBin/adapters'); return require('../services/recycleBin'); };
const BIN_TYPE = 'password-entry';
const RESET_PHRASE = 'DELETE EVERYTHING';

const router = express.Router();

const ENTRY_SELECT = `SELECT e.id, e."clientId", c.name AS "clientName", e.iv, e.ciphertext, e."keyVersion", e."createdAt", e."updatedAt"
  FROM password_vault_entries e LEFT JOIN clients c ON c.id = e."clientId" AND c."userId" = e."userId"`;

// A client id from the request: null when none, an integer the person owns, or false when it is not theirs.
async function ownedClientId(db, userId, raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return false;
  const { rows } = await db.query('SELECT 1 FROM clients WHERE id = $1 AND "userId" = $2', [id, userId]);
  return rows[0] ? id : false;
}

router.get('/status', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT kdf, "kdfIterations", salt, verifier, "keyVersion" FROM password_vault_keys WHERE "userId" = $1', [req.user.id]);
    if (!rows[0]) return res.json({ setUp: false });
    res.json({ setUp: true, ...rows[0], keyVersion: Number(rows[0].keyVersion) });
  } catch (err) { next(err); }
});

// First-time set-up: store the key settings the browser made. Never replaces existing ones (change/reset have their own routes).
router.post('/setup', async (req, res, next) => {
  try {
    const bad = keyParamsError(req.body);
    if (bad) return res.status(400).json({ error: bad });
    const { kdf, kdfIterations, salt, verifier } = req.body;
    const { rowCount } = await pool.query(
      `INSERT INTO password_vault_keys ("userId", kdf, "kdfIterations", salt, verifier) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT ("userId") DO NOTHING`,
      [req.user.id, kdf, Number(kdfIterations), salt, JSON.stringify({ iv: verifier.iv, ciphertext: verifier.ciphertext })]
    );
    if (!rowCount) return res.status(409).json({ error: 'Your vault is already set up.' });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/entries', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${ENTRY_SELECT} WHERE e."userId" = $1 ORDER BY e.id`, [req.user.id]);
    res.json(rows.map((r) => ({ ...r, keyVersion: Number(r.keyVersion) })));
  } catch (err) { next(err); }
});

async function currentKeyVersion(db, userId) {
  const { rows } = await db.query('SELECT "keyVersion" FROM password_vault_keys WHERE "userId" = $1', [userId]);
  return rows[0] ? Number(rows[0].keyVersion) : null;
}

router.post('/entries', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const bad = blobError(req.body);
    if (bad) return res.status(400).json({ error: bad });
    const version = await currentKeyVersion(pool, userId);
    if (version === null) return res.status(409).json({ error: 'Set up your master password first.' });
    if (Number(req.body.keyVersion) !== version) return res.status(409).json({ error: 'Your master password was changed in another window. Reload and unlock again.', code: 'KEY_CHANGED' });
    const clientId = await ownedClientId(pool, userId, req.body.clientId);
    if (clientId === false) return res.status(400).json({ error: 'That client was not found.' });
    const { rows: [{ n }] } = await pool.query('SELECT COUNT(*) AS n FROM password_vault_entries WHERE "userId" = $1', [userId]);
    if (Number(n) >= MAX_ENTRIES_PER_USER) return res.status(409).json({ error: `You already have ${MAX_ENTRIES_PER_USER} saved passwords.` });
    const { rows } = await pool.query(
      'INSERT INTO password_vault_entries ("userId", "clientId", iv, ciphertext, "keyVersion") VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, clientId, req.body.iv, req.body.ciphertext, version]
    );
    const { rows: [row] } = await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [rows[0].id]);
    res.status(201).json({ ...row, keyVersion: Number(row.keyVersion) });
  } catch (err) { next(err); }
});

router.put('/entries/:id', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const bad = blobError(req.body);
    if (bad) return res.status(400).json({ error: bad });
    const version = await currentKeyVersion(pool, userId);
    if (version === null || Number(req.body.keyVersion) !== version) return res.status(409).json({ error: 'Your master password was changed in another window. Reload and unlock again.', code: 'KEY_CHANGED' });
    const clientId = await ownedClientId(pool, userId, req.body.clientId);
    if (clientId === false) return res.status(400).json({ error: 'That client was not found.' });
    const { rowCount } = await pool.query(
      'UPDATE password_vault_entries SET "clientId" = $1, iv = $2, ciphertext = $3, "keyVersion" = $4, "updatedAt" = NOW() WHERE id = $5 AND "userId" = $6',
      [clientId, req.body.iv, req.body.ciphertext, version, req.params.id, userId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found.' });
    const { rows: [row] } = await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [req.params.id]);
    res.json({ ...row, keyVersion: Number(row.keyVersion) });
  } catch (err) { next(err); }
});

// Link or unlink a client without touching the encrypted part (so it works with no key at all).
router.patch('/entries/:id/client', async (req, res, next) => {
  try {
    const clientId = await ownedClientId(pool, req.user.id, req.body?.clientId);
    if (clientId === false) return res.status(400).json({ error: 'That client was not found.' });
    const { rowCount } = await pool.query('UPDATE password_vault_entries SET "clientId" = $1, "updatedAt" = NOW() WHERE id = $2 AND "userId" = $3', [clientId, req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found.' });
    const { rows: [row] } = await pool.query(`${ENTRY_SELECT} WHERE e.id = $1`, [req.params.id]);
    res.json({ ...row, keyVersion: Number(row.keyVersion) });
  } catch (err) { next(err); }
});

// Delete goes to the shared 30-day recycle bin (still ciphertext only).
router.delete('/entries/:id', async (req, res, next) => {
  const bin = getBin();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM password_vault_entries WHERE id = $1 AND "userId" = $2 FOR UPDATE', [req.params.id, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
    const e = rows[0];
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: BIN_TYPE, id: e.id, title: 'Saved password',
      detail: `Encrypted · saved ${new Date(e.createdAt).toISOString().slice(0, 10)}`, payload: { entry: e },
    });
    await db.query('DELETE FROM password_vault_entries WHERE id = $1', [e.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { db.release(); }
});

// Change the master password. The browser has already decrypted every entry with the old key and re-encrypted it with the new one;
// all of it is swapped in one transaction, and only if the entry list is exactly what the browser worked from (so nothing added in
// another window is lost). Entries sitting in the recycle bin keep the old key version and can no longer be restored.
router.post('/rekey', async (req, res, next) => {
  const db = await pool.connect();
  try {
    const bad = keyParamsError(req.body);
    if (bad) return res.status(400).json({ error: bad });
    const { entries, expectedKeyVersion } = req.body;
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES_PER_USER) return res.status(400).json({ error: 'The list of passwords is not valid.' });
    for (const e of entries) {
      const e1 = blobError(e);
      if (e1 || !Number.isInteger(Number(e.id))) return res.status(400).json({ error: e1 || 'An entry id is not valid.' });
    }
    await db.query('BEGIN');
    const key = (await db.query('SELECT "keyVersion" FROM password_vault_keys WHERE "userId" = $1 FOR UPDATE', [req.user.id])).rows[0];
    if (!key) { await db.query('ROLLBACK'); return res.status(409).json({ error: 'Set up your master password first.' }); }
    if (Number(key.keyVersion) !== Number(expectedKeyVersion)) { await db.query('ROLLBACK'); return res.status(409).json({ error: 'Your master password was changed in another window. Reload and try again.', code: 'KEY_CHANGED' }); }
    const have = (await db.query('SELECT id FROM password_vault_entries WHERE "userId" = $1 FOR UPDATE', [req.user.id])).rows.map((r) => r.id).sort((a, b) => a - b);
    const sent = entries.map((e) => Number(e.id)).sort((a, b) => a - b);
    if (have.length !== sent.length || have.some((id, i) => id !== sent[i])) { await db.query('ROLLBACK'); return res.status(409).json({ error: 'Your passwords changed while this was running. Nothing was changed. Reload and try again.', code: 'LIST_CHANGED' }); }
    const newVersion = Number(key.keyVersion) + 1;
    for (const e of entries) {
      await db.query('UPDATE password_vault_entries SET iv = $1, ciphertext = $2, "keyVersion" = $3 WHERE id = $4 AND "userId" = $5', [e.iv, e.ciphertext, newVersion, Number(e.id), req.user.id]);
    }
    await db.query(
      `UPDATE password_vault_keys SET kdf = $1, "kdfIterations" = $2, salt = $3, verifier = $4::jsonb, "keyVersion" = $5, "updatedAt" = NOW() WHERE "userId" = $6`,
      [req.body.kdf, Number(req.body.kdfIterations), req.body.salt, JSON.stringify({ iv: req.body.verifier.iv, ciphertext: req.body.verifier.ciphertext }), newVersion, req.user.id]
    );
    await db.query('COMMIT');
    res.json({ ok: true, keyVersion: newVersion });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { db.release(); }
});

// "I forgot my master password": nothing can be decrypted without it, so the only way out is to erase the vault and start again.
router.post('/reset', async (req, res, next) => {
  const db = await pool.connect();
  try {
    if (String(req.body?.confirm || '') !== RESET_PHRASE) return res.status(400).json({ error: `Type ${RESET_PHRASE} to confirm.` });
    await db.query('BEGIN');
    const gone = await db.query('DELETE FROM password_vault_entries WHERE "userId" = $1', [req.user.id]);
    await db.query('DELETE FROM password_vault_keys WHERE "userId" = $1', [req.user.id]);
    await db.query('DELETE FROM recycle_bin WHERE "userId" = $1 AND "entityType" = $2', [req.user.id, BIN_TYPE]);
    await db.query('COMMIT');
    getLogger().info({ userId: req.user.id, entries: gone.rowCount }, '[password-vault] vault reset');
    res.json({ ok: true, deleted: gone.rowCount });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { db.release(); }
});

module.exports = router;
