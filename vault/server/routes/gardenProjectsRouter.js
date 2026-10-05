'use strict';

// Garden Planner project library: each signed-in user's saved gardens. Same design as Room Planner's (roomProjectsRouter.js): a garden
// is the planner's whole project JSON in one JSONB column; the list endpoint never sends it. Every query filters by "userId". Saves can
// carry `expectedUpdatedAt`: if the garden was saved elsewhere since, the answer is 409 with the current entry, so two windows never
// silently overwrite each other. Docs: docs/garden-planner.md.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const images = require('../services/gardenImages');

const MAX_NAME = 120;
const MAX_LOCATION = 160;
const MAX_BYTES = 2 * 1024 * 1024; // the design only: tracing pictures are stored apart (garden_images) and referenced by underlay.imageId
const MAX_PROJECTS_PER_USER = 200;
const COLS = `id, name, "plantCount", location, "updatedAt"`;
const LIST_KEYS = ['zones', 'beds', 'paths', 'lawns', 'structures', 'plants'];

/** The name column is what the library shows; trimmed, collapsed spaces, never blank. */
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return n ? n.slice(0, MAX_NAME) : null;
}

/** The planner's own file format (schemaVersion 1): the same minimum its loader requires. */
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'The garden data is missing.';
  if (data.schemaVersion !== 1) return 'This garden file is from a version the library does not understand.';
  if (typeof data.id !== 'string' || !data.location || typeof data.location !== 'object' || LIST_KEYS.some((k) => !Array.isArray(data[k]))) {
    return 'The garden data is incomplete.';
  }
  if (data.underlay && typeof data.underlay === 'object' && 'dataUrl' in data.underlay) {
    return 'This garden embeds its tracing picture. Reload Garden Planner so the picture is stored separately, then save again.';
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BYTES) return 'This garden is too large to save (over 2 MB of design data).';
  return null;
}

const locationOf = (data) => (typeof data.location.label === 'string' ? data.location.label.slice(0, MAX_LOCATION) : '');
const toWire = (r) => ({ id: r.id, name: r.name, plantCount: Number(r.plantCount), location: r.location ?? '', updatedAt: new Date(r.updatedAt).toISOString() });
const validId = (id) => /^\d{1,10}$/.test(String(id));

function createRouter(pool) {
  const router = express.Router();

  // ---- tracing pictures (named routes before /:id). Raw bytes in, raw bytes out; the garden design only holds the reference.
  const rawImage = express.raw({ type: Object.keys(images.ALLOWED), limit: images.MAX_IMAGE_BYTES });

  // POST /api/garden-projects/images: body = the image bytes, Content-Type = its type. -> { image: { id: 'srv-12', mime, bytes } }
  router.post('/images', rawImage, async (req, res) => {
    const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return res.status(400).json({ error: 'Send the picture as JPEG, PNG or WebP.' });
    if (!images.looksLike(mime, bytes)) return res.status(400).json({ error: 'That file is not a JPEG, PNG or WebP picture.' });
    try {
      const count = await pool.query(`SELECT COUNT(*) AS n FROM garden_images WHERE "userId" = $1 AND "deletedAt" IS NULL`, [req.user.id]);
      if (Number(count.rows[0]?.n ?? 0) >= images.MAX_IMAGES_PER_USER) {
        return res.status(400).json({ error: `You have reached the limit of ${images.MAX_IMAGES_PER_USER} stored pictures. Remove a tracing picture from a garden to free one.` });
      }
      const { rows } = await pool.query(
        `INSERT INTO garden_images ("userId", mime, bytes, data) VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.user.id, mime, bytes.length, bytes],
      );
      res.json({ image: { id: images.imageRef(rows[0].id), mime, bytes: bytes.length } });
    } catch (err) {
      getLogger().error({ err }, 'garden image upload failed');
      res.status(500).json({ error: 'Could not store the picture.' });
    }
  });

  // GET /api/garden-projects/images/:ref (srv-12): the picture bytes. Private to the owner.
  router.get('/images/:ref', async (req, res) => {
    const m = /^srv-(\d{1,10})$/.exec(String(req.params.ref));
    if (!m) return res.status(404).json({ error: 'That picture was not found.' });
    try {
      const { rows } = await pool.query(`SELECT mime, data FROM garden_images WHERE id = $1 AND "userId" = $2`, [m[1], req.user.id]);
      if (!rows[0]) return res.status(404).json({ error: 'That picture was not found.' });
      res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      res.send(rows[0].data);
    } catch (err) {
      getLogger().error({ err }, 'garden image load failed');
      res.status(500).json({ error: 'Could not load the picture.' });
    }
  });

  // GET /api/garden-projects: the caller's gardens, newest first, without the garden data.
  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM garden_projects WHERE "userId" = $1 ORDER BY "updatedAt" DESC, id DESC`,
        [req.user.id],
      );
      res.json({ projects: rows.map(toWire) });
    } catch (err) {
      getLogger().error({ err }, 'garden projects list failed');
      res.status(500).json({ error: 'Could not load your gardens.' });
    }
  });

  // GET /api/garden-projects/:id: one garden with its data.
  router.get('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That garden was not found.' });
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS}, data FROM garden_projects WHERE id = $1 AND "userId" = $2`,
        [req.params.id, req.user.id],
      );
      if (!rows[0]) return res.status(404).json({ error: 'That garden was not found.' });
      res.json({ project: { ...toWire(rows[0]), data: rows[0].data } });
    } catch (err) {
      getLogger().error({ err }, 'garden project load failed');
      res.status(500).json({ error: 'Could not open this garden.' });
    }
  });

  // POST /api/garden-projects: { name, data } makes a new garden.
  router.post('/', async (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'A garden name is required.' });
    const problem = validateData(req.body?.data);
    if (problem) return res.status(400).json({ error: problem });
    try {
      const count = await pool.query(`SELECT COUNT(*) AS n FROM garden_projects WHERE "userId" = $1`, [req.user.id]);
      if (Number(count.rows[0]?.n ?? 0) >= MAX_PROJECTS_PER_USER) {
        return res.status(400).json({ error: `You have reached the limit of ${MAX_PROJECTS_PER_USER} gardens. Delete some to add more.` });
      }
      const { rows } = await pool.query(
        `INSERT INTO garden_projects ("userId", name, data, "plantCount", location, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, date_trunc('milliseconds', NOW()))
         RETURNING ${COLS}`,
        [req.user.id, name, JSON.stringify(req.body.data), req.body.data.plants.length, locationOf(req.body.data)],
      );
      res.json({ project: toWire(rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'garden project create failed');
      res.status(500).json({ error: 'Could not save this garden.' });
    }
  });

  // PUT /api/garden-projects/:id: { name?, data?, expectedUpdatedAt? } saves over it. 409 + { current } if it changed elsewhere.
  router.put('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That garden was not found.' });
    const body = req.body || {};
    const name = body.name === undefined ? null : cleanName(body.name);
    if (body.name !== undefined && !name) return res.status(400).json({ error: 'A garden name is required.' });
    if (body.data !== undefined) {
      const problem = validateData(body.data);
      if (problem) return res.status(400).json({ error: problem });
    }
    let expected = null;
    if (body.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== null) {
      const t = new Date(body.expectedUpdatedAt);
      if (Number.isNaN(t.getTime())) return res.status(400).json({ error: 'The saved-at time is not valid.' });
      expected = t.toISOString();
    }
    const hasData = body.data !== undefined;
    try {
      const { rows } = await pool.query(
        `UPDATE garden_projects
         SET name = COALESCE($1, name),
             data = COALESCE($2::jsonb, data),
             "plantCount" = COALESCE($3, "plantCount"),
             location = COALESCE($4, location),
             "updatedAt" = date_trunc('milliseconds', NOW())
         WHERE id = $5 AND "userId" = $6
           AND ($7::timestamptz IS NULL OR date_trunc('milliseconds', "updatedAt") = $7::timestamptz)
         RETURNING ${COLS}`,
        [
          name, hasData ? JSON.stringify(body.data) : null, hasData ? body.data.plants.length : null, hasData ? locationOf(body.data) : null,
          req.params.id, req.user.id, expected,
        ],
      );
      if (rows[0]) {
        if (hasData) await images.reconcileImages(pool, req.user.id, getLogger());
        return res.json({ project: toWire(rows[0]) });
      }
      // Nothing updated: either it is not this user's / not there (404) or it was saved elsewhere since (409).
      const current = await pool.query(`SELECT ${COLS} FROM garden_projects WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'That garden was not found.' });
      return res.status(409).json({ error: 'This garden was changed in another window or tab.', current: toWire(current.rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'garden project save failed');
      res.status(500).json({ error: 'Could not save this garden.' });
    }
  });

  // DELETE /api/garden-projects/:id
  router.delete('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That garden was not found.' });
    try {
      const { rowCount } = await pool.query(`DELETE FROM garden_projects WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: 'That garden was not found.' });
      await images.reconcileImages(pool, req.user.id, getLogger());
      res.json({ ok: true });
    } catch (err) {
      getLogger().error({ err }, 'garden project delete failed');
      res.status(500).json({ error: 'Could not delete this garden.' });
    }
  });

  return router;
}

module.exports = { createRouter, validateData, cleanName, MAX_PROJECTS_PER_USER, MAX_BYTES, MAX_NAME };
