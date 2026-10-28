'use strict';

// Vault Shelf, the Vault side (docs/vault-shelf.md). Three routers built from one set of dependencies, so tests can swap the model, the file
// saver and the clock:
//
//   ingestRouter   /api/quick-ingest/*  Called by the Windows app with an ingest-only key (Bearer vsh_...). No login, so it is mounted BEFORE
//                  requireAuth (and before the global body parser, so nothing is read until the key has been checked). Routes: GET /verify,
//                  POST /notes, /finance, /crm, /redact.
//   tokensRouter   /api/shelf-tokens    Called by the Settings page (signed in) to make, list and revoke keys.
//   inboxRouter    /api/shelf-inbox     Called by the CRM page (signed in) to file what the app sent to the CRM with no client chosen.
//
// What a key may do = its scopes AND what the account may use (workspace switches narrowed by member switches, admins never narrowed).
// A clip's content is never logged: errors are logged by name and code only (a body-parser error object carries the raw body).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { getLogger, attachUserToLogContext } = require('../middleware/requestContext');
const {
  TOKEN_RE, MAX_ACTIVE_TOKENS, SCOPES, SCOPE_NAMES,
  hashToken, newToken, cleanLabel, cleanScopes, scopeAllowed, effectiveScopes, tokenProblem, createLimiter,
} = require('../services/shelfTokens');
const { sniffImage } = require('../utils/imageSniff');
const { scanText, MAX_TEXT: MAX_REDACT_CHARS } = require('../services/shelfRedact');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_TEXT_CHARS = 200000;            // a note or CRM text clip
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // matches the app's own cap
const MAX_UNFILED = 500;                  // unfiled CRM captures per person
const LIMITS = { perMinute: 120, extractionsPerHour: 20, redactPerMinute: 60 };
const SHELF_QUOTA_BYTES = (Number(process.env.SHELF_QUOTA_MB) || 200) * 1024 * 1024;
const CLIP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const STALE_CLAIM_MS = 5 * MINUTE;

const uploadDir = () => process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const rel = (full) => path.relative(uploadDir(), full).split(path.sep).join('/');
const cleanLine = (raw, max) => String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** What is safe to log about a failure: never the message of a body-parser or database error (they can quote the content). */
const errInfo = (err) => ({ name: err?.name, code: err?.code || err?.type, status: err?.status || err?.statusCode });

function noteTitle(title, text) {
  const t = cleanLine(title, 120);
  if (t) return t;
  const first = String(text || '').split(/\r?\n/).map((l) => cleanLine(l, 80)).find(Boolean);
  return first || 'Clipboard note';
}

function createRouters(deps) {
  const { pool } = deps;
  const limiter = deps.limiter || createLimiter();
  const log = () => getLogger();

  // ---------------------------------------------------------------- shared helpers
  const sendError = (res, status, error, code) => res.status(status).json(code ? { error, code } : { error });

  /** Reads one clip from the request (JSON or multipart). Returns { clip } or { error: [status, message] }. */
  function readClip(req, { allowImage = true } = {}) {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const clipId = String(b.clipId ?? '');
    if (!CLIP_ID_RE.test(clipId)) return { error: [400, 'clipId is required (8 to 64 letters, numbers, - or _).'] };
    if (b.text !== undefined && typeof b.text !== 'string') return { error: [400, 'text must be text.'] };
    const text = typeof b.text === 'string' ? b.text.replace(/\u0000/g, '') : '';
    if (text.length > MAX_TEXT_CHARS) return { error: [413, `That clip is longer than ${MAX_TEXT_CHARS.toLocaleString('en-AU')} characters.`] };
    let image = null;
    if (req.file) {
      if (!allowImage) return { error: [415, 'This route takes text only.'] };
      const kind = sniffImage(req.file.buffer);
      if (!kind) return { error: [415, 'Only PNG, JPEG, GIF and WebP pictures are accepted.'] };
      image = { buffer: req.file.buffer, ...kind };
    }
    if (!text.trim() && !image) return { error: [400, 'There is nothing in this clip.'] };
    return { clip: { clipId, text, image, title: cleanLine(b.title, 120), sourceApp: cleanLine(b.sourceApp, 80) } };
  }

  /**
   * Claims (user, clip, route) so a retry cannot make a second copy. { claimed: true } when this request should do the work;
   * otherwise { claimed: false, resultId } (resultId null = another request is still working on it).
   */
  async function claim(userId, clipId, route) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ins = await pool.query(
        `INSERT INTO shelf_ingests ("userId","clipId",route) VALUES ($1,$2,$3) ON CONFLICT ("userId","clipId",route) DO NOTHING RETURNING id`,
        [userId, clipId, route]);
      if (ins.rows[0]) {
        if (limiter.take('prune', 1, HOUR)) pool.query(`DELETE FROM shelf_ingests WHERE "createdAt" < NOW() - INTERVAL '90 days'`).catch(() => {});
        return { claimed: true };
      }
      const { rows } = await pool.query(`SELECT "resultId","createdAt" FROM shelf_ingests WHERE "userId"=$1 AND "clipId"=$2 AND route=$3`, [userId, clipId, route]);
      const row = rows[0];
      if (!row) continue; // released between the two queries: try again
      const abandoned = row.resultId == null && Date.now() - new Date(row.createdAt).getTime() > STALE_CLAIM_MS;
      if (abandoned) { await release(userId, clipId, route); continue; }
      return { claimed: false, resultId: row.resultId };
    }
    return { claimed: false, resultId: null };
  }
  const finish = (userId, clipId, route, resultId) =>
    pool.query(`UPDATE shelf_ingests SET "resultId"=$4 WHERE "userId"=$1 AND "clipId"=$2 AND route=$3`, [userId, clipId, route, resultId]);
  const release = (userId, clipId, route) =>
    pool.query(`DELETE FROM shelf_ingests WHERE "userId"=$1 AND "clipId"=$2 AND route=$3`, [userId, clipId, route]).catch(() => {});

  /** Replies for a clip that was already pushed (true), or tells the caller to carry on (false). */
  function answerDuplicate(res, c) {
    if (c.claimed) return false;
    if (c.resultId == null) { sendError(res, 409, 'This clip is still being saved. Try again in a moment.', 'IN_PROGRESS'); return true; }
    res.status(200).json({ ok: true, duplicate: true, id: c.resultId });
    return true;
  }

  async function shelfStorageUsed(userId) {
    const a = await pool.query(`SELECT COALESCE(SUM("sizeBytes"),0) AS n FROM shelf_inbox WHERE "userId"=$1`, [userId]);
    const b = await pool.query(`SELECT COALESCE(SUM("sizeBytes"),0) AS n FROM expense_review_queue WHERE "userId"=$1 AND source='shelf'`, [userId]);
    return Number(a.rows[0].n) + Number(b.rows[0].n);
  }
  async function assertShelfQuota(userId, incoming) {
    if (!incoming) return null;
    return (await shelfStorageUsed(userId)) + incoming > SHELF_QUOTA_BYTES
      ? `Vault Shelf storage is full (${Math.round(SHELF_QUOTA_BYTES / 1048576)} MB). File or delete some captures first.` : null;
  }

  // ---------------------------------------------------------------- the key
  async function shelfAuth(req, res, next) {
    try {
      res.set('Cache-Control', 'no-store');
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!TOKEN_RE.test(token)) return sendError(res, 401, 'Not authenticated');
      const { rows } = await pool.query(
        `SELECT t.id, t."userId", t.label, t.scopes, t."expiresAt", t."revokedAt",
                u.email, u."isAdmin", u."disabledAt", u."accountantOfUserId"
           FROM shelf_tokens t JOIN users u ON u.id = t."userId" WHERE t."tokenHash" = $1`, [hashToken(token)]);
      const row = rows[0];
      const problem = tokenProblem(row);
      if (problem) return sendError(res, 401, problem.message, problem.code);
      if (row.disabledAt || row.accountantOfUserId) return sendError(res, 401, 'Not authenticated');
      if (!limiter.take(`t:${row.id}`, LIMITS.perMinute, MINUTE)) {
        res.set('Retry-After', String(limiter.retryAfter(`t:${row.id}`, MINUTE)));
        return sendError(res, 429, 'Too many requests. Slow down for a minute.', 'RATE_LIMITED');
      }
      const flags = row.isAdmin ? {} : await deps.loadFeatureAccess(row.userId);
      if (!row.isAdmin && flags.shelf === false) return sendError(res, 403, 'Vault Shelf is switched off for your account.', 'SHELF_DISABLED');
      const eff = effectiveScopes(row.scopes, flags, row.isAdmin);
      req.shelf = { tokenId: row.id, userId: row.userId, label: row.label, email: row.email, allowed: eff.allowed, blocked: eff.blocked };
      req.user = { id: row.userId, email: row.email, isAdmin: row.isAdmin }; // what shared helpers (notes, attachments) expect
      attachUserToLogContext(row.userId);
      if (limiter.take(`u:${row.id}`, 1, MINUTE)) pool.query(`UPDATE shelf_tokens SET "lastUsedAt"=NOW() WHERE id=$1`, [row.id]).catch(() => {});
      next();
    } catch (err) {
      log().error(errInfo(err), '[shelf auth]');
      sendError(res, 500, 'Something went wrong. Try again.');
    }
  }

  const requireScope = (scope) => (req, res, next) => {
    if (req.shelf.allowed.includes(scope)) return next();
    const held = req.shelf.blocked.some((b) => b.scope === scope);
    return sendError(res, 403, held ? 'This part of Vault is switched off for your account.' : `This key does not allow "${SCOPES[scope].label}".`, held ? 'FEATURE_DISABLED' : 'SCOPE_MISSING');
  };

  // ================================================================ ingest router
  const ingest = express.Router();
  const json = express.json({ limit: '2mb' });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, fieldSize: 900 * 1024 },
  });
  ingest.use(shelfAuth);

  // GET /api/quick-ingest/verify: is this key good, and what can it do right now? (The app hides buttons the server would refuse.)
  ingest.get('/verify', (req, res) => {
    res.json({
      ok: true,
      keyLabel: req.shelf.label,
      account: req.shelf.email,
      scopes: req.shelf.allowed,
      unavailable: req.shelf.blocked,
      limits: { maxTextChars: MAX_TEXT_CHARS, maxImageBytes: MAX_IMAGE_BYTES, maxRedactChars: MAX_REDACT_CHARS, extractionsPerHour: LIMITS.extractionsPerHour },
      serverTime: new Date().toISOString(),
    });
  });

  // POST /api/quick-ingest/notes  { clipId, text?, title?, sourceApp? } or multipart with a `file` picture
  ingest.post('/notes', requireScope('notes:write'), json, upload.single('file'), async (req, res) => {
    const { userId } = req.shelf;
    const read = readClip(req);
    if (read.error) return sendError(res, read.error[0], read.error[1]);
    const { clip } = read;
    let claimed = false;
    try {
      const c = await claim(userId, clip.clipId, 'notes');
      if (answerDuplicate(res, c)) return;
      claimed = true;
      if (clip.image) await deps.assertAttachmentQuota(userId, clip.image.buffer.length);
      const title = clip.title || (clip.text.trim() ? noteTitle('', clip.text) : 'Clipboard picture');
      const { rows } = await pool.query(
        `INSERT INTO notes (user_id, title, body, source) VALUES ($1,$2,$3,'shelf') RETURNING id`, [userId, title, clip.text]);
      const noteId = rows[0].id;
      if (clip.image) {
        try {
          await deps.saveBufferAttachment({ userId, entityType: 'note', entityId: noteId, folder: `note-${noteId}`, buffer: clip.image.buffer, mime: clip.image.mime, filename: `clipboard-${Date.now()}${clip.image.ext}` });
        } catch (err) {
          await pool.query('DELETE FROM notes WHERE id=$1 AND user_id=$2', [noteId, userId]);
          throw err;
        }
      }
      try { deps.queueEmbed(userId, noteId); } catch { /* search by meaning catches up later; the note is already saved */ }
      await finish(userId, clip.clipId, 'notes', noteId);
      res.status(201).json({ ok: true, id: noteId, kind: clip.image ? 'image' : 'text' });
    } catch (err) {
      if (claimed) await release(userId, clip.clipId, 'notes');
      if (err?.statusCode === 413) return sendError(res, 413, err.message, 'QUOTA');
      log().error(errInfo(err), '[shelf notes]');
      sendError(res, 500, 'Could not save the note. Try again.');
    }
  });

  // POST /api/quick-ingest/finance  { clipId, text?, sourceApp? } or multipart with a `file` picture -> a row in the Invoice Review queue
  ingest.post('/finance', requireScope('finance:write'), json, upload.single('file'), async (req, res) => {
    const { userId, tokenId } = req.shelf;
    const read = readClip(req);
    if (read.error) return sendError(res, read.error[0], read.error[1]);
    const { clip } = read;
    let claimed = false;
    let savedPath = null;
    try {
      const c = await claim(userId, clip.clipId, 'finance');
      if (answerDuplicate(res, c)) return;
      claimed = true;
      const full = await assertShelfQuota(userId, clip.image ? clip.image.buffer.length : 0);
      if (full) { await release(userId, clip.clipId, 'finance'); return sendError(res, 413, full, 'QUOTA'); }

      // Suggestions from the model, capped to 20 an hour per key. Past the cap (or with no model) the clip is still queued, blank.
      let result;
      if (limiter.take(`x:${tokenId}`, LIMITS.extractionsPerHour, HOUR)) {
        result = await deps.extractExpenseClip({ userId, text: clip.text, image: clip.image ? clip.image.buffer : null });
      } else {
        result = { status: 'rate_limited', fields: null, suggested: null, confidence: 0 };
      }
      const f = result.fields;

      if (clip.image) {
        savedPath = deps.saveInvoiceFile(clip.image.buffer, { vendor: f?.vendor, key: crypto.randomBytes(8).toString('hex'), date: f?.date, ext: clip.image.ext });
      }
      const raw = {
        source: 'shelf', kind: clip.image ? 'image' : 'text', sourceApp: clip.sourceApp || null,
        extractionStatus: result.status, confidence: result.confidence, model: result.model || null,
        suggested: result.suggested, text: clip.text ? clip.text.slice(0, 10000) : null,
      };
      // Same rule as Gmail invoices: only an AUD total is filled in; any other currency is left for the reviewer.
      const amount = f && f.currency === 'AUD' && f.amount ? f.amount : null;
      const { rows } = await pool.query(
        `INSERT INTO expense_review_queue
           ("userId","gmailMessageId","threadId",vendor,amount,"invoiceDate",category,"s3Url","rawExtraction","reviewStatus",source,"sizeBytes")
         VALUES ($1,NULL,NULL,$2,$3,$4,NULL,$5,$6,'pending','shelf',$7) RETURNING id`,
        [userId, f?.vendor || null, amount, f?.date || null, savedPath, JSON.stringify(raw), clip.image ? clip.image.buffer.length : null]);
      await finish(userId, clip.clipId, 'finance', rows[0].id);
      res.status(201).json({ ok: true, id: rows[0].id, extraction: result.status, filled: { vendor: f?.vendor || null, amount, invoiceDate: f?.date || null } });
    } catch (err) {
      if (savedPath) { try { fs.unlinkSync(path.join(uploadDir(), savedPath)); } catch { /* nothing to remove */ } }
      if (claimed) await release(userId, clip.clipId, 'finance');
      log().error(errInfo(err), '[shelf finance]');
      sendError(res, 500, 'Could not queue the item. Try again.');
    }
  });

  // POST /api/quick-ingest/crm  { clipId, text?, title?, sourceApp? } or multipart with a `file` picture -> the unfiled CRM inbox
  ingest.post('/crm', requireScope('crm:write'), json, upload.single('file'), async (req, res) => {
    const { userId, tokenId } = req.shelf;
    const read = readClip(req);
    if (read.error) return sendError(res, read.error[0], read.error[1]);
    const { clip } = read;
    let claimed = false;
    let savedFull = null;
    try {
      const c = await claim(userId, clip.clipId, 'crm');
      if (answerDuplicate(res, c)) return;
      claimed = true;
      const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM shelf_inbox WHERE "userId"=$1`, [userId]);
      if (n >= MAX_UNFILED) { await release(userId, clip.clipId, 'crm'); return sendError(res, 409, `You have ${MAX_UNFILED} unfiled captures. File or delete some in the CRM first.`, 'INBOX_FULL'); }
      const full = await assertShelfQuota(userId, clip.image ? clip.image.buffer.length : 0);
      if (full) { await release(userId, clip.clipId, 'crm'); return sendError(res, 413, full, 'QUOTA'); }

      let filePath = null;
      if (clip.image) {
        const dir = path.join(uploadDir(), 'shelf-inbox', String(userId));
        fs.mkdirSync(dir, { recursive: true });
        savedFull = path.join(dir, `${crypto.randomBytes(12).toString('hex')}${clip.image.ext}`);
        fs.writeFileSync(savedFull, clip.image.buffer);
        filePath = rel(savedFull);
      }
      const { rows } = await pool.query(
        `INSERT INTO shelf_inbox ("userId",kind,title,body,"filePath","mimeType","sizeBytes","sourceApp","tokenId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [userId, clip.image ? 'image' : 'text', clip.title || null, clip.text || null, filePath, clip.image ? clip.image.mime : null,
          clip.image ? clip.image.buffer.length : Buffer.byteLength(clip.text, 'utf8'), clip.sourceApp || null, tokenId]);
      await finish(userId, clip.clipId, 'crm', rows[0].id);
      res.status(201).json({ ok: true, id: rows[0].id, status: 'unfiled' });
    } catch (err) {
      if (savedFull) { try { fs.unlinkSync(savedFull); } catch { /* nothing to remove */ } }
      if (claimed) await release(userId, clip.clipId, 'crm');
      log().error(errInfo(err), '[shelf crm]');
      sendError(res, 500, 'Could not save the capture. Try again.');
    }
  });

  // POST /api/quick-ingest/redact  { text } -> where sensitive-looking details are. Nothing is stored or logged; no model is called.
  ingest.post('/redact', requireScope('redact:check'), json, (req, res) => {
    if (!limiter.take(`r:${req.shelf.tokenId}`, LIMITS.redactPerMinute, MINUTE)) return sendError(res, 429, 'Too many checks. Wait a minute.', 'RATE_LIMITED');
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || !text.trim()) return sendError(res, 400, 'text is required.');
    res.json({ ok: true, ...scanText(text) });
  });

  // anything that goes wrong before a route runs (bad JSON, too big, bad multipart) lands here, with no content in the answer or the log
  // eslint-disable-next-line no-unused-vars
  ingest.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'That picture is larger than 10 MB.', 'TOO_LARGE');
    if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FIELD_VALUE') return sendError(res, 413, 'That clip is too large.', 'TOO_LARGE');
    if (err?.type === 'entity.parse.failed') return sendError(res, 400, 'The request body is not valid JSON.');
    if (err?.name === 'MulterError') return sendError(res, 400, 'The upload was not understood.');
    log().error(errInfo(err), '[shelf ingest]');
    return sendError(res, 500, 'Something went wrong. Try again.');
  });

  // ================================================================ keys (Settings page, signed in)
  const tokens = express.Router();
  const tokenWire = (r) => ({
    id: r.id, label: r.label, hint: `${r.prefix}…${r.last4}`, scopes: r.scopes, expiresAt: r.expiresAt, lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt, createdAt: r.createdAt,
    status: r.revokedAt ? 'revoked' : (r.expiresAt && new Date(r.expiresAt) <= new Date() ? 'expired' : 'active'),
  });
  const COLS = `id, label, prefix, last4, scopes, "expiresAt", "lastUsedAt", "revokedAt", "createdAt"`;

  async function scopeMenu(req) {
    const flags = req.user.isAdmin ? {} : await deps.loadFeatureAccess(req.user.id);
    return SCOPE_NAMES.map((name) => ({ name, label: SCOPES[name].label, available: scopeAllowed(name, flags, req.user.isAdmin) }));
  }

  tokens.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT ${COLS} FROM shelf_tokens WHERE "userId"=$1 ORDER BY id DESC`, [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ tokens: rows.map(tokenWire), scopes: await scopeMenu(req), maxActive: MAX_ACTIVE_TOKENS });
    } catch (err) {
      log().error(errInfo(err), '[shelf tokens list]');
      sendError(res, 500, 'Could not load your keys.');
    }
  });

  // POST /api/shelf-tokens  { label, scopes: [...], expiresInDays? } -> the key, shown ONCE
  tokens.post('/', async (req, res) => {
    try {
      const label = cleanLabel(req.body?.label);
      if (!label) return sendError(res, 400, 'Give the key a name, for example "Work laptop".');
      const scopes = cleanScopes(req.body?.scopes);
      if (!scopes.length) return sendError(res, 400, 'Tick at least one thing the key may do.');
      const menu = await scopeMenu(req);
      const off = scopes.filter((s) => !menu.find((m) => m.name === s)?.available);
      if (off.length) return sendError(res, 400, `Switched off for your account: ${off.map((s) => SCOPES[s].label).join(', ')}.`);
      let expiresAt = null;
      if (req.body?.expiresInDays != null && req.body.expiresInDays !== '') {
        const days = Number(req.body.expiresInDays);
        if (!Number.isInteger(days) || days < 1 || days > 365) return sendError(res, 400, 'Expiry must be 1 to 365 days.');
        expiresAt = new Date(Date.now() + days * 86400000);
      }
      const { rows: [{ n }] } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM shelf_tokens WHERE "userId"=$1 AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`, [req.user.id]);
      if (n >= MAX_ACTIVE_TOKENS) return sendError(res, 409, `You already have ${MAX_ACTIVE_TOKENS} active keys. Revoke one first.`);
      const k = newToken();
      const { rows } = await pool.query(
        `INSERT INTO shelf_tokens ("userId",label,"tokenHash",prefix,last4,scopes,"expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
        [req.user.id, label, k.tokenHash, k.prefix, k.last4, scopes, expiresAt]);
      res.status(201).set('Cache-Control', 'no-store').json({ ...tokenWire(rows[0]), token: k.token });
    } catch (err) {
      log().error(errInfo(err), '[shelf tokens create]');
      sendError(res, 500, 'Could not make the key. Try again.');
    }
  });

  // POST /api/shelf-tokens/:id/revoke
  tokens.post('/:id/revoke', async (req, res) => {
    try {
      if (!/^\d{1,10}$/.test(req.params.id)) return sendError(res, 404, 'Key not found.');
      const { rows } = await pool.query(
        `UPDATE shelf_tokens SET "revokedAt"=NOW() WHERE id=$1 AND "userId"=$2 AND "revokedAt" IS NULL RETURNING ${COLS}`, [req.params.id, req.user.id]);
      if (!rows[0]) return sendError(res, 404, 'Key not found, or already revoked.');
      res.json(tokenWire(rows[0]));
    } catch (err) {
      log().error(errInfo(err), '[shelf tokens revoke]');
      sendError(res, 500, 'Could not revoke the key. Try again.');
    }
  });

  // DELETE /api/shelf-tokens/:id  -- removes a key that is already revoked or expired from the list
  tokens.delete('/:id', async (req, res) => {
    try {
      if (!/^\d{1,10}$/.test(req.params.id)) return sendError(res, 404, 'Key not found.');
      const { rowCount } = await pool.query(
        `DELETE FROM shelf_tokens WHERE id=$1 AND "userId"=$2 AND ("revokedAt" IS NOT NULL OR ("expiresAt" IS NOT NULL AND "expiresAt" <= NOW()))`, [req.params.id, req.user.id]);
      if (!rowCount) return sendError(res, 404, 'Key not found. Revoke an active key before removing it.');
      res.json({ ok: true });
    } catch (err) {
      log().error(errInfo(err), '[shelf tokens delete]');
      sendError(res, 500, 'Could not remove the key. Try again.');
    }
  });

  // ================================================================ unfiled CRM captures (CRM page, signed in)
  const inbox = express.Router();
  const itemWire = (r) => ({
    id: r.id, kind: r.kind, title: r.title, excerpt: r.body ? r.body.slice(0, 400) : null, mimeType: r.mimeType, sizeBytes: r.sizeBytes,
    sourceApp: r.sourceApp, createdAt: r.createdAt,
  });

  inbox.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT id,kind,title,body,"mimeType","sizeBytes","sourceApp","createdAt" FROM shelf_inbox WHERE "userId"=$1 ORDER BY id DESC LIMIT 200`, [req.user.id]);
      const { rows: clients } = await pool.query(`SELECT id, name FROM clients WHERE "userId"=$1 ORDER BY name ASC`, [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ items: rows.map(itemWire), clients, count: rows.length });
    } catch (err) {
      log().error(errInfo(err), '[shelf inbox list]');
      sendError(res, 500, 'Could not load the unfiled captures.');
    }
  });

  inbox.get('/count', async (req, res) => {
    try {
      const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM shelf_inbox WHERE "userId"=$1`, [req.user.id]);
      res.json({ count: n });
    } catch (err) {
      log().error(errInfo(err), '[shelf inbox count]');
      sendError(res, 500, 'Could not count the unfiled captures.');
    }
  });

  inbox.get('/:id/file', async (req, res) => {
    try {
      if (!/^\d{1,10}$/.test(req.params.id)) return sendError(res, 404, 'Not found.');
      const { rows } = await pool.query(`SELECT "filePath","mimeType" FROM shelf_inbox WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
      if (!rows[0] || !rows[0].filePath) return sendError(res, 404, 'Not found.');
      const full = path.resolve(uploadDir(), rows[0].filePath);
      if (!full.startsWith(path.resolve(uploadDir()) + path.sep) || !fs.existsSync(full)) return sendError(res, 404, 'Not found.');
      res.set({ 'Content-Type': rows[0].mimeType || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
      fs.createReadStream(full).pipe(res);
    } catch (err) {
      log().error(errInfo(err), '[shelf inbox file]');
      sendError(res, 500, 'Could not open the picture.');
    }
  });

  // POST /api/shelf-inbox/:id/assign  { clientId, contactId?, dealId?, note? } -> a real note on that client's activity feed
  inbox.post('/:id/assign', async (req, res) => {
    if (!/^\d{1,10}$/.test(req.params.id)) return sendError(res, 404, 'Not found.');
    const userId = req.user.id;
    const clientId = Number(req.body?.clientId);
    if (!Number.isInteger(clientId) || clientId < 1) return sendError(res, 400, 'Choose a client.');
    const db = await pool.connect();
    let attached = false;
    let interactionId = null;
    try {
      await db.query('BEGIN');
      const { rows: [item] } = await db.query(`SELECT * FROM shelf_inbox WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [req.params.id, userId]);
      if (!item) { await db.query('ROLLBACK'); return sendError(res, 404, 'Not found. It may already be filed.'); }
      const { rows: [cl] } = await db.query(`SELECT id FROM clients WHERE id=$1 AND "userId"=$2`, [clientId, userId]);
      if (!cl) { await db.query('ROLLBACK'); return sendError(res, 404, 'Client not found.'); }
      const contactId = req.body?.contactId ? Number(req.body.contactId) : null;
      const dealId = req.body?.dealId ? Number(req.body.dealId) : null;
      if (contactId) {
        const { rows: [c] } = await db.query(`SELECT id FROM client_contacts WHERE id=$1 AND "clientId"=$2`, [contactId, clientId]);
        if (!c) { await db.query('ROLLBACK'); return sendError(res, 400, 'That contact does not belong to this client.'); }
      }
      if (dealId) {
        const { rows: [d] } = await db.query(`SELECT id FROM client_deals WHERE id=$1 AND "clientId"=$2`, [dealId, clientId]);
        if (!d) { await db.query('ROLLBACK'); return sendError(res, 400, 'That deal does not belong to this client.'); }
      }
      const edited = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      const note = edited || (item.body || '').trim() || 'Picture captured with Vault Shelf.';
      const { rows: [row] } = await db.query(
        `INSERT INTO client_interactions ("clientId","userId","contactId","dealId",type,date,title,note)
         VALUES ($1,$2,$3,$4,'note',$5,'Captured with Vault Shelf',$6) RETURNING id`,
        [clientId, userId, contactId, dealId, item.createdAt, note]);
      interactionId = row.id;
      if (item.kind === 'image' && item.filePath) {
        const full = path.resolve(uploadDir(), item.filePath);
        if (!full.startsWith(path.resolve(uploadDir()) + path.sep) || !fs.existsSync(full)) throw Object.assign(new Error('The saved picture is missing.'), { statusCode: 410 });
        await deps.saveBufferAttachment({
          userId, entityType: 'touchpoint', entityId: interactionId, folder: String(clientId), buffer: fs.readFileSync(full),
          mime: item.mimeType || 'image/png', filename: `shelf-${item.id}${path.extname(full) || '.png'}`,
        });
        attached = true;
      }
      await db.query(`DELETE FROM shelf_inbox WHERE id=$1`, [item.id]);
      await db.query('COMMIT');
      if (item.filePath) { try { fs.unlinkSync(path.resolve(uploadDir(), item.filePath)); } catch { /* already gone */ } }
      deps.logCrmAudit({ userId, clientId, entityType: 'touchpoint', entityId: interactionId, action: 'create', after: { id: interactionId, source: 'shelf' } });
      res.status(201).json({ ok: true, interactionId, clientId });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      if (attached && interactionId) await deps.deleteAttachmentsForEntityIds('touchpoint', [interactionId]).catch(() => {});
      if (err?.statusCode === 413 || err?.statusCode === 410) return sendError(res, err.statusCode, err.message);
      log().error(errInfo(err), '[shelf inbox assign]');
      sendError(res, 500, 'Could not file the capture. Try again.');
    } finally {
      db.release();
    }
  });

  // DELETE /api/shelf-inbox/:id  -- throw a capture away (it is only a copy of what was on the clipboard)
  inbox.delete('/:id', async (req, res) => {
    try {
      if (!/^\d{1,10}$/.test(req.params.id)) return sendError(res, 404, 'Not found.');
      const { rows } = await pool.query(`DELETE FROM shelf_inbox WHERE id=$1 AND "userId"=$2 RETURNING "filePath"`, [req.params.id, req.user.id]);
      if (!rows[0]) return sendError(res, 404, 'Not found.');
      if (rows[0].filePath) { try { fs.unlinkSync(path.resolve(uploadDir(), rows[0].filePath)); } catch { /* already gone */ } }
      res.json({ ok: true });
    } catch (err) {
      log().error(errInfo(err), '[shelf inbox delete]');
      sendError(res, 500, 'Could not delete the capture.');
    }
  });

  return { ingest, tokens, inbox, limiter };
}

module.exports = { createRouters, LIMITS, MAX_TEXT_CHARS, MAX_IMAGE_BYTES, MAX_UNFILED, SHELF_QUOTA_BYTES, CLIP_ID_RE };
