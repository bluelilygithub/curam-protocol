'use strict';

// SERP Tracker: saved Lookups (an ad-hoc "what is on Google right now for this search"). Every query filters by "userId".
// The raw DataForSEO answer is stored gzipped for 90 days (so a better parser can re-read it later); the parsed summary stays.
// Deleting (one, several or all) goes through the shared recycle bin in the SAME transaction as the delete, so nothing is lost
// if either step fails. See docs/serp-tracker.md and docs/recycle-bin.md.

const zlib = require('node:zlib');

const KEEP_LATEST = 50;
const RAW_KEEP_DAYS = 90;
const MAX_IDS = 200;
const BIN_TYPE = 'serp-lookup';

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** The short row the saved list shows (no top-10 detail). */
function listWire(r) {
  const s = parseJson(r.summaryJson) || {};
  return {
    id: r.id, keyword: r.keyword, device: r.device, depth: r.depth, locationName: r.locationName, domain: r.domain,
    costUsd: Number(r.costUsd), createdAt: r.createdAt,
    myStatus: s.mine ? s.mine.status : null, myPosition: s.mine ? s.mine.bestPosition : null,
    aiOverview: s.aiOverview ? s.aiOverview.present : false, mineCited: s.aiOverview ? s.aiOverview.mineCited : false,
    rawKept: r.hasRaw === true,
  };
}

async function saveLookup(pool, { userId, siteId = null, keyword, locationName, languageCode, device, depth, domain = null, costUsd, summary, raw }) {
  const gz = raw ? zlib.gzipSync(Buffer.from(JSON.stringify(raw), 'utf8')) : null;
  const { rows } = await pool.query(
    `INSERT INTO serp_lookups ("userId","siteId",keyword,"locationName","languageCode",device,depth,domain,"costUsd","summaryJson","rawGz")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id, "createdAt"`,
    [userId, siteId, keyword, locationName, languageCode, device, depth, domain, costUsd, JSON.stringify(summary), gz],
  );
  // keep the latest 50 per person; the oldest beyond that are tidied away (an automatic tidy-up, not a person deleting, so no bin)
  await pool.query(
    `DELETE FROM serp_lookups WHERE "userId" = $1 AND id NOT IN (SELECT id FROM serp_lookups WHERE "userId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT ${KEEP_LATEST})`,
    [userId],
  );
  return { id: rows[0].id, createdAt: rows[0].createdAt };
}

async function listLookups(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, keyword, device, depth, "locationName", domain, "costUsd", "createdAt", "summaryJson", ("rawGz" IS NOT NULL) AS "hasRaw"
       FROM serp_lookups WHERE "userId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT ${KEEP_LATEST}`,
    [userId],
  );
  return rows.map(listWire);
}

async function getLookup(pool, userId, id) {
  const { rows } = await pool.query(
    `SELECT id, keyword, device, depth, "locationName", "languageCode", domain, "costUsd", "createdAt", "summaryJson", ("rawGz" IS NOT NULL) AS "hasRaw"
       FROM serp_lookups WHERE "userId" = $1 AND id = $2`,
    [userId, id],
  );
  if (!rows.length) return null;
  return { ...listWire(rows[0]), languageCode: rows[0].languageCode, summary: parseJson(rows[0].summaryJson) };
}

/**
 * Delete the person's own lookups: `ids` (a list) or `all`. Each goes to the recycle bin first, in one transaction. Ids that are not theirs
 * are simply not found (nothing is said about them). @returns {{ deleted, binIds }}
 */
async function deleteLookups(pool, bin, userId, { ids, all }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = all
      ? await db.query('SELECT id, keyword, device, depth, "locationName", "languageCode", "siteId", domain, "costUsd", "summaryJson", "createdAt" FROM serp_lookups WHERE "userId" = $1 FOR UPDATE', [userId])
      : await db.query('SELECT id, keyword, device, depth, "locationName", "languageCode", "siteId", domain, "costUsd", "summaryJson", "createdAt" FROM serp_lookups WHERE "userId" = $1 AND id = ANY($2::int[]) FOR UPDATE', [userId, ids]);
    const binIds = [];
    for (const r of rows) {
      // the raw answer is left out on purpose: big, and getting it again would cost money
      binIds.push(await bin.moveToBin(db, { userId, type: BIN_TYPE, id: r.id, title: r.keyword, detail: `${r.device}, top ${r.depth}`, payload: { lookup: { ...r, summaryJson: parseJson(r.summaryJson) } } }));
    }
    if (rows.length) await db.query('DELETE FROM serp_lookups WHERE "userId" = $1 AND id = ANY($2::int[])', [userId, rows.map((r) => r.id)]);
    await db.query('COMMIT');
    return { deleted: rows.length, binIds };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Empty the raw answers older than 90 days (the parsed summary stays). Sends nothing. */
async function purgeRaw(pool, now = Date.now) {
  const r = await pool.query('UPDATE serp_lookups SET "rawGz" = NULL WHERE "rawGz" IS NOT NULL AND "createdAt" < $1', [new Date(now() - RAW_KEEP_DAYS * 86400000)]);
  return r.rowCount || 0;
}

module.exports = { saveLookup, listLookups, getLookup, deleteLookups, purgeRaw, KEEP_LATEST, RAW_KEEP_DAYS, MAX_IDS, BIN_TYPE };
