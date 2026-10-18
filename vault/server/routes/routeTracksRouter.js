'use strict';

// Route Tracer: each signed-in user's saved tracks (a traced path as a GeoJSON MultiLineString). Mounted at /api/route-tracks behind
// requireFeature('routeTracer') (server/index.js). Takes the pool as an argument so routeTracks.test.js runs without a database.
// The server recomputes distance, point count and bbox from the geometry and ignores any such numbers the client sends.
// Every query filters by "userId". Docs: docs/route-tracer.md.

const express = require('express');
const { getLogger } = require('../middleware/requestContext');
const geo = require('../services/routeTracerGeo');
const { createPlanner, PlanError, PROFILES, LOOP_MIN_KM, LOOP_MAX_KM, DETOUR_MIN_KM, DETOUR_MAX_KM } = require('../services/routePlanner');

const MAX_NAME = 120;
const MAX_NOTES = 2000;
const MAX_BODY_BYTES = 1024 * 1024; // the global JSON limit is far higher; long freehand tracks are still bounded here
const MAX_PDF_BYTES = 8 * 1024 * 1024; // an emailed map PDF
const MAX_EMAIL_BODY_BYTES = 12 * 1024 * 1024; // the PDF as base64 plus the rest
const EMAIL_RE = /^[^\s@,;<>()\[\]"'\\]{1,64}@[^\s@,;<>()\[\]"'\\]{1,200}\.[^\s@,;<>()\[\]"'\\]{2,}$/;
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
    if (!['freehand', 'click', 'import', 'route'].includes(b.drawMode)) return { error: 'The draw mode must be freehand, click, import or route.' };
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

function createRouter(pool, {
  getMapKey = () => process.env.ROUTE_TRACER_MAPTILER_KEY || process.env.MAPTILER_API_KEY || null,
  getOrsKey = () => process.env.ORS_API_KEY || null,
  fetchFn, now, planLimits = {},
  sendEmailFn = (...a) => require('../utils/sendEmail')(...a),
  emailConfigured = () => require('../utils/sendEmail').isConfigured(),
  emailLimits = {},
  // the plain-English ask box: (text, user) -> { intent, via }. The default uses the pattern parser and, only when that cannot, Vault's light model.
  understandFn = async (text, user) => {
    const intent = require('../services/routeIntent');
    return intent.understand(text, async (prompt, system) => {
      const { getModelsForUser } = require('../services/modelResolver');
      const { callModel } = require('../services/callModel');
      const { light } = await getModelsForUser(user.id);
      return callModel(light, prompt, { system, maxTokens: 200, timeoutMs: 20000 });
    });
  },
  needsAiFn = (text) => require('../services/routeIntent').needsAi(text),
  askLimits = {},
  // places near a route (OpenStreetMap through Overpass): { near({ line, radiusKm }) }
  placesService = require('../services/routePlaces').createPlacesService(),
  placesLimits = {},
} = {}) {
  const router = express.Router();
  const planner = createPlanner({ getKey: getOrsKey, fetchFn, now, log: (m, d) => getLogger().warn({ detail: d }, m), ...planLimits });

  // ---- emailing a map PDF. The PDF is made in the browser (only it has the map picture); the server's part is to send it, and to make sure this
  // cannot be used to send just anything to anyone: signed-in users only, ONE recipient, the attachment must really be a PDF under 8 MB, the
  // message is plain text (escaped), the subject and file name are cleaned, and each person has an hourly and a daily allowance.
  const emailHits = new Map(); // userId -> timestamps
  const emailNow = emailLimits.now ?? Date.now;
  const perHour = emailLimits.perHour ?? 10;
  const perDay = emailLimits.perDay ?? 30;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---- the ask box: "route from Morningside to Carindale" -> { kind, from, to, lengthKm, profile }. Only NAMES and numbers come back; the browser looks
  // the places up. A clear request is understood by pattern for free; only the rest uses the AI, and only those count against the allowance.
  const askHits = new Map();
  const askNow = askLimits.now ?? Date.now;
  const askPerHour = askLimits.perHour ?? 20;
  const askPerDay = askLimits.perDay ?? 100;

  // ---- places near a route: one Overpass question per route and distance (cached), so each person gets a modest allowance of NEW questions.
  const placesHits = new Map();
  const placesNow = placesLimits.now ?? Date.now;
  const placesPerHour = placesLimits.perHour ?? 20;
  const placesPerDay = placesLimits.perDay ?? 80;

  // GET /api/route-tracks/config: the browser-side MapTiler key. Prefer a separate key restricted by referrer to the Vault domain and localhost
  // (ROUTE_TRACER_MAPTILER_KEY); falls back to MAPTILER_API_KEY, which then becomes visible in the browser.
  router.get('/config', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let emailEnabled = false;
    try { emailEnabled = !!(await emailConfigured()); } catch { emailEnabled = false; }
    res.json({ maptilerKey: getMapKey(), routePlanning: !!getOrsKey(), isAdmin: !!req.user?.isAdmin, emailEnabled, planProfiles: Object.keys(PROFILES), loopKm: { min: LOOP_MIN_KM, max: LOOP_MAX_KM }, detourKm: { min: DETOUR_MIN_KM, max: DETOUR_MAX_KM } });
  });

  // GET /api/route-tracks/diagnose (owner only): one tiny routing request, to see whether the routing service answers from this server and how fast.
  router.get('/diagnose', async (req, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Only an administrator can run this check.' });
    res.set('Cache-Control', 'no-store');
    res.json(await planner.diagnose());
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

  // POST /api/route-tracks/plan { from: [lng, lat], to: [lng, lat], profile }: up to three routes between two points along real roads and paths.
  router.post('/plan', async (req, res) => {
    try {
      const r = await planner.plan(req.user.id, { from: req.body?.from, to: req.body?.to, profile: req.body?.profile });
      res.set('Cache-Control', 'no-store');
      res.json(r);
    } catch (err) {
      if (err instanceof PlanError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      }
      getLogger().error({ err }, 'route plan failed');
      res.status(500).json({ error: 'Could not plan that route.' });
    }
  });

  // POST /api/route-tracks/places { line: [[lng, lat], ...], radiusKm }: notable buildings, landmarks and venues within radiusKm of any point on the line.
  router.post('/places', async (req, res) => {
    const t = placesNow();
    const mine = (placesHits.get(req.user.id) || []).filter((x) => t - x < 86400000);
    if (mine.length >= placesPerDay) { res.set('Retry-After', '3600'); return res.status(429).json({ error: 'That is enough place searches for today. Try again tomorrow.' }); }
    if (mine.filter((x) => t - x < 3600000).length >= placesPerHour) { res.set('Retry-After', '600'); return res.status(429).json({ error: 'That is a lot of place searches in an hour. Wait a while and try again.' }); }
    try {
      const out = await placesService.near({ line: req.body?.line, radiusKm: req.body?.radiusKm });
      if (!out.cached) { mine.push(t); placesHits.set(req.user.id, mine); }
      getLogger().info({ places: out.places.length, routeKm: out.routeKm, radiusKm: out.radiusKm, cached: out.cached }, 'places near a route'); // never the route
      res.json({ places: out.places, counts: out.counts, truncated: out.truncated, radiusKm: out.radiusKm, routeKm: out.routeKm, categories: require('../services/routePlaces').CATEGORIES, attribution: '(c) OpenStreetMap contributors' });
    } catch (err) {
      if (err && typeof err.status === 'number' && err.name !== 'TypeError') return res.status(err.status).json({ error: err.message });
      getLogger().error({ err }, 'places near a route failed');
      res.status(502).json({ error: 'Places could not be found just now. Try again in a minute.' });
    }
  });

  // POST /api/route-tracks/ask { text }: understand one plain-English request for a route.
  router.post('/ask', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim() : '';
    if (!text) return res.status(400).json({ error: 'Say or type what route you want, for example: route from Morningside to Carindale.' });
    if (text.length > 300) return res.status(400).json({ error: 'That is a bit long. Keep it to a sentence, at most 300 characters.' });
    const t = askNow();
    const mine = (askHits.get(req.user.id) || []).filter((x) => t - x < 86400000);
    const usesAi = needsAiFn(text);
    if (usesAi) {
      if (mine.length >= askPerDay) { res.set('Retry-After', '3600'); return res.status(429).json({ error: 'That is enough questions for today. Try again tomorrow, or use "route from A to B".' }); }
      if (mine.filter((x) => t - x < 3600000).length >= askPerHour) { res.set('Retry-After', '600'); return res.status(429).json({ error: 'That is a lot of questions in an hour. Wait a while, or use "route from A to B".' }); }
    }
    try {
      const out = await understandFn(text, req.user);
      if (out.via === 'ai') { mine.push(t); askHits.set(req.user.id, mine); }
      getLogger().info({ via: out.via, kind: out.intent.kind }, 'route request understood'); // never the words
      res.json({ intent: out.intent, via: out.via });
    } catch (err) {
      getLogger().error({ err }, 'route request failed');
      res.status(502).json({ error: 'Could not work that out just now. Try "route from A to B", or use Plan route.' });
    }
  });

  // POST /api/route-tracks/email { to, subject?, message?, copyToMe?, filename, pdf (base64) }: email a map PDF made in the browser.
  router.post('/email', async (req, res) => {
    if (Number(req.headers['content-length'] || 0) > MAX_EMAIL_BODY_BYTES) return res.status(413).json({ error: 'That PDF is too large to email (over 8 MB).' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const to = typeof b.to === 'string' ? b.to.trim() : '';
    if (!to || to.length > 254 || !EMAIL_RE.test(to)) return res.status(400).json({ error: 'Enter one email address to send it to.' });
    const subject = (typeof b.subject === 'string' && b.subject.trim() ? b.subject : 'Route map').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 150);
    const message = typeof b.message === 'string' ? b.message.replace(/\r\n?/g, '\n').trim() : '';
    if (message.length > 2000) return res.status(400).json({ error: 'The message can be at most 2,000 characters.' });
    const base = (typeof b.filename === 'string' ? b.filename : 'route-map').replace(/\.pdf$/i, '').replace(/[^\w\-. ]+/g, '_').trim().slice(0, 80) || 'route-map';
    const raw = typeof b.pdf === 'string' ? b.pdf.replace(/^data:application\/pdf;base64,/, '') : '';
    if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return res.status(400).json({ error: 'The PDF is missing or damaged. Make it again.' });
    const pdf = Buffer.from(raw, 'base64');
    if (pdf.length > MAX_PDF_BYTES) return res.status(413).json({ error: 'That PDF is too large to email (over 8 MB).' });
    if (pdf.length < 100 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'That is not a PDF. Make it again.' });

    const t = emailNow();
    const mine = (emailHits.get(req.user.id) || []).filter((x) => t - x < 86400000);
    if (mine.length >= perDay) { res.set('Retry-After', '3600'); return res.status(429).json({ error: 'You have emailed enough maps today. Try again tomorrow.' }); }
    if (mine.filter((x) => t - x < 3600000).length >= perHour) { res.set('Retry-After', '600'); return res.status(429).json({ error: 'That is a lot of emails in an hour. Wait a while and try again.' }); }

    const cc = b.copyToMe === true && req.user.email && EMAIL_RE.test(req.user.email) && req.user.email.toLowerCase() !== to.toLowerCase() ? req.user.email : undefined;
    const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5">${message ? `<p>${esc(message).replace(/\n/g, '<br>')}</p>` : '<p>A route map is attached.</p>'}<p style="color:#666;font-size:12px">Sent from Route Tracer in Vault${req.user.email ? ` by ${esc(req.user.email)}` : ''}. The map is attached as a PDF. Map data \u00a9 OpenStreetMap contributors, \u00a9 MapTiler.</p></div>`;
    try {
      const out = await sendEmailFn({ to, cc, replyTo: req.user.email || undefined, subject, html, attachments: [{ filename: `${base}.pdf`, content: pdf, contentType: 'application/pdf' }] });
      if (out && out.skipped) return res.status(503).json({ error: 'Email is switched off on this server.' });
      mine.push(t);
      emailHits.set(req.user.id, mine);
      getLogger().info({ bytes: pdf.length, copied: !!cc }, 'route map emailed'); // never the address or the words
      res.json({ ok: true, copied: !!cc });
    } catch (err) {
      if (/not configured/i.test(String(err && err.message))) return res.status(503).json({ error: 'Email is not set up on this server yet.' });
      getLogger().error({ err }, 'route map email failed');
      res.status(502).json({ error: 'The email could not be sent. Try again in a moment.' });
    }
  });

  // POST /api/route-tracks/leg { from, to, profile }: the road or path between two clicks (Click mode with Follow roads on).
  router.post('/leg', async (req, res) => {
    try {
      const out = await planner.leg(req.user.id, { from: req.body?.from, to: req.body?.to, profile: req.body?.profile });
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (err) {
      if (err instanceof PlanError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      }
      getLogger().error({ err }, 'route leg failed');
      res.status(500).json({ error: 'Could not follow roads there.' });
    }
  });

  // POST /api/route-tracks/detour { from, to, lengthKm?, profile, round }: A to B but about lengthKm (longer than the direct route). Without lengthKm:
  // just the direct route and how long it is. Up to three options, each with offPct (how far its length is from the target).
  router.post('/detour', async (req, res) => {
    try {
      const r = await planner.detour(req.user.id, { from: req.body?.from, to: req.body?.to, profile: req.body?.profile, lengthKm: req.body?.lengthKm, round: req.body?.round ?? 0 });
      res.set('Cache-Control', 'no-store');
      res.json(r);
    } catch (err) {
      if (err instanceof PlanError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
      }
      getLogger().error({ err }, 'route detour failed');
      res.status(500).json({ error: 'Could not plan that detour.' });
    }
  });

  // POST /api/route-tracks/loop { from: [lng, lat], lengthKm, profile, round }: up to three loops of about that length starting and ending at `from`.
  router.post('/loop', async (req, res) => {
    try {
      const r = await planner.loops(req.user.id, { from: req.body?.from, lengthKm: req.body?.lengthKm, profile: req.body?.profile, round: req.body?.round ?? 0 });
      res.set('Cache-Control', 'no-store');
      res.json(r);
    } catch (err) {
      if (err instanceof PlanError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(err.status).json({ error: err.message });
      }
      getLogger().error({ err }, 'route loop failed');
      res.status(500).json({ error: 'Could not plan that loop.' });
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
