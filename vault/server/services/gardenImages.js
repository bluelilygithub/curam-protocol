'use strict';

// Garden Planner tracing pictures live in their own table (garden_images), not inside the garden design: a garden references one by
// `underlay.imageId` ("srv-<id>"), so autosave sends only the small design. This file holds what the router and the boot migration share.

const ALLOWED = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // a 4000 px JPEG is normally 1-3 MB
const MAX_IMAGES_PER_USER = 50;
/** An uploaded picture is not marked unreferenced until it is this old, so one still waiting for its garden's next save survives. */
const ORPHAN_GRACE = '1 hour';
/** A picture no garden references is only MARKED deleted (still downloadable, so Undo works); it is purged this long after being marked. */
const PURGE_AFTER_DAYS = 30;

const imageRef = (id) => `srv-${id}`;

/** True when `bytes` really is an image of the claimed type (never trust the Content-Type header alone). */
function looksLike(mime, bytes) {
  return Boolean(ALLOWED[mime] && Buffer.isBuffer(bytes) && ALLOWED[mime](bytes));
}

/** SQL condition: some garden of this user (param $1) references the picture. */
const REFERENCED = `'srv-' || id::text IN (
  SELECT data->'underlay'->>'imageId' FROM garden_projects
  WHERE "userId" = $1 AND data->'underlay'->>'imageId' IS NOT NULL
)`;

/**
 * Housekeeping after a garden is saved or deleted. Never throws. Soft delete, in three steps over one user's pictures:
 *   1. mark   - a picture no garden references (and older than the grace period) gets deletedAt = now
 *   2. restore - a marked picture that some garden references again (Undo, or a copy of the garden) has deletedAt cleared
 *   3. purge  - a marked picture still unreferenced after PURGE_AFTER_DAYS is deleted for good
 * A marked picture stays downloadable the whole time, so Undo never shows a broken picture.
 */
async function reconcileImages(pool, userId, log) {
  try {
    await pool.query(
      `UPDATE garden_images SET "deletedAt" = NOW()
       WHERE "userId" = $1 AND "deletedAt" IS NULL AND "createdAt" < NOW() - INTERVAL '${ORPHAN_GRACE}' AND NOT (${REFERENCED})`,
      [userId],
    );
    await pool.query(
      `UPDATE garden_images SET "deletedAt" = NULL WHERE "userId" = $1 AND "deletedAt" IS NOT NULL AND ${REFERENCED}`,
      [userId],
    );
    await pool.query(
      `DELETE FROM garden_images
       WHERE "userId" = $1 AND "deletedAt" < NOW() - INTERVAL '${PURGE_AFTER_DAYS} days' AND NOT (${REFERENCED})`,
      [userId],
    );
  } catch (err) {
    if (log) log.warn({ err }, 'garden image housekeeping failed');
  }
}

/** "data:image/jpeg;base64,..." -> { mime, bytes } or null. */
function parseDataUrl(s) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(typeof s === 'string' ? s : '');
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  return looksLike(m[1], bytes) ? { mime: m[1], bytes } : null;
}

/**
 * One-time (idempotent) migration for gardens saved by the first server build, which embedded the tracing picture in the design as
 * `underlay.dataUrl`: move each picture into garden_images and point the garden at it. The garden's updatedAt is left alone, so an open
 * window's next save is not turned into a false conflict. Gardens whose picture cannot be read are left as they are and reported.
 */
async function migrateEmbeddedPictures(pool, log) {
  const { rows } = await pool.query(
    `SELECT id, "userId", data FROM garden_projects WHERE data->'underlay'->>'dataUrl' IS NOT NULL ORDER BY id`,
  );
  let moved = 0;
  for (const row of rows) {
    const parsed = parseDataUrl(row.data?.underlay?.dataUrl);
    if (!parsed) { if (log) log.warn({ gardenId: row.id }, 'garden picture could not be migrated: not a readable image'); continue; }
    const img = await pool.query(
      `INSERT INTO garden_images ("userId", mime, bytes, data) VALUES ($1, $2, $3, $4) RETURNING id`,
      [row.userId, parsed.mime, parsed.bytes.length, parsed.bytes],
    );
    const { dataUrl: _drop, ...underlay } = row.data.underlay;
    void _drop;
    const next = { ...row.data, underlay: { ...underlay, imageId: imageRef(img.rows[0].id) } };
    await pool.query(`UPDATE garden_projects SET data = $1::jsonb WHERE id = $2`, [JSON.stringify(next), row.id]);
    moved += 1;
  }
  if (moved && log) log.info({ moved }, 'garden pictures moved out of the design');
  return moved;
}

module.exports = { ALLOWED, MAX_IMAGE_BYTES, MAX_IMAGES_PER_USER, imageRef, looksLike, reconcileImages, parseDataUrl, PURGE_AFTER_DAYS, ORPHAN_GRACE, migrateEmbeddedPictures };
