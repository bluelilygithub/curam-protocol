'use strict';

// Two safety nets for /api/graphics, mounted once in routes/graphics.js:
//
//  capImagePixels   refuses any request carrying an image bigger than MAX_MEGAPIXELS before a route decodes it. Decoded pixels are
//                   4 bytes each (a 100-megapixel photo is 400MB), so a handful of big uploads could otherwise exhaust memory.
//                   Only the image header is read.
//
//  paidGuard        the tools that call a paid AI service (Generate, Augment, Upscale, Inpaint, Background, the icon tools, Alt text & names) are
//                   limited per person: at most MAX_IN_FLIGHT paid jobs at once, and a rolling 24-hour spend cap read from the same
//                   usage_logs rows the Usage dashboard shows. The route-wide aiLimiter (30 requests a minute) is for abuse, not cost.
//
// Settings (environment): GRAPHICS_MAX_MEGAPIXELS (default 64), GRAPHICS_DAILY_COST_CAP_USD (default 5; 0 turns the cap off),
// GRAPHICS_MAX_PAID_IN_FLIGHT (default 2).

const sharp = require('sharp');

const MAX_MEGAPIXELS = Number(process.env.GRAPHICS_MAX_MEGAPIXELS) || 64;
const MAX_IN_FLIGHT = Number(process.env.GRAPHICS_MAX_PAID_IN_FLIGHT) || 2;
const MAX_IMAGES_CHECKED = 60;

function dailyCapUsd() {
  const raw = process.env.GRAPHICS_DAILY_COST_CAP_USD;
  if (raw === undefined || raw === '') return 5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

function collectImageDataUrls(node, out, depth = 0) {
  if (out.length >= MAX_IMAGES_CHECKED || depth > 5 || node == null) return;
  if (typeof node === 'string') {
    if (node.length > 64 && /^data:image\/(png|jpe?g|webp|gif|tiff|avif|heic|heif);base64,/i.test(node.slice(0, 40))) out.push(node);
    return;
  }
  if (Array.isArray(node)) { node.forEach((x) => collectImageDataUrls(x, out, depth + 1)); return; }
  if (typeof node === 'object') Object.values(node).forEach((x) => collectImageDataUrls(x, out, depth + 1));
}

function capImagePixels(maxMegapixels = MAX_MEGAPIXELS) {
  return async (req, res, next) => {
    if (req.method !== 'POST' || !req.body || typeof req.body !== 'object') return next();
    const urls = [];
    collectImageDataUrls(req.body, urls);
    for (const url of urls) {
      let meta;
      try {
        // eslint-disable-next-line no-await-in-loop
        meta = await sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')).metadata();
      } catch {
        continue; // not readable as an image: the route reports that in its own words
      }
      const megapixels = ((meta.width || 0) * (meta.pageHeight || meta.height || 0)) / 1e6;
      if (megapixels > maxMegapixels) {
        return res.status(413).json({ error: `That image is too large (${Math.round(megapixels)} megapixels; the limit is ${maxMegapixels}). Make it smaller first, for example with Crop / Resize.` });
      }
    }
    return next();
  };
}

const inFlight = new Map();
// Money promised to jobs that are still running, per person. Spending is only written to usage_logs as each AI call finishes, so
// without this two jobs started together would both see the same balance and could carry the day past the limit between them.
const reservedUsd = new Map();
const reservedFor = (userId) => reservedUsd.get(userId) || 0;

/** What this person has spent on paid graphics tools in the last 24 hours (USD), from the Usage dashboard's rows. */
async function spentLast24h(pool, userId, feature = 'graphics_%') {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent
       FROM usage_logs
      WHERE user_id = $1 AND feature LIKE $2 AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId, feature]
  );
  return Number(rows[0]?.spent) || 0;
}

/**
 * Decides whether a paid job may start, and if so takes one of the person's "jobs at once" slots.
 * `totalUsd` is what the whole job is expected to cost (0 when unknown or for a single tool call): when it is more than 0 the job is also
 * refused up front if it would carry the day's spending past the limit, so a batch is never stopped half way by the limit.
 * The job's cost is reserved while it runs, so a second job started at the same time sees it. Returns { refuse: { status, body } } or { release }.
 */
async function startPaidJob(pool, userId, { totalUsd = 0, feature = 'graphics_%' } = {}) {
  if ((inFlight.get(userId) || 0) >= MAX_IN_FLIGHT) {
    return { refuse: { status: 429, body: { error: 'You already have image jobs running. Wait for one to finish, then try again.' } } };
  }

  const cap = dailyCapUsd();
  if (cap > 0) {
    try {
      const spent = (await spentLast24h(pool, userId, feature)) + reservedFor(userId);
      if (spent >= cap) {
        return {
          refuse: {
            status: 429,
            body: {
              code: 'GRAPHICS_DAILY_CAP',
              error: `You have reached the daily limit for AI image tools ($${cap.toFixed(2)} in the last 24 hours). It frees up as older jobs age out, or ask your admin to raise it.`,
              spentUsd: Number(spent.toFixed(4)),
              capUsd: cap,
            },
          },
        };
      }
      if (totalUsd > 0 && spent + totalUsd > cap) {
        return {
          refuse: {
            status: 429,
            body: {
              code: 'GRAPHICS_DAILY_CAP_JOB',
              error: `This job would cost about $${totalUsd.toFixed(2)}, but only $${(cap - spent).toFixed(2)} of today's $${cap.toFixed(2)} limit for AI image tools is left. Run fewer pictures, or try again when older jobs age out (24 hours).`,
              spentUsd: Number(spent.toFixed(4)),
              capUsd: cap,
              totalUsd: Number(totalUsd.toFixed(4)),
            },
          },
        };
      }
    } catch (err) {
      // The usage table being unreachable should not take image tools down; the rate limiter still applies.
      console.error('[graphics] spend check failed:', err.message);
    }
  }

  inFlight.set(userId, (inFlight.get(userId) || 0) + 1);
  const reserve = Math.max(0, Number(totalUsd) || 0);
  if (reserve > 0) reservedUsd.set(userId, reservedFor(userId) + reserve);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = (inFlight.get(userId) || 1) - 1;
    if (left > 0) inFlight.set(userId, left); else inFlight.delete(userId);
    if (reserve > 0) {
      const rest = reservedFor(userId) - reserve;
      if (rest > 0.00001) reservedUsd.set(userId, rest); else reservedUsd.delete(userId);
    }
  };
  return { release };
}

function makePaidGuard({ pool, feature = 'graphics_%' } = {}) {
  return async function paidGuard(req, res, next) {
    if (req.method !== 'POST') return next();
    const userId = req.user?.id;
    if (!userId) return next();
    const job = await startPaidJob(pool, userId, { feature });
    if (job.refuse) return res.status(job.refuse.status).json(job.refuse.body);
    res.on('finish', job.release);
    res.on('close', job.release);
    return next();
  };
}

/**
 * For a route that is only sometimes paid (Pipeline or Batch running a recipe with an AI step). Returns true when the job may go ahead
 * (its slot is given back when the reply ends), false when the refusal has already been sent.
 */
async function guardPaidJob(pool, req, res, { totalUsd = 0, feature = 'graphics_%' } = {}) {
  const userId = req.user?.id;
  if (!userId) return true;
  const job = await startPaidJob(pool, userId, { totalUsd, feature });
  if (job.refuse) { res.status(job.refuse.status).json(job.refuse.body); return false; }
  res.on('finish', job.release);
  res.on('close', job.release);
  return true;
}

module.exports = { capImagePixels, makePaidGuard, guardPaidJob, startPaidJob, spentLast24h, collectImageDataUrls, dailyCapUsd, MAX_MEGAPIXELS };
