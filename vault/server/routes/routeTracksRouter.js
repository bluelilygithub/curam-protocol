'use strict';

// Route Tracer: each signed-in user's saved tracks (a traced path as a GeoJSON MultiLineString). Mounted at /api/route-tracks behind
// requireFeature('routeTracer') (server/index.js). Takes the pool as an argument so routeTracks.test.js runs without a database.
// The server recomputes distance, point count and bbox from the geometry and ignores any such numbers the client sends.
// Every query filters by "userId". Docs: docs/route-tracer.md.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const geo = require('../services/routeTracerGeo');

const MAX_NAME = 120;
const MAX_NOTES = 2000;
const MAX_BODY_BYTES = 1024 * 1024; // the global JSON limit is far higher; long freehand tracks are still bounded here
const MAX_TRACKS_PER_USER = 1000;
const MAX_BULK_DELETE = 200;
const DEFAULT_COLOR = '#E4572E';
const SUMMARY = `id, name, color, "distanceM", "pointCount", bbox, "drawMode", "createdAt"`;
const FULL = `${SUMMARY}, notes, geometry, "updatedAt"`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const n = raw.trim().replace(/\s+/g, ' ');
  return n ? n.slice(0, MAX_NAME) : null;
};

const iso = (d) => new Date(d).toISOString();
const summaryWire = (r) => ({
  id: r.id, name: r.name, color: r.color, distanceM: Number(r.distanceM), pointCount: Number(r.pointCount),
  bbox: r.bbox.map(Number), drawMode: r.drawMode, createdAt: iso(r.createdAt),
});
const fullWire = (r) => ({ ...summaryWire(r), notes: r.notes ?? null, geometry: r.geometry, updatedAt: iso(r.updatedAt) });

/** Reject a body over 1 MB before looking at it. */
function limitBody(req, res, next) {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return res.status(413).json({ error: 'That track is too large to save (over 1 MB).' });
  return next();
}

/** Validate the fields a create/update may carry. Returns { error } or { value } (only the fields present). */
function parseFields(body, { create }) {
  const b = body && typeof body === 'object' ? body : {};
  const v = {};
  if (create || b.name !== undefined) {
    v.name = cleanName(b.name);
    if (!v.name) return { error: 'A track name is required.' };
  }
  if (b.notes !== undefined) {
    if (b.notes !== null && typeof b.notes !== 'string') return { error: 'Notes must be text.' };
    const n = b.notes == null ? '' : b.notes.trim();
    if (n.length > MAX_NOTES) return { error: `Notes can be at most ${MAX_NOTES} characters.` };
    v.notes = n || null;
  }
  if (b.color !== undefined) {
    if (typeof b.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(b.color)) return { error: 'The colour must look like #E4572E.' };
    v.color = b.color.toUpperCase();
  } else if (create) v.color = DEFAULT_COLOR;
  if (create || b.drawMode !== undefined) {
    if (b.drawMode !== 'freehand' && b.drawMode !== 'click') return { error: 'The draw mode must be freehand or click.' };
    v.drawMode = b.drawMode;
  }
  if (create || b.geometry !== undefined) {
    const problem = geo.validateGeometry(b.geometry);
    if (problem) return { error: problem };
    v.lines = geo.cleanLines(b.geometry);
  }
  return { value: v };
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const encodeCursor = (createdAt, id) => Buffer.from(`${iso(createdAt)}|${id}`).toString('base64url');
function decodeCursor(c) {
  try {
    const [t, id] = Buffer.from(String(c), 'base64url').toString('utf8').split('|');
    if (!t || Number.isNaN(new Date(t).getTime()) || !UUID.test(id)) return null;
    return { t: new Date(t).toISOString(), id };
  } catch { return null; }
}

function createRouter(pool, { getMapKey = () => process.env.ROUTE_TRACER_MAPTILER_KEY || process.env.MAPTILER_API_KEY || null } = {}) {
  const router = express.Router();

  // GET /api/route-tracks/config: the browser-side MapTiler key. Prefer a separate key restricted by referrer to the Vault domain and localhost
  // (ROUTE_TRACER_MAPTILER_KEY); falls back to MAPTILER_API_KEY, which then becomes visible in the browser.
  router.get('/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ maptilerKey: getMapKey() });
  });

  // GET /api/route-tracks?q=&limit=&cursor=: newest first, no geometry.
  router.get('/', async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    const params = [req.user.id];
    let where = `"userId" = $1`;
    if (q) { params.push(`%${likeEscape(q)}%`); where += ` AND name ILIKE $${params.length} ESCAPE '\\'`; }
    if (req.query.cursor) {
      const c = decodeCursor(req.query.cursor);
      if (!c) return res.status(400).json({ error: 'The page marker is not valid.' });
      params.push(c.t, c.id);
      where += ` AND ("createdAt", id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
    }
    params.push(limit + 1);
    try {
      const { rows } = await pool.query(
        `SELECT ${SUMMARY} FROM route_tracks WHERE ${where} ORDER BY "createdAt" DESC, id DESC LIMIT $${params.length}`,
        params,
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      res.json({ tracks: page.map(summaryWire), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null });
    } catch (err) {
      getLogger().error({ err }, 'route tracks list failed');
      res.status(500).json({ error: 'Could not load your tracks.' });
    }
  });

  // POST /api/route-tracks/delete { ids }: the list's multi-select. Only the caller's own tracks match; answers how many were deleted.
  router.post('/delete', async (req, res) => {
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!raw.length) return res.status(400).json({ error: 'Pick at least one track.' });
    if (raw.length > MAX_BULK_DELETE) return res.status(400).json({ error: `Delete at most ${MAX_BULK_DELETE} tracks at a time.` });
    if (!raw.every((id) => typeof id === 'string' && UUID.test(id))) return res.status(400).json({ error: 'A track id is not valid.' });
    try {
      const { rowCount } = await pool.query(`DELETE FROM route_tracks WHERE id = ANY($1::uuid[]) AND "userId" = $2`, [[...new Set(raw)], req.user.id]);
      res.json({ ok: true, deleted: rowCount });
    } catch (err) {
      getLogger().error({ err }, 'route tracks bulk delete failed');
      res.status(500).json({ error: 'Could not delete those tracks.' });
    }
  });

  // GET /api/route-tracks/:id/gpx (before /:id)
  router.get('/:id/gpx', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'That track was not found.' });
    try {
      const { rows } = await pool.query(`SELECT name, notes, geometry FROM route_tracks WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!rows[0]) return res.status(404).json({ error: 'That track was not found.' });
      const file = `${rows[0].name.replace(/[^\w\- .]+/g, '_').trim() || 'track'}.gpx`;
      res.set({
        'Content-Type': 'application/gpx+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(geo.toGpx(rows[0].name, rows[0].notes, rows[0].geometry.coordinates));
    } catch (err) {
      getLogger().error({ err }, 'route track gpx failed');
      res.status(500).json({ error: 'Could not export this track.' });
    }
  });

  router.get('/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'That track was not found.' });
    try {
      const { rows } = await pool.query(`SELECT ${FULL} FROM route_tracks WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!rows[0]) return res.status(404).json({ error: 'That track was not found.' });
      res.json({ track: fullWire(rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'route track load failed');
      res.status(500).json({ error: 'Could not open this track.' });
    }
  });

  router.post('/', limitBody, async (req, res) => {
    const parsed = parseFields(req.body, { create: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value;
    const geometry = { type: 'MultiLineString', coordinates: v.lines };
    try {
      const count = await pool.query(`SELECT COUNT(*) AS n FROM route_tracks WHERE "userId" = $1`, [req.user.id]);
      if (Number(count.rows[0]?.n ?? 0) >= MAX_TRACKS_PER_USER) {
        return res.status(400).json({ error: `You have reached the limit of ${MAX_TRACKS_PER_USER} tracks. Delete some to add more.` });
      }
      const { rows } = await pool.query(
        `INSERT INTO route_tracks ("userId", name, notes, color, geometry, "distanceM", "pointCount", bbox, "drawMode", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, date_trunc('milliseconds', NOW()), date_trunc('milliseconds', NOW()))
         RETURNING ${FULL}`,
        [req.user.id, v.name, v.notes ?? null, v.color, JSON.stringify(geometry), geo.distanceM(v.lines), v.lines.reduce((n, l) => n + l.length, 0), geo.bboxOf(v.lines), v.drawMode],
      );
      res.status(201).json({ track: fullWire(rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'route track create failed');
      res.status(500).json({ error: 'Could not save this track.' });
    }
  });

  router.patch('/:id', limitBody, async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'That track was not found.' });
    const parsed = parseFields(req.body, { create: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value;
    const hasGeo = !!v.lines;
    try {
      const { rows } = await pool.query(
        `UPDATE route_tracks SET
           name = COALESCE($1, name),
           notes = CASE WHEN $2::boolean THEN $3 ELSE notes END,
           color = COALESCE($4, color),
           geometry = COALESCE($5::jsonb, geometry),
           "distanceM" = COALESCE($6, "distanceM"),
           "pointCount" = COALESCE($7, "pointCount"),
           bbox = COALESCE($8, bbox),
           "updatedAt" = date_trunc('milliseconds', NOW())
         WHERE id = $9 AND "userId" = $10
         RETURNING ${FULL}`,
        [
          v.name ?? null, 'notes' in v, v.notes ?? null, v.color ?? null,
          hasGeo ? JSON.stringify({ type: 'MultiLineString', coordinates: v.lines }) : null,
          hasGeo ? geo.distanceM(v.lines) : null,
          hasGeo ? v.lines.reduce((n, l) => n + l.length, 0) : null,
          hasGeo ? geo.bboxOf(v.lines) : null,
          req.params.id, req.user.id,
        ],
      );
      if (!rows[0]) return res.status(404).json({ error: 'That track was not found.' });
      res.json({ track: fullWire(rows[0]) });
    } catch (err) {
      getLogger().error({ err }, 'route track update failed');
      res.status(500).json({ error: 'Could not save this track.' });
    }
  });

  router.delete('/:id', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'That track was not found.' });
    try {
      const { rowCount } = await pool.query(`DELETE FROM route_tracks WHERE id = $1 AND "userId" = $2`, [req.params.id, req.user.id]);
      if (!rowCount) return res.status(404).json({ error: 'That track was not found.' });
      res.status(204).end();
    } catch (err) {
      getLogger().error({ err }, 'route track delete failed');
      res.status(500).json({ error: 'Could not delete this track.' });
    }
  });

  return router;
}

module.exports = { createRouter, parseFields, MAX_BODY_BYTES, MAX_TRACKS_PER_USER };
