'use strict';

// Cellar Planner design library: each signed-in user's saved glass-enclosure designs. Same design as Garden Planner's (gardenProjectsRouter.js) and
// Room Planner's: a design is the planner's whole project JSON in one JSONB column; the list endpoint never sends it. Every query filters by
// "userId". Saves can carry `expectedUpdatedAt`: if the design was saved elsewhere since, the answer is 409 with the current entry, so two windows
// never silently overwrite each other. There are no pictures to store apart. Docs: docs/cellar-planner.md.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');

const MAX_NAME = 120;
const MAX_BYTES = 2 * 1024 * 1024; // a design is small: an enclosure, a rack spec, a few runs
const MAX_PROJECTS_PER_USER = 200;
const COLS = `id, name, "runCount", "rackUnits", estimated, "updatedAt"`;

/** The name column is what the library shows; trimmed, collapsed spaces, never blank. */
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return n ? n.slice(0, MAX_NAME) : null;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The planner's own file format (schemaVersion 1): the same minimum its loader requires. */
function validateData(data) {
  if (!isObj(data)) return 'The design data is missing.';
  if (data.schemaVersion !== 1) return 'This design file is from a version the library does not understand.';
  if (!isObj(data.enclosure) || !isObj(data.enclosure.walls) || !isObj(data.enclosure.door) || !Array.isArray(data.runs) || !isObj(data.rackSpec)) {
    return 'The design data is incomplete.';
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_BYTES) return 'This design is too large to save (over 2 MB).';
  return null;
}

/** What the list shows about a design, worked out here from its data (the engine that counts bottles lives in the browser). */
const runCountOf = (data) => data.runs.length;
const rackUnitsOf = (data) => data.runs.reduce((n, r) => n + (Number.isFinite(r?.units) && r.units > 0 ? Math.floor(r.units) : 0), 0);
const estimatedOf = (data) => Array.isArray(data.estimated) && data.estimated.length > 0;

const toWire = (r) => ({ id: r.id, name: r.name, runCount: Number(r.runCount), rackUnits: Number(r.rackUnits), estimated: !!r.estimated, updatedAt: new Date(r.updatedAt).toISOString() });
const validId = (id) => /^\d{1,10}$/.test(String(id));

function createRouter(pool) {
  const router = express.Router();

  // GET /api/cellar-projects: the caller's designs, newest first, without the design data.
  router.get('/', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS} FROM cellar_projects WHERE "userId" = $1 ORDER BY "updatedAt" DESC, id DESC`,
        [req.user.id],
      );
      res.json({ projects: rows.map(toWire) });
    } catch (err) {
      getLogger().error({ err }, 'cellar projects list failed');
      res.status(500).json({ error: 'Could not load your designs.' });
    }
  });

  // GET /api/cellar-projects/:id: one design with its data.
  router.get('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That design was not found.' });
    try {
      const { rows } = await pool.query(
        `SELECT ${COLS}, data FROM cellar_projects WHERE id = $1 AND "userId" = $2`,
        [req.params.id, req.user.id],
      );
      if (!rows[0]) return res.status(404).json({ error: 'That design was not found.' });
      res.json({ project: { ...toWire(rows[0]), data: rows[0].data } });
    } catch (err) {
      getLogger().error({ err }, 'cellar project load failed');
      res.status(500).json({ error: 'Could not open this design.' });
    }
  });

  // POST /api/cellar-projects: { name, data } makes a new design.
  router.post('/', async (req, res) => {
    const name = cleanName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'A design name is required.' });
    const problem = validateData(req.body?.data);
    if (problem) return res.status(400).json({ error: problem });
    try {
      const count = await pool.query(`SELECT COUNT(*) AS n FROM cellar_projects WHERE "userId" = $1`, [req.user.id]);
      if (Number(count.rows[0]?.n ?? 0) >= MAX_PROJECTS_PER_USER) {
        return res.status(400).json({ error: `You have reached the limit of ${MAX_PROJECTS_PER_USER} designs. Delete some to add more.` });
      }
      const d = req.body.data;
      const { rows } = await pool.query(
        `INSERT INTO cellar_projects ("userId", name, data, "runCount", "rackUnits", estimated, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, date_trunc('milliseconds', NOW()))
         RETURNING ${COLS}`,
        [req.user.id, name, JSON.stringify(d), runCountOf(d), rackUnitsOf(d), estimatedOf(d)],
      );
      res.json({ project: toWire(rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'cellar project create failed');
      res.status(500).json({ error: 'Could not save this design.' });
    }
  });

  // PUT /api/cellar-projects/:id: { name?, data?, expectedUpdatedAt? } saves over it. 409 + { current } if it changed elsewhere.
  router.put('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That design was not found.' });
    const body = req.body || {};
    const name = body.name === undefined ? null : cleanName(body.name);
    if (body.name !== undefined && !name) return res.status(400).json({ error: 'A design name is required.' });
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
        `UPDATE cellar_projects
         SET name = COALESCE($1, name),
             data = COALESCE($2::jsonb, data),
             "runCount" = COALESCE($3, "runCount"),
             "rackUnits" = COALESCE($4, "rackUnits"),
             estimated = COALESCE($5, estimated),
             "updatedAt" = date_trunc('milliseconds', NOW())
         WHERE id = $6 AND "userId" = $7
           AND ($8::timestamptz IS NULL OR date_trunc('milliseconds', "updatedAt") = $8::timestamptz)
         RETURNING ${COLS}`,
        [
          name, hasData ? JSON.stringify(body.data) : null, hasData ? runCountOf(body.data) : null, hasData ? rackUnitsOf(body.data) : null,
          hasData ? estimatedOf(body.data) : null, req.params.id, req.user.id, expected,
        ],
      );
      if (rows[0]) return res.json({ project: toWire(rows[0]) });
      // Nothing updated: either it is not this user's / not there (404) or it was saved elsewhere since (409).
      const current = await pool.query(`SELECT ${COLS} FROM cellar_projects WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'That design was not found.' });
      return res.status(409).json({ error: 'This design was changed in another window or tab.', current: toWire(current.rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'cellar project save failed');
      res.status(500).json({ error: 'Could not save this design.' });
    }
  });

  // DELETE /api/cellar-projects/:id
  router.delete('/:id', async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'That design was not found.' });
    try {
      const { rowCount } = await pool.query(`DELETE FROM cellar_projects WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: 'That design was not found.' });
      res.json({ ok: true });
    } catch (err) {
      getLogger().error({ err }, 'cellar project delete failed');
      res.status(500).json({ error: 'Could not delete this design.' });
    }
  });

  return router;
}

module.exports = { createRouter, validateData, cleanName, MAX_PROJECTS_PER_USER, MAX_BYTES, MAX_NAME };
