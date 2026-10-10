'use strict';

// Cellar Planner LITE "Photo" tab: turns the planner's own 3D picture into a photo-style image with an AI image model (FAL). PUBLIC (no login, called
// from the business's own website), so it is built defensively, because every new photo costs real money:
//   - OFF until the owner switches it on (Settings -> Cellar Planner -> Photo); nothing is spent while it is off
//   - a daily cap across all visitors (owner-set) and a per-visitor hourly limit, both enforced here, never by the browser
//   - the same design + the same input picture is made once and remembered (repeat views cost nothing)
//   - at most MAX_INFLIGHT photos being made at once
//   - only a small JPEG/PNG of the right shape is accepted; the prompt is built here from a fixed list of words, never from visitor text
//   - the model's own safety checker is on; the result is downloaded from FAL's own hosts only and served from Vault
// Routes (mounted at /api/cellar-lite/photo, before requireAuth):  POST /  -> { key, url, cached }   GET /:key -> the image
// Docs: docs/cellar-planner.md ("Photo view").

const crypto = require('crypto');
const express = require('express');
const { getLogger } = require('../middleware/requestContext');

const MAX_IMAGE_BYTES = 600 * 1024;       // the planner sends about 80 KB; anything bigger is not from the planner
const MIN_IMAGE_BYTES = 3 * 1024;
const MAX_STORED = 1500;                   // newest photos kept
const MAX_INFLIGHT = 3;
const MAX_DOWNLOAD_BYTES = 6 * 1024 * 1024;
const FAL_TIMEOUT_MS = 90 * 1000;
const DESIGN_RE = /^CL\d+\.[A-Za-z0-9_-]{1,200}$/;
const KEY_RE = /^[a-f0-9]{40}$/;
const FINISHES = { oak: 'light oak timber racking', walnut: 'dark walnut timber racking', black: 'matte black metal and timber racking' };
const DOORS = { single: 'a single clear glass door', double: 'a pair of clear glass doors' };
const FAL_HOST = /(^|\.)(fal\.media|fal\.run|fal\.ai)$/i;

/** The fixed prompt. Built only from the two whitelisted words above, so a visitor can never put their own text in front of the model. */
function buildPrompt(finish, door) {
  return [
    'Transform this simple 3D illustration into a photorealistic interior photograph of a walk-in wine cellar.',
    'Keep exactly the same layout: the same room proportions, the same racks in the same places, the same door position and the same camera angle.',
    `Show ${FINISHES[finish]}, wine bottles lying on every rack, ${DOORS[door]} with a thin black frame, warm LED strip lighting, stone floor tiles and soft realistic shadows.`,
    'Professional architectural photography, sharp focus, natural colours. No people, no text, no logos.',
  ].join(' ');
}

/** The picture the planner sends: a data address for a JPEG or PNG, of a sensible size, whose first bytes really are that image type. */
function parseImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_IMAGE_BYTES * 1.4) return { error: 'The picture is missing or too big.' };
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { error: 'The picture must be a JPEG or PNG.' };
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < MIN_IMAGE_BYTES || bytes.length > MAX_IMAGE_BYTES) return { error: 'The picture is the wrong size.' };
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if ((m[1] === 'image/jpeg' && !isJpeg) || (m[1] === 'image/png' && !isPng)) return { error: 'The picture is not the type it says it is.' };
  return { bytes, mime: m[1] };
}

const sha = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex');

/**
 * @param {{ pool: { query: Function }, loadConfig: () => Promise<{ photo: { enabled: boolean, dailyLimit: number, perVisitorPerHour: number } }>,
 *           fetchFn?: typeof fetch, falKey?: () => string, model?: () => string, now?: () => number, report?: (title: string, body: string) => Promise<void> }} deps
 */
function createCellarLitePhotoRouter({ pool, loadConfig, fetchFn = fetch, falKey = () => process.env.FAL_API_KEY, model = () => process.env.CELLAR_LITE_PHOTO_MODEL || 'fal-ai/flux-pro/kontext', now = () => Date.now(), report = async () => {} }) {
  const router = express.Router();
  const visitors = new Map(); // visitor hash -> timestamps of recent photos
  let inflight = 0;

  const visitorOf = (req) => sha('v', String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown').slice(0, 24);
  const usedByVisitor = (v, windowMs) => { const t = (visitors.get(v) || []).filter((x) => now() - x < windowMs); if (t.length) visitors.set(v, t); else visitors.delete(v); return t.length; };

  router.use((req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // the image itself (public, immutable: a key is a hash, so its picture never changes)
  router.get('/:key', async (req, res) => {
    if (!KEY_RE.test(req.params.key)) return res.status(404).end();
    try {
      const { rows } = await pool.query('SELECT mime, data FROM cellar_lite_photos WHERE key=$1 LIMIT 1', [req.params.key]);
      if (!rows.length) return res.status(404).end();
      res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(rows[0].data);
    } catch (err) {
      getLogger().error({ err: err.message }, '[cellar-lite-photo] read failed');
      res.status(500).end();
    }
  });

  router.post('/', async (req, res) => {
    const fail = (status, code, error) => res.status(status).set('Cache-Control', 'no-store').json({ code, error });
    try {
      const cfg = (await loadConfig()).photo;
      if (!cfg || !cfg.enabled) return fail(403, 'off', 'The photo view is not switched on.');

      const b = req.body || {};
      if (typeof b.design !== 'string' || !DESIGN_RE.test(b.design)) return fail(400, 'bad-request', 'That design could not be read.');
      if (!Object.hasOwn(FINISHES, b.finish) || !Object.hasOwn(DOORS, b.door)) return fail(400, 'bad-request', 'That design could not be read.');
      const img = parseImage(b.image);
      if (img.error) return fail(400, 'bad-request', img.error);

      // the same design and picture again: no cost, no limit
      const key = sha('cellar-photo-v1', b.design, b.finish, b.door, sha(img.bytes.toString('base64'))).slice(0, 40);
      const hit = await pool.query('SELECT 1 FROM cellar_lite_photos WHERE key=$1 LIMIT 1', [key]);
      if (hit.rows.length) return res.set('Cache-Control', 'no-store').json({ key, url: `/api/cellar-lite/photo/${key}`, cached: true });

      if (!falKey()) { await report('Photo view: no image key', 'The Photo tab is switched on but FAL_API_KEY is not set on the server, so no photo can be made.'); return fail(503, 'failed', 'Photos are not available right now.'); }

      const v = visitorOf(req);
      if (usedByVisitor(v, 60 * 60 * 1000) >= cfg.perVisitorPerHour) return fail(429, 'limit-visitor', 'You have made a few photos already. Please try again in a little while.');
      const day = await pool.query(`SELECT COUNT(*)::int AS n FROM cellar_lite_photos WHERE "createdAt" >= date_trunc('day', NOW())`);
      if (Number(day.rows[0].n) >= cfg.dailyLimit) { await report('Photo view: daily limit reached', `The daily limit of ${cfg.dailyLimit} photos was reached, so visitors are being told to try again tomorrow. Raise it in Settings -> Cellar Planner if you want more.`); return fail(429, 'limit-day', 'We have made a lot of photos today. Please try again tomorrow.'); }
      if (inflight >= MAX_INFLIGHT) return fail(503, 'busy', 'We are busy making photos. Please try again in a moment.');

      inflight += 1;
      try {
        // reserve the visitor's slot before the slow call, so a double-click cannot make two
        visitors.set(v, [...(visitors.get(v) || []), now()]);
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), FAL_TIMEOUT_MS);
        let image;
        try {
          const call = await fetchFn(`https://fal.run/${model()}`, {
            method: 'POST', signal: ctl.signal,
            headers: { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: buildPrompt(b.finish, b.door), image_url: `data:${img.mime};base64,${img.bytes.toString('base64')}`, guidance_scale: 3.5, num_images: 1, output_format: 'jpeg', safety_tolerance: '2', sync_mode: true }),
          });
          const data = await call.json().catch(() => ({}));
          if (!call.ok) throw new Error(String(data?.detail || data?.error || `the image service answered ${call.status}`).slice(0, 200));
          image = Array.isArray(data.images) ? data.images[0] : null;
          if (!image || typeof image.url !== 'string') throw new Error('the image service sent no picture (its safety check may have refused it)');
          // only ever fetch from the image service's own hosts, over https
          const u = new URL(image.url);
          if (u.protocol !== 'https:' && !image.url.startsWith('data:')) throw new Error('the image address was not https');
          if (u.protocol === 'https:' && !FAL_HOST.test(u.hostname)) throw new Error('the image came from an unexpected host');
          const dl = await fetchFn(image.url, { signal: ctl.signal });
          if (!dl.ok) throw new Error(`could not download the picture (${dl.status})`);
          const buf = Buffer.from(await dl.arrayBuffer());
          if (buf.length < 2000 || buf.length > MAX_DOWNLOAD_BYTES) throw new Error('the picture was the wrong size');
          const mime = String(dl.headers.get?.('content-type') || 'image/jpeg').split(';')[0];
          if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('the picture was not an image');
          await pool.query(`INSERT INTO cellar_lite_photos (key, mime, data) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`, [key, mime, buf]);
          await pool.query(`DELETE FROM cellar_lite_photos WHERE key NOT IN (SELECT key FROM cellar_lite_photos ORDER BY "createdAt" DESC LIMIT ${MAX_STORED})`);
        } finally {
          clearTimeout(timer);
        }
        res.set('Cache-Control', 'no-store').json({ key, url: `/api/cellar-lite/photo/${key}`, cached: false });
      } catch (err) {
        // a failed photo does not count against the visitor
        visitors.set(v, (visitors.get(v) || []).slice(0, -1));
        getLogger().error({ err: err.message }, '[cellar-lite-photo] could not make a photo');
        await report('Photo view: a photo could not be made', `The image service failed: ${err.message}`);
        return fail(503, 'failed', 'We could not make your photo this time. Please try again in a moment.');
      } finally {
        inflight -= 1;
      }
    } catch (err) {
      getLogger().error({ err: err.message }, '[cellar-lite-photo] request failed');
      return fail(500, 'failed', 'We could not make your photo this time. Please try again in a moment.');
    }
  });

  return router;
}

module.exports = { createCellarLitePhotoRouter, buildPrompt, parseImage, MAX_INFLIGHT };
