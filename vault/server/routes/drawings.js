'use strict';

// Drawings: the person's saved Excalidraw scenes. Mounted at /api/drawings behind the `drawings` flag. Every query is by the signed-in
// person; a drawing that is not theirs is simply "not found". Delete goes into the shared recycle bin (30 days). See docs/drawings.md.
//
//   GET    /api/drawings               list (no scenes: id, title, preview, counts, dates)
//   POST   /api/drawings               new drawing  { title?, scene?, thumbnail? }
//   GET    /api/drawings/:id           one drawing with its scene
//   GET    /api/drawings/:id/notes     the person's notes that link back to the drawing (made by To Notes)
//   PUT    /api/drawings/:id           save  { title?, scene?, thumbnail?, look? ('sketch' | 'clean'), baseUpdatedAt? }  (409 if changed elsewhere since baseUpdatedAt)
//   POST   /api/drawings/diagram       Draw it for me  { text } or { previous, instruction } -> { diagram } (AI; structure only)
//   POST   /api/drawings/suggestions   What have I missed?  { diagram } -> { suggestions: [{ about, text, change }] } (AI; reads only the words in the shapes)
//   POST   /api/drawings/:id/duplicate a copy
//   DELETE /api/drawings/:id           into the recycle bin

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const drawings = require('../services/drawings');
const drawingDiagram = require('../services/drawingDiagram');
const { aiLimiter } = require('../middleware/aiRateLimit');

const router = express.Router();
const BIN_TYPE = 'drawing';
// a drawing's scene can be up to 6 MB (and JSON-escaped inside the snapshot a little more); the bin's default limit is 5 MB
const BIN_MAX_BYTES = 8 * 1024 * 1024;

function fail(res, err, where) {
  if (err instanceof drawings.DrawingError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  getLogger().error({ err }, `[drawings] ${where}`);
  return res.status(500).json({ error: 'Something went wrong with your diagrams. Try again.' });
}

const idOf = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

router.get('/', async (req, res) => {
  try {
    res.json({ drawings: await drawings.list(pool, req.user.id), max: drawings.MAX_DRAWINGS_PER_USER });
  } catch (err) { fail(res, err, 'list'); }
});

router.post('/', async (req, res) => {
  try {
    res.status(201).json({ drawing: await drawings.create(pool, req.user.id, req.body || {}) });
  } catch (err) { fail(res, err, 'create'); }
});

// "Draw it for me": a described scenario (or a change to the diagram made last time) in, the STRUCTURE of a diagram out (boxes, arrows,
// labels). The page lays it out and draws it. One AI request on the workspace's standard model, behind the AI rate limit; the model sees
// only the words sent here, never any drawing. See services/drawingDiagram.js.
router.post('/diagram', aiLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await drawingDiagram.askDiagram(req.user.id, { text: b.text, previous: b.previous, instruction: b.instruction }));
  } catch (err) {
    if (err instanceof drawings.DrawingError) return fail(res, err, 'diagram');
    getLogger().error({ err }, '[drawings] diagram model');
    return res.status(502).json({ error: 'The AI could not be reached just now. Try again in a minute.' });
  }
});

// "What have I missed?": the diagram as read from the drawing in, a short list of gaps out. One AI request, same limits as /diagram.
router.post('/suggestions', aiLimiter, async (req, res) => {
  try {
    res.json(await drawingDiagram.askSuggestions(req.user.id, { diagram: (req.body || {}).diagram }));
  } catch (err) {
    if (err instanceof drawings.DrawingError) return fail(res, err, 'suggestions');
    getLogger().error({ err }, '[drawings] suggestions model');
    return res.status(502).json({ error: 'The AI could not be reached just now. Try again in a minute.' });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    res.status(201).json({ drawing: await drawings.duplicate(pool, req.user.id, idOf(req)) });
  } catch (err) { fail(res, err, 'duplicate'); }
});

router.get('/:id', async (req, res) => {
  try {
    res.json({ drawing: await drawings.get(pool, req.user.id, idOf(req)) });
  } catch (err) { fail(res, err, 'get'); }
});

router.get('/:id/notes', async (req, res) => {
  try {
    res.json({ notes: await drawings.linkedNotes(pool, req.user.id, idOf(req)) });
  } catch (err) { fail(res, err, 'notes'); }
});

router.put('/:id', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ drawing: await drawings.update(pool, req.user.id, idOf(req), { title: b.title, scene: b.scene, thumbnail: b.thumbnail, look: b.look, baseUpdatedAt: b.baseUpdatedAt }) });
  } catch (err) { fail(res, err, 'update'); }
});

router.delete('/:id', async (req, res) => {
  const bin = require('../services/recycleBin');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM drawings WHERE id = $1 AND "userId" = $2 FOR UPDATE', [idOf(req), req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That diagram was not found.' }); }
    const d = rows[0];
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: BIN_TYPE, id: d.id, title: d.title,
      detail: `${d.elementCount} piece${d.elementCount === 1 ? '' : 's'}`,
      payload: { drawing: d }, maxBytes: BIN_MAX_BYTES,
    });
    await db.query('DELETE FROM drawings WHERE id = $1 AND "userId" = $2', [d.id, req.user.id]);
    await db.query('COMMIT');
    return res.json({ ok: true, binId });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    if (err && err.code === 'TOO_LARGE') return res.status(413).json({ error: 'This diagram is too big to keep in the recycle bin, so it was not deleted. Remove large pictures from it first, or export it as a file.' });
    return fail(res, err, 'delete');
  } finally { db.release(); }
});

module.exports = router;
