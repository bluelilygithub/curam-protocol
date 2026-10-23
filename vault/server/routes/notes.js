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

// A recording is held in memory only while it is turned into text; it is never written anywhere that outlives the request.
const MAX_RECORDING_BYTES = 60 * 1024 * 1024;
const MAX_SPEECH_BYTES = 18 * 1024 * 1024; // the speech track Gemini is sent (about 75 minutes)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RECORDING_BYTES } });

const LIST_DEFAULT = 100;
const LIST_MAX = 300;
const DATE_COLUMNS = { updated: 'n.updated_at', created: 'n.created_at' };

// GET /api/notes  — a light list: no full body, just a short `preview`. The editor loads one note in full with GET /:id.
//   ?q=search (title, text, project and client name)  &project_id=N  &client_id=N  &unfiled=1 (no project and no client)
//   &from=ISO&to=ISO (to is exclusive)  &field=updated|created (which date from/to apply to; also the sort)
//   &limit=N (default 100, max 300)  &offset=N   — header X-Has-More: 1 when there are more after this page.
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const { q, project_id, client_id, unfiled, from, to } = req.query;
  const dateCol = DATE_COLUMNS[req.query.field] || DATE_COLUMNS.updated;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || LIST_DEFAULT, 1), LIST_MAX);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = ['n.user_id=$1'];
  const params = [userId];
  const add = (value) => { params.push(value); return `$${params.length}`; };

  if (project_id) where.push(`n.project_id=${add(Number(project_id) || 0)}`);
  if (client_id) where.push(`n.client_id=${add(Number(client_id) || 0)}`);
  if (unfiled === '1') where.push('n.project_id IS NULL AND n.client_id IS NULL');
  for (const [value, op, label] of [[from, '>=', 'from'], [to, '<', 'to']]) {
    if (!value) continue;
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: `${label} is not a valid date` });
    where.push(`${dateCol} ${op} ${add(when.toISOString())}`);
  }
  if (q) {
    // % and _ typed by the person are text, not wildcards
    const term = add(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(n.title ILIKE ${term} OR n.body ILIKE ${term} OR p.name ILIKE ${term} OR c.name ILIKE ${term})`);
  }

  const sql = `
    SELECT n.id, n.title, left(n.body, 240) AS preview, n.project_id, n.client_id, n.source,
           n.created_at, n.updated_at, p.name AS project_name, c.name AS client_name
      FROM notes n
      LEFT JOIN projects p ON p.id = n.project_id AND p."userId" = n.user_id
      LEFT JOIN clients  c ON c.id = n.client_id AND c."userId" = n.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${dateCol} DESC, n.id DESC
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
      `SELECT n.*, p.name AS project_name, c.name AS client_name
         FROM notes n
         LEFT JOIN projects p ON p.id = n.project_id AND p."userId" = n.user_id
         LEFT JOIN clients  c ON c.id = n.client_id AND c."userId" = n.user_id
        WHERE n.id=$1 AND n.user_id=$2`,
      [Number(req.params.id) || 0, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
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
    res.json(updated[0]);
  } catch (err) {
    getLogger().error({ err }, '[notes update]');
    res.status(500).json({ error: 'Could not save the note. Try again.' });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM notes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    getLogger().error({ err }, '[notes delete]');
    res.status(500).json({ error: 'Could not delete the note. Try again.' });
  }
});

module.exports = router;
