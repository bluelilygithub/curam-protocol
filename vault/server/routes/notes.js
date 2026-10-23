'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { pool } = require('../db');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { ffmpegRoute } = require('../middleware/ffmpegRoute');
const { getLogger } = require('../middleware/requestContext');
const { toSpeechMp3, withTempDir } = require('../services/videoFfmpeg');
const { transcribeAudioWithGemini, isGeminiTranscribeAvailable } = require('../services/videoGenerateService');
const { buildVoiceNote } = require('../services/voiceNote');
const noteAi = require('../services/noteAi'); // called as noteAi.runNoteAction so tests can swap it
const { normalizeTag, normalizeTags } = require('../services/noteTags');
const noteViews = require('../services/noteViews');
const noteQuery = require('../services/noteQuery');
const noteEmbeddings = require('../services/noteEmbeddings'); // meaning-based search: a note is embedded a little after it is saved
const noteAsk = require('../services/noteAsk'); // called as noteAsk.askNotes, with noteAsk.routeDeps, so tests can swap the models
const noteFileText = require('../services/noteFileText'); // reads the text inside attached files (for Ask)
const noteReminders = require('../services/noteReminders');
const {
  createAttachmentUpload, rejectIfDisguisedExecutable, assertWithinQuota, insertAttachment, attachmentsForEntity, MAX_FILE_BYTES,
} = require('../utils/attachments'); // the same upload policy as task and CRM attachments
const noteRepeat = require('../services/noteRepeat');
const bin = require('../services/recycleBin'); // deleted notes and templates wait here for 30 days
bin.loadAdapters();

const MAX_TEMPLATES = 50;
const MAX_FILES_PER_NOTE = 20;
const uploadNoteFile = createAttachmentUpload((req) => `notes/${Number(req.params.id) || 0}`);
const MAX_TEMPLATE_BODY = 20000;

// One note in full: its text, project and client names, and tags.
const FULL_NOTE_SQL = `SELECT n.*, p.name AS project_name, c.name AS client_name,
       COALESCE((SELECT array_agg(nt.tag ORDER BY nt.tag) FROM note_tags nt WHERE nt.note_id = n.id), '{}') AS tags
  FROM notes n
  LEFT JOIN projects p ON p.id = n.project_id AND p."userId" = n.user_id
  LEFT JOIN clients  c ON c.id = n.client_id AND c."userId" = n.user_id
 WHERE n.id=$1 AND n.user_id=$2`;

// A recording is held in memory only while it is turned into text; it is never written anywhere that outlives the request.
const MAX_RECORDING_BYTES = 60 * 1024 * 1024;
const MAX_SPEECH_BYTES = 18 * 1024 * 1024; // the speech track Gemini is sent (about 75 minutes)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECORDING_BYTES } });

const LIST_DEFAULT = 100;
const LIST_MAX = 300;

// GET /api/notes  — a light list: no full body, just a short `preview`. The editor loads one note in full with GET /:id.
//   ?q=search (title, text, project and client name)  &project_id=N  &client_id=N  &unfiled=1 (no project and no client)
//   &reminder=due|upcoming|any (due now / still to come / either, never the ones marked done)  &tags=a,b (notes that have ALL these tags)  &untagged=1  &files=with|without (has / has no attached files)  &from=ISO&to=ISO (to is exclusive)  &field=updated|created (which date from/to apply to; also the sort)
//   &limit=N (default 100, max 300)  &offset=N   — header X-Has-More: 1 when there are more after this page.
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const filters = noteQuery.buildFilters(userId, req.query); // shared with "Ask your notes": the same meaning of "the notes in this view"
  if (filters.error) return res.status(400).json({ error: filters.error });
  const { where, params, dateCol } = filters;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || LIST_DEFAULT, 1), LIST_MAX);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  if (req.query.q) noteFileText.backfill(userId); // searching also looks inside files, so read any attached before file text existed (a background job, one at a time)

  const sql = `
    SELECT n.id, n.title, left(n.body, 240) AS preview, n.project_id, n.client_id, n.source,
           n.created_at, n.updated_at, n.pinned_at, n.remind_at, n.remind_email, n.remind_repeat, n.reminder_done_at, p.name AS project_name, c.name AS client_name,
           (SELECT COUNT(*)::int FROM attachments a WHERE a."entityType"='note' AND a."entityId" = n.id) AS attachment_count,
           COALESCE((SELECT array_agg(nt.tag ORDER BY nt.tag) FROM note_tags nt WHERE nt.note_id = n.id), '{}') AS tags
      ${noteQuery.NOTE_JOINS}
     WHERE ${where.join(' AND ')}
     ORDER BY (n.pinned_at IS NOT NULL) DESC, n.pinned_at DESC NULLS LAST, ${dateCol} DESC, n.id DESC
     LIMIT ${limit + 1} OFFSET ${offset}`;
  try {
    const { rows } = await pool.query(sql, params);
    const more = rows.length > limit;
    if (more) rows.pop();
    res.set('X-Has-More', more ? '1' : '0');
    res.json(rows);
  } catch (err) {
    getLogger().error({ err }, '[notes list]');
    res.status(500).json({ error: 'Could not load your notes. Try again.' });
  }
});

// GET /api/notes/options  — the caller's clients (id + name only) for the client filter and picker. Named route: before /:id.
// (GET /api/clients does invoice and mood sums per client; the Notes screen only needs names.)
router.get('/options', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM clients WHERE "userId"=$1 ORDER BY name ASC', [req.user.id]);
    res.json({ clients: rows });
  } catch (err) {
    getLogger().error({ err }, '[notes options]');
    res.status(500).json({ error: 'Could not load clients. Try again.' });
  }
});

// GET /api/notes/tags  — every tag the caller uses, with how many notes carry it (most used first). Named route: before /:id.
router.get('/tags', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT tag, COUNT(*)::int AS count FROM note_tags WHERE user_id=$1 GROUP BY tag ORDER BY count DESC, tag ASC', [req.user.id]);
    res.json(rows);
  } catch (err) {
    getLogger().error({ err }, '[notes tags]');
    res.status(500).json({ error: 'Could not load tags. Try again.' });
  }
});

// POST /api/notes/tags/rename  { from, to } — rename a tag on every note; renaming onto an existing tag merges the two.
router.post('/tags/rename', async (req, res) => {
  const from = normalizeTag(req.body?.from);
  const to = normalizeTag(req.body?.to);
  if (!from || !to) return res.status(400).json({ error: 'Give the tag and its new name.' });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (from !== to) {
      await db.query('INSERT INTO note_tags (note_id, user_id, tag) SELECT note_id, user_id, $3 FROM note_tags WHERE user_id=$1 AND tag=$2 ON CONFLICT DO NOTHING', [req.user.id, from, to]);
      await db.query('DELETE FROM note_tags WHERE user_id=$1 AND tag=$2', [req.user.id, from]);
    }
    await db.query('COMMIT');
    res.json({ from, to });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    getLogger().error({ err }, '[notes tag rename]');
    res.status(500).json({ error: 'Could not rename the tag. Try again.' });
  } finally {
    db.release();
  }
});

// DELETE /api/notes/tags/:tag — take a tag off every note. The notes themselves are not touched.
router.delete('/tags/:tag', async (req, res) => {
  const tag = normalizeTag(req.params.tag);
  if (!tag) return res.status(400).json({ error: 'Give the tag to remove.' });
  try {
    const r = await pool.query('DELETE FROM note_tags WHERE user_id=$1 AND tag=$2', [req.user.id, tag]);
    res.json({ tag, removedFrom: r.rowCount });
  } catch (err) {
    getLogger().error({ err }, '[notes tag delete]');
    res.status(500).json({ error: 'Could not remove the tag. Try again.' });
  }
});

// ── Templates: the person's own (the built-in ones are in the browser) ───────────────────────────────────────────────────────────────
// Named routes: before /:id.

// Validate and tidy template fields. `partial` lets PUT leave a field out. Returns { error } or { value }.
function cleanTemplate(input, { partial = false } = {}) {
  const out = {};
  const b = input || {};
  if (!partial || b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'Give the template a name.' };
    out.name = b.name.trim().slice(0, 60);
  }
  for (const [key, max] of [['title', 200], ['body', MAX_TEMPLATE_BODY]]) {
    if (!partial || b[key] !== undefined) {
      if (b[key] !== undefined && typeof b[key] !== 'string') return { error: `${key} must be text` };
      out[key] = String(b[key] ?? '').slice(0, max);
    }
  }
  if (!partial || b.tags !== undefined) {
    const tags = b.tags === undefined ? [] : normalizeTags(b.tags);
    if (!tags) return { error: 'tags must be a list' };
    out.tags = tags;
  }
  return { value: out };
}

// GET /api/notes/templates
router.get('/templates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, title, body, tags FROM note_templates WHERE user_id=$1 ORDER BY lower(name), id', [req.user.id]);
    res.json(rows);
  } catch (err) {
    getLogger().error({ err }, '[notes templates]');
    res.status(500).json({ error: 'Could not load your templates. Try again.' });
  }
});

// POST /api/notes/templates  { name, title?, body?, tags? }
router.post('/templates', async (req, res) => {
  const { error, value } = cleanTemplate(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const count = Number((await pool.query('SELECT COUNT(*) FROM note_templates WHERE user_id=$1', [req.user.id])).rows[0].count);
    if (count >= MAX_TEMPLATES) return res.status(400).json({ error: `You can keep up to ${MAX_TEMPLATES} templates. Delete one first.` });
    const { rows } = await pool.query(
      'INSERT INTO note_templates (user_id, name, title, body, tags) VALUES ($1,$2,$3,$4,$5::text[]) RETURNING id, name, title, body, tags',
      [req.user.id, value.name, value.title, value.body, value.tags]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes template create]');
    res.status(500).json({ error: 'Could not save the template. Try again.' });
  }
});

// PUT /api/notes/templates/:id  — change any of name, title, body, tags
router.put('/templates/:id', async (req, res) => {
  const { error, value } = cleanTemplate(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await pool.query(
      `UPDATE note_templates SET name = COALESCE($3, name), title = COALESCE($4, title), body = COALESCE($5, body),
              tags = COALESCE($6::text[], tags), updated_at = NOW()
        WHERE id=$1 AND user_id=$2 RETURNING id, name, title, body, tags`,
      [Number(req.params.id) || 0, req.user.id, value.name ?? null, value.title ?? null, value.body ?? null, value.tags ?? null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes template update]');
    res.status(500).json({ error: 'Could not save the template. Try again.' });
  }
});

// DELETE /api/notes/templates/:id  — to the recycle bin (30 days), not gone for good
router.delete('/templates/:id', async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM note_templates WHERE id=$1 AND user_id=$2 FOR UPDATE', [Number(req.params.id) || 0, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const t = rows[0];
    const binId = await bin.moveToBin(db, { userId: req.user.id, type: 'note-template', id: t.id, title: t.name, detail: t.title || null, payload: { template: t } });
    await db.query('DELETE FROM note_templates WHERE id=$1', [t.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    getLogger().error({ err }, '[notes template delete]');
    res.status(500).json({ error: 'Could not delete the template. Try again.' });
  } finally {
    db.release();
  }
});

// ── Saved views: a name for a combination of filters and grouping. Named routes: before /:id. ────────────────────────────────────────

const VIEW_NAME_TAKEN = 'You already have a view with that name.';

// GET /api/notes/views
router.get('/views', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, filters FROM note_views WHERE user_id=$1 ORDER BY lower(name), id', [req.user.id]);
    res.json(rows);
  } catch (err) {
    getLogger().error({ err }, '[notes views]');
    res.status(500).json({ error: 'Could not load your saved views. Try again.' });
  }
});

// POST /api/notes/views  { name, filters }
router.post('/views', async (req, res) => {
  const name = noteViews.normalizeName(req.body?.name);
  const filters = noteViews.normalizeFilters(req.body?.filters);
  if (!name) return res.status(400).json({ error: 'Give the view a name.' });
  if (!filters) return res.status(400).json({ error: 'filters must be an object' });
  try {
    const count = Number((await pool.query('SELECT COUNT(*) FROM note_views WHERE user_id=$1', [req.user.id])).rows[0].count);
    if (count >= noteViews.MAX_VIEWS) return res.status(400).json({ error: `You can keep up to ${noteViews.MAX_VIEWS} saved views. Delete one first.` });
    const { rows } = await pool.query('INSERT INTO note_views (user_id, name, filters) VALUES ($1,$2,$3::jsonb) RETURNING id, name, filters', [req.user.id, name, JSON.stringify(filters)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: VIEW_NAME_TAKEN });
    getLogger().error({ err }, '[notes view create]');
    res.status(500).json({ error: 'Could not save the view. Try again.' });
  }
});

// PUT /api/notes/views/:id  { name?, filters? }  — rename it, and/or replace its filters with the current ones
router.put('/views/:id', async (req, res) => {
  const hasName = req.body?.name !== undefined;
  const hasFilters = req.body?.filters !== undefined;
  if (!hasName && !hasFilters) return res.status(400).json({ error: 'Nothing to change.' });
  const name = hasName ? noteViews.normalizeName(req.body.name) : null;
  const filters = hasFilters ? noteViews.normalizeFilters(req.body.filters) : null;
  if (hasName && !name) return res.status(400).json({ error: 'Give the view a name.' });
  if (hasFilters && !filters) return res.status(400).json({ error: 'filters must be an object' });
  try {
    const { rows } = await pool.query(
      `UPDATE note_views SET name = COALESCE($3, name), filters = COALESCE($4::jsonb, filters), updated_at = NOW()
        WHERE id=$1 AND user_id=$2 RETURNING id, name, filters`,
      [Number(req.params.id) || 0, req.user.id, name, filters ? JSON.stringify(filters) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: VIEW_NAME_TAKEN });
    getLogger().error({ err }, '[notes view update]');
    res.status(500).json({ error: 'Could not save the view. Try again.' });
  }
});

// DELETE /api/notes/views/:id  — to the recycle bin (30 days)
router.delete('/views/:id', async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM note_views WHERE id=$1 AND user_id=$2 FOR UPDATE', [Number(req.params.id) || 0, req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const v = rows[0];
    const binId = await bin.moveToBin(db, { userId: req.user.id, type: 'note-view', id: v.id, title: v.name, detail: 'Saved view in Notes', payload: { view: v } });
    await db.query('DELETE FROM note_views WHERE id=$1', [v.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    getLogger().error({ err }, '[notes view delete]');
    res.status(500).json({ error: 'Could not delete the view. Try again.' });
  } finally {
    db.release();
  }
});

// ── Ask your notes: a chat grounded only in the person's own notes (server/services/noteAsk.js). Named routes: before /:id. ─────────────

const QA_KEEP = 100; // answers kept per person

// GET /api/notes/ask  — the recent questions and answers, oldest first (the conversation as it was)
router.get('/ask', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, question, answer, sources, scope, searched, stage, related, created_at FROM note_qa WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [req.user.id]);
    res.json(rows.reverse());
  } catch (err) {
    getLogger().error({ err }, '[notes ask history]');
    res.status(500).json({ error: 'Could not load your earlier questions. Try again.' });
  }
});

// POST /api/notes/ask  { question, history?: [{role, content}], scope?: { mode: 'all'|'filters'|'note', query?, noteId? }, today?, tzOffset? }
// Reads notes (never changes one), sends the text of the most relevant ones to the AI, and returns the answer with the notes it used.
router.post('/ask', aiLimiter, async (req, res) => {
  try {
    const result = await noteAsk.askNotes(req.user.id, req.body || {}, noteAsk.routeDeps);
    let id = null;
    if (!result.noModel) {
      const keep = result.sources.map((s) => ({ n: s.n, id: s.id, title: s.title, updated: s.updated, cited: s.cited, files: s.files }));
      const ins = await pool.query(
        'INSERT INTO note_qa (user_id, question, answer, sources, scope, searched, stage, related) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb) RETURNING id, created_at',
        [req.user.id, String(req.body.question).replace(/\s+/g, ' ').trim(), result.answer, JSON.stringify(keep), result.scope, result.searched || '', result.stage, JSON.stringify(result.related || [])]);
      id = ins.rows[0].id;
      result.createdAt = ins.rows[0].created_at;
      await pool.query('DELETE FROM note_qa WHERE user_id=$1 AND id NOT IN (SELECT id FROM note_qa WHERE user_id=$1 ORDER BY id DESC LIMIT $2)', [req.user.id, QA_KEEP]);
    }
    res.json({ id, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err }, '[notes ask]');
    res.status(500).json({ error: 'The AI could not answer just now.' });
  }
});

// DELETE /api/notes/ask/:id  — forget one answer
router.delete('/ask/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM note_qa WHERE id=$1 AND user_id=$2', [Number(req.params.id) || 0, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    getLogger().error({ err }, '[notes ask delete]');
    res.status(500).json({ error: 'Could not remove that answer. Try again.' });
  }
});

// DELETE /api/notes/ask  — forget the whole conversation history (the notes themselves are untouched)
router.delete('/ask', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM note_qa WHERE user_id=$1', [req.user.id]);
    res.json({ removed: r.rowCount });
  } catch (err) {
    getLogger().error({ err }, '[notes ask clear]');
    res.status(500).json({ error: 'Could not clear the history. Try again.' });
  }
});

// POST /api/notes/voice  (multipart: audio, optional tidy = 'false' to keep the words exactly as spoken)
// A recording in, a note out. The audio is turned into text and then discarded; only the text is kept. Named route: before /:id.
router.post('/voice', aiLimiter, upload.single('audio'), ffmpegRoute('voice-note', async (req, res) => {
  const userId = req.user.id;
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'There was nothing recorded. Try again.' });
  if (!(await isGeminiTranscribeAvailable(userId))) {
    return res.status(503).json({ error: 'Voice notes need the speech-to-text service, which is not set up on this server.' });
  }

  const ext = path.extname(String(req.file.originalname || '')).toLowerCase();
  const inExt = /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '.webm';
  let transcript;
  try {
    transcript = await withTempDir(async (dir) => {
      const inputPath = path.join(dir, `recording${inExt}`);
      const speechPath = path.join(dir, 'speech.mp3');
      await fs.writeFile(inputPath, req.file.buffer);
      await toSpeechMp3(inputPath, speechPath);
      const speech = await fs.readFile(speechPath);
      if (speech.length > MAX_SPEECH_BYTES) {
        const err = new Error('That recording is too long for one go (over about an hour). Record it in parts.');
        err.status = 413;
        throw err;
      }
      return transcribeAudioWithGemini(userId, speech.toString('base64'), 'audio/mp3', { format: 'text' });
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err; // ffmpegRoute reports it
  }
  transcript = String(transcript || '').replace(/^```[a-z]*\s*|```\s*$/gi, '').trim();
  if (!transcript) return res.status(422).json({ error: 'No speech was heard in that recording. Check the microphone and try again.' });

  const built = await buildVoiceNote(userId, transcript, { tidy: req.body?.tidy !== 'false' });
  try {
    const { rows } = await pool.query(
      "INSERT INTO notes (user_id, title, body, source) VALUES ($1, $2, $3, 'voice') RETURNING *",
      [userId, built.title, built.body]
    );
    res.status(201).json({ ...rows[0], tidied: built.tidied });
  } catch (err) {
    getLogger().error({ err }, '[notes/voice save]');
    res.status(500).json({ error: 'The recording was turned into text but the note could not be saved. Try again.' });
  }
}, { source: 'notes', routePrefix: 'notes' }));

// GET /api/notes/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, p.name AS project_name, c.name AS client_name,
              COALESCE((SELECT array_agg(nt.tag ORDER BY nt.tag) FROM note_tags nt WHERE nt.note_id = n.id), '{}') AS tags
         FROM notes n
         LEFT JOIN projects p ON p.id = n.project_id AND p."userId" = n.user_id
         LEFT JOIN clients  c ON c.id = n.client_id AND c."userId" = n.user_id
        WHERE n.id=$1 AND n.user_id=$2`,
      [Number(req.params.id) || 0, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const files = await attachmentsForEntity('note', rows[0].id);
    // readable: true / false once the file's text has been looked at, null while that is still to happen
    const seen = files.length ? new Map((await pool.query('SELECT attachment_id, status FROM attachment_text WHERE attachment_id = ANY($1::int[])', [files.map((f) => f.id)])).rows.map((r) => [r.attachment_id, r.status])) : new Map();
    res.json({ ...rows[0], attachments: files.map((f) => ({ ...f, readable: seen.has(f.id) ? seen.get(f.id) === 'ok' : null })) });
  } catch (err) {
    getLogger().error({ err }, '[notes read]');
    res.status(500).json({ error: 'Could not load the note. Try again.' });
  }
});

// A note's client_id has no foreign key (see db.js), so check here that the client exists
// and belongs to the caller. Returns true when fine; otherwise sends the 400 and returns false.
async function clientIdIsOwned(clientId, userId, res) {
  if (clientId == null || clientId === '') return true;
  const { rows } = await pool.query('SELECT 1 FROM clients WHERE id=$1 AND "userId"=$2', [Number(clientId) || 0, userId]);
  if (!rows.length) { res.status(400).json({ error: 'client_id does not match one of your clients' }); return false; }
  return true;
}

// Same check for a note's project: it must be one of the caller's own. Returns true when fine; otherwise sends the 400 and returns false.
async function projectIdIsOwned(projectId, userId, res) {
  if (projectId == null || projectId === '') return true;
  const { rows } = await pool.query('SELECT 1 FROM projects WHERE id=$1 AND "userId"=$2', [Number(projectId) || 0, userId]);
  if (!rows.length) { res.status(400).json({ error: 'project_id does not match one of your projects' }); return false; }
  return true;
}

// POST /api/notes
router.post('/', async (req, res) => {
  const { title = 'Untitled', body = '', project_id = null, client_id = null } = req.body;
  if (typeof title !== 'string' || typeof body !== 'string') return res.status(400).json({ error: 'title and body must be text' });
  try {
    if (!(await clientIdIsOwned(client_id, req.user.id, res))) return;
    if (!(await projectIdIsOwned(project_id, req.user.id, res))) return;
    const { rows } = await pool.query(
      'INSERT INTO notes (user_id, project_id, client_id, title, body) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [req.user.id, project_id || null, client_id || null, title.trim() || 'Untitled', body]
    );
    const { rows: note } = await pool.query('SELECT * FROM notes WHERE id=$1', [rows[0].id]);
    noteEmbeddings.queueEmbed(req.user.id, rows[0].id);
    res.status(201).json(note[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes create]');
    res.status(500).json({ error: 'Could not create the note. Try again.' });
  }
});

// PUT /api/notes/:id
router.put('/:id', async (req, res) => {
  const { title, body, project_id, client_id } = req.body;
  if ((title !== undefined && typeof title !== 'string') || (body !== undefined && typeof body !== 'string')) {
    return res.status(400).json({ error: 'title and body must be text' });
  }
  try {
    const { rows: existing } = await pool.query(
      'SELECT * FROM notes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    const e = existing[0];
    if (client_id !== undefined && !(await clientIdIsOwned(client_id, req.user.id, res))) return;
    if (project_id !== undefined && !(await projectIdIsOwned(project_id, req.user.id, res))) return;

    const newTitle = title !== undefined ? (title.trim() || 'Untitled') : e.title;
    const newBody  = body  !== undefined ? body  : e.body;
    const newProj  = project_id !== undefined ? (project_id || null) : e.project_id;
    // Older screens never send client_id, so an absent value keeps whatever is stored.
    const newClient = client_id !== undefined ? (client_id || null) : e.client_id;

    await pool.query(
      'UPDATE notes SET title=$1, body=$2, project_id=$3, client_id=$4, updated_at=NOW() WHERE id=$5 AND user_id=$6',
      [newTitle, newBody, newProj, newClient, req.params.id, req.user.id]
    );

    const { rows: updated } = await pool.query('SELECT * FROM notes WHERE id=$1', [req.params.id]);
    noteEmbeddings.queueEmbed(req.user.id, Number(req.params.id));
    res.json(updated[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes update]');
    res.status(500).json({ error: 'Could not save the note. Try again.' });
  }
});

// POST /api/notes/:id/attachments  (multipart, one `file`) — attach a file to the note. Same types, size cap (50 MB) and disguised-executable check as
// task and CRM attachments, the person's shared storage quota, and at most MAX_FILES_PER_NOTE files on a note. Attaching is filing, not editing:
// updated_at is left alone. Download and remove are the shared /api/attachments/:id routes (they check the note is the caller's).
router.post('/:id/attachments', async (req, res) => {
  const noteId = Number(req.params.id) || 0;
  try {
    // checked before the upload is read, so a refused request writes nothing to disk
    const own = await pool.query('SELECT (SELECT COUNT(*)::int FROM attachments WHERE "entityType"=\'note\' AND "entityId"=$1) AS files FROM notes WHERE id=$1 AND user_id=$2', [noteId, req.user.id]);
    if (!own.rows[0]) return res.status(404).json({ error: 'Not found' });
    if (own.rows[0].files >= MAX_FILES_PER_NOTE) return res.status(400).json({ error: `A note can have up to ${MAX_FILES_PER_NOTE} files. Remove one first.` });
  } catch (err) {
    getLogger().error({ err }, '[notes attach check]');
    return res.status(500).json({ error: 'Could not attach the file. Try again.' });
  }
  uploadNoteFile.single('file')(req, res, async (uploadErr) => {
    const dropFile = () => { try { if (req.file?.path) require('fs').unlinkSync(req.file.path); } catch { /* nothing left to remove */ } };
    if (uploadErr) {
      dropFile();
      const tooBig = uploadErr.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `That file is over ${MAX_FILE_BYTES / (1024 * 1024)} MB.` : uploadErr.message === 'File type not accepted' ? 'That kind of file cannot be attached. PDF, images, text, CSV and Office documents can.' : 'The file could not be attached.' });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'Choose a file to attach.' });
      await assertWithinQuota(req.user.id, req.file.size);
      await rejectIfDisguisedExecutable(req.file.path);
      const attachment = await insertAttachment({ userId: req.user.id, entityType: 'note', entityId: noteId, file: req.file });
      noteFileText.queueExtract({ id: attachment.id, userId: req.user.id, filename: attachment.filename, storedPath: req.file.path });
      res.status(201).json(attachment);
    } catch (err) {
      dropFile();
      if (err.statusCode) return res.status(err.statusCode).json({ error: err.statusCode === 413 ? err.message : 'That file cannot be attached: its content does not match its type.' });
      getLogger().error({ err }, '[notes attach]');
      res.status(500).json({ error: 'Could not attach the file. Try again.' });
    }
  });
});

// PUT /api/notes/:id/tags  { tags: [...] } — replace the note's tags (normalised, repeats dropped, at most 20). Like pinning, this is
// filing, not editing: it leaves updated_at alone.
router.put('/:id/tags', async (req, res) => {
  const tags = normalizeTags(req.body?.tags);
  if (!tags) return res.status(400).json({ error: 'tags must be a list' });
  const noteId = Number(req.params.id) || 0;
  const db = await pool.connect();
  try {
    const own = await db.query('SELECT 1 FROM notes WHERE id=$1 AND user_id=$2', [noteId, req.user.id]);
    if (!own.rows.length) return res.status(404).json({ error: 'Not found' });
    await db.query('BEGIN');
    await db.query('DELETE FROM note_tags WHERE note_id=$1', [noteId]);
    for (const tag of tags) await db.query('INSERT INTO note_tags (note_id, user_id, tag) VALUES ($1,$2,$3)', [noteId, req.user.id, tag]);
    await db.query('COMMIT');
    noteEmbeddings.queueEmbed(req.user.id, noteId);
    res.json({ id: noteId, tags });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    getLogger().error({ err }, '[notes set tags]');
    res.status(500).json({ error: 'Could not save the tags. Try again.' });
  } finally {
    db.release();
  }
});

// PUT /api/notes/:id/reminder  { remindAt: ISO instant | null, email?: boolean, repeat?: 'none'|'daily'|'weekdays'|'weekly'|'fortnightly'|'monthly'|'yearly', tz?: IANA zone }
// Set, change (snooze) or clear (null) the note's reminder. `repeat` (with the person's `tz`, so the time of day holds across daylight saving) makes it come round again;
// leaving `repeat` out keeps whatever the note had. A new time starts afresh: not emailed yet, not done. Like pinning and tags this is
// filing, not editing, so updated_at is left alone.
router.put('/:id/reminder', async (req, res) => {
  const noteId = Number(req.params.id) || 0;
  try {
    let result;
    if (req.body?.remindAt === null) {
      result = await pool.query(
        `UPDATE notes SET remind_at=NULL, remind_email=FALSE, reminder_sent_at=NULL, reminder_done_at=NULL, remind_repeat='none', remind_tz=NULL, remind_day=NULL
          WHERE id=$1 AND user_id=$2 RETURNING id, remind_at, remind_email, remind_repeat, reminder_done_at`, [noteId, req.user.id]);
    } else {
      const when = noteReminders.parseRemindAt(req.body?.remindAt);
      let repeat = 'none';
      let tz = noteRepeat.cleanZone(req.body?.tz);
      if (req.body?.repeat === undefined) {
        // an older screen that does not know about repeating: keep what the note has
        const cur = (await pool.query('SELECT remind_repeat, remind_tz FROM notes WHERE id=$1 AND user_id=$2', [noteId, req.user.id])).rows[0];
        if (cur) { repeat = cur.remind_repeat || 'none'; tz = noteRepeat.cleanZone(cur.remind_tz); }
      } else {
        repeat = noteRepeat.parseRepeat(req.body.repeat);
        if (!repeat) return res.status(400).json({ error: 'Pick how often it repeats from the list.' });
      }
      const day = repeat === 'none' ? null : noteRepeat.dayOfMonth(when, tz);
      result = await pool.query(
        `UPDATE notes SET remind_at=$3, remind_email=$4, reminder_sent_at=NULL, reminder_done_at=NULL, remind_repeat=$5, remind_tz=$6, remind_day=$7
          WHERE id=$1 AND user_id=$2 RETURNING id, remind_at, remind_email, remind_repeat, reminder_done_at`,
        [noteId, req.user.id, when.toISOString(), req.body?.email === true, repeat, repeat === 'none' ? null : tz, day]);
    }
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err instanceof noteReminders.ReminderError) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err }, '[notes reminder]');
    res.status(500).json({ error: 'Could not save the reminder. Try again.' });
  }
});

// POST /api/notes/:id/reminder/done  — mark the reminder done: it leaves "Reminders due" and is never emailed.
// A reminder that repeats is done for this time only: it moves on to its next time (`advanced: true`) and stays set until it is removed.
router.post('/:id/reminder/done', async (req, res) => {
  try {
    const noteId = Number(req.params.id) || 0;
    const cur = (await pool.query('SELECT remind_at, remind_repeat, remind_tz, remind_day FROM notes WHERE id=$1 AND user_id=$2 AND remind_at IS NOT NULL', [noteId, req.user.id])).rows[0];
    if (cur && cur.remind_repeat && cur.remind_repeat !== 'none') {
      const next = noteRepeat.nextOccurrence(cur.remind_at, cur.remind_repeat, cur.remind_tz, cur.remind_day, new Date());
      if (next) {
        const moved = await pool.query(
          `UPDATE notes SET remind_at=$3, reminder_sent_at=NULL, reminder_done_at=NULL WHERE id=$1 AND user_id=$2
            RETURNING id, remind_at, remind_email, remind_repeat, reminder_done_at`, [noteId, req.user.id, next.toISOString()]);
        return res.json({ ...moved.rows[0], advanced: true });
      }
    }
    const { rows } = await pool.query(
      `UPDATE notes SET reminder_done_at=NOW() WHERE id=$1 AND user_id=$2 AND remind_at IS NOT NULL
        RETURNING id, remind_at, remind_email, remind_repeat, reminder_done_at`, [noteId, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes reminder done]');
    res.status(500).json({ error: 'Could not mark the reminder done. Try again.' });
  }
});

// PATCH /api/notes/:id/pin  { pinned: true|false } — pinned notes sort to the top of the list. Does not touch updated_at.
router.patch('/:id/pin', async (req, res) => {
  if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ error: 'pinned must be true or false' });
  try {
    const { rows } = await pool.query(
      `UPDATE notes SET pinned_at = ${req.body.pinned ? 'NOW()' : 'NULL'} WHERE id=$1 AND user_id=$2 RETURNING id, pinned_at`,
      [Number(req.params.id) || 0, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes pin]');
    res.status(500).json({ error: 'Could not pin the note. Try again.' });
  }
});

// POST /api/notes/:id/ai  { action: 'summary'|'todos'|'tidy'|'title', today?: 'YYYY-MM-DD' }
// Reads the SAVED note (the screen saves first), returns a proposal and changes nothing. Behind the AI rate limit.
router.post('/:id/ai', aiLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT title, body FROM notes WHERE id=$1 AND user_id=$2', [Number(req.params.id) || 0, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    // Tag suggestions lean on the tags the person already uses, so they do not end up with "budget", "budgets" and "money".
    const existingTags = req.body?.action === 'tags'
      ? (await pool.query('SELECT tag FROM note_tags WHERE user_id=$1 GROUP BY tag ORDER BY COUNT(*) DESC, tag LIMIT 100', [req.user.id])).rows.map((r) => r.tag)
      : [];
    const result = await noteAi.runNoteAction(req.user.id, req.body?.action, { title: rows[0].title, body: rows[0].body, today: req.body?.today, existingTags });
    res.json({ action: req.body.action, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    getLogger().error({ err }, '[notes ai]');
    res.status(500).json({ error: 'The AI could not do that just now. Try again.' });
  }
});

// DELETE /api/notes/:id  — to the recycle bin: restorable for 30 days (Settings -> Recycle bin, or Notes -> Recently deleted)
router.delete('/:id', async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      `SELECT id, title, body, project_id, client_id, source, pinned_at, created_at, updated_at,
              remind_at, remind_email, reminder_sent_at, reminder_done_at, remind_repeat, remind_tz, remind_day
         FROM notes WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [Number(req.params.id) || 0, req.user.id]
    );
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const note = rows[0];
    const tags = (await db.query('SELECT tag FROM note_tags WHERE note_id=$1 ORDER BY tag', [note.id])).rows.map((r) => r.tag);
    // The files stay on disk and in `attachments` while the note waits in the bin; the bin remembers which they are so a restore reconnects them.
    const attachmentIds = (await db.query(`SELECT id FROM attachments WHERE "entityType"='note' AND "entityId"=$1 ORDER BY id`, [note.id])).rows.map((r) => r.id);
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'note', id: note.id, title: note.title,
      detail: String(note.body || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
      payload: { note, tags, attachmentIds },
    });
    await db.query('DELETE FROM notes WHERE id=$1 AND user_id=$2', [note.id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    getLogger().error({ err }, '[notes delete]');
    res.status(500).json({ error: 'Could not delete the note. Try again.' });
  } finally {
    db.release();
  }
});

module.exports = router;
