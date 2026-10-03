'use strict';

// Room Planner project library (Spec Addition / M5 projects): each signed-in user's saved projects. A project is the planner's
// whole project JSON (all its rooms, furniture, saved 3D views) in one JSONB column; the list endpoint never sends it. Every query
// filters by "userId". Saves can carry `expectedUpdatedAt`: if the project was saved elsewhere since, the answer is 409 with the
// current entry, so two windows never silently overwrite each other. Docs: docs/room-planner.md.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');

const MAX_NAME = 120;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PROJECTS_PER_USER = 200;
const COLS = `id, name, "roomCount", "updatedAt"`;

/** The name column is what the library shows; trimmed, collapsed spaces, never blank. */
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return n ? n.slice(0, MAX_NAME) : null;
}

/** The planner's own file format (schemaVersion 1) — the same minimum its loader requires. */
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'The project data is missing.';
  if (data.schemaVersion !== 1) return 'This project file is from a version the library does not understand.';
  if (typeof data.id !== 'string' || !Array.isArray(data.rooms) || !Array.isArray(data.furnitureDefinitions) || !Array.isArray(data.materials)) {
    return 'The project data is incomplete.';
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BYTES) return 'This project is too large to save (over 5 MB).';
  return null;
}

const toWire = (r) => ({ id: r.id, name: r.name, roomCount: Number(r.roomCount), updatedAt: new Date(r.updatedAt).toISOString() });
const validId = (id) => /^\d{1,10}$/.test(String(id));

function createRouter(pool) {
  const router = express.Router();

  // GET /api/room-projects — the caller's projects, newest first, without the project data.
  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM room_projects WHERE "userId" = $1 ORDER BY "updatedAt" DESC, id DESC`,
        [req.user.id],
      );
      res.json({ projects: rows.map(toWire) });
    } catch (err) {
      getLogger().error({ err }, 'room projects list failed');
      res.status(500).json({ error: 'Could not load your projects.' });
    }
  });

  // GET /api/room-projects/:id — one project with its data.
  router.get('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That project was not found.' });
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS}, data FROM room_projects WHERE id = $1 AND "userId" = $2`,
        [req.params.id, req.user.id],
      );
      if (!rows[0]) return res.status(404).json({ error: 'That project was not found.' });
      res.json({ project: { ...toWire(rows[0]), data: rows[0].data } });
    } catch (err) {
      getLogger().error({ err }, 'room project load failed');
      res.status(500).json({ error: 'Could not open this project.' });
    }
  });

  // POST /api/room-projects — { name, data } → a new project.
  router.post('/', async (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'A project name is required.' });
    const problem = validateData(req.body?.data);
    if (problem) return res.status(400).json({ error: problem });
    try {
      const count = await pool.query(`SELECT COUNT(*) AS n FROM room_projects WHERE "userId" = $1`, [req.user.id]);
      if (Number(count.rows[0]?.n ?? 0) >= MAX_PROJECTS_PER_USER) {
        return res.status(400).json({ error: `You have reached the limit of ${MAX_PROJECTS_PER_USER} projects. Delete some to add more.` });
      }
      const { rows } = await pool.query(
        `INSERT INTO room_projects ("userId", name, data, "roomCount", "updatedAt")
         VALUES ($1, $2, $3, $4, date_trunc('milliseconds', NOW()))
         RETURNING ${COLS}`,
        [req.user.id, name, JSON.stringify(req.body.data), req.body.data.rooms.length],
      );
      res.json({ project: toWire(rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'room project create failed');
      res.status(500).json({ error: 'Could not save this project.' });
    }
  });

  // PUT /api/room-projects/:id — { name?, data?, expectedUpdatedAt? } → saves over it. 409 + { current } if it changed elsewhere.
  router.put('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That project was not found.' });
    const body = req.body || {};
    const name = body.name === undefined ? null : cleanName(body.name);
    if (body.name !== undefined && !name) return res.status(400).json({ error: 'A project name is required.' });
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
    try {
      const { rows } = await pool.query(
        `UPDATE room_projects
         SET name = COALESCE($1, name),
             data = COALESCE($2::jsonb, data),
             "roomCount" = COALESCE($3, "roomCount"),
             "updatedAt" = date_trunc('milliseconds', NOW())
         WHERE id = $4 AND "userId" = $5
           AND ($6::timestamptz IS NULL OR date_trunc('milliseconds', "updatedAt") = $6::timestamptz)
         RETURNING ${COLS}`,
        [
          name, body.data === undefined ? null : JSON.stringify(body.data), body.data === undefined ? null : body.data.rooms.length,
          req.params.id, req.user.id, expected,
        ],
      );
      if (rows[0]) return res.json({ project: toWire(rows[0]) });
      // Nothing updated: either it is not this user's / not there (404) or it was saved elsewhere since (409).
      const current = await pool.query(`SELECT ${COLS} FROM room_projects WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'That project was not found.' });
      return res.status(409).json({ error: 'This project was changed in another window or tab.', current: toWire(current.rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'room project save failed');
      res.status(500).json({ error: 'Could not save this project.' });
    }
  });

  // DELETE /api/room-projects/:id
  router.delete('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That project was not found.' });
    try {
      const { rowCount } = await pool.query(`DELETE FROM room_projects WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: 'That project was not found.' });
      res.json({ ok: true });
    } catch (err) {
      getLogger().error({ err }, 'room project delete failed');
      res.status(500).json({ error: 'Could not delete this project.' });
    }
  });

  return router;
}

module.exports = { createRouter, validateData, cleanName, MAX_PROJECTS_PER_USER, MAX_BYTES, MAX_NAME };
