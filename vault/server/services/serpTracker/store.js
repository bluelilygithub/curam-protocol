'use strict';

// SERP Tracker: tracked sites, one row per site, several per person (one per client or website). Every query filters by "userId".
// A site may be linked to one of the person's CRM clients ("clientId", optional; deleting the client only unlinks). Deleting a site moves it
// and its saved lookups to the shared recycle bin in the same transaction (type serp-site); its run history goes with it, and its past
// spending stays in the cost log (serp_api_costs.siteId becomes empty). See docs/serp-tracker.md.

const { LIMITS } = require('./siteProfile');

const MAX_SITES = LIMITS.sites;
const BIN_TYPE = 'serp-site';

class SiteError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'SiteError'; this.status = status; }
}

const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const siteWire = (r) => ({
  id: r.id,
  profile: parseJson(r.profileJson),
  clientId: r.clientId == null ? null : r.clientId,
  clientName: r.clientName == null ? null : r.clientName,
  gscSiteUrl: r.gscSiteUrl == null ? null : r.gscSiteUrl,
  updatedAt: r.updatedAt,
});

const SITE_SELECT = `SELECT s.id, s."userId", s."profileJson", s."clientId", s."gscSiteUrl", s."updatedAt", c.name AS "clientName"
                       FROM serp_sites s LEFT JOIN clients c ON c.id = s."clientId" AND c."userId" = s."userId"`;

async function listSites(pool, userId) {
  const { rows } = await pool.query(`${SITE_SELECT} WHERE s."userId" = $1 ORDER BY lower(s."profileJson"->>'name'), s."profileJson"->>'domain', s.id`, [userId]);
  return rows.map(siteWire);
}

async function loadSite(pool, userId, id) {
  const { rows } = await pool.query(`${SITE_SELECT} WHERE s."userId" = $1 AND s.id = $2`, [userId, id]);
  if (!rows.length) return null;
  return { ...siteWire(rows[0]), userId: rows[0].userId };
}

/** One person cannot track the same domain twice (two clients on one website would be a mix-up, not a use). */
async function domainTaken(pool, userId, domain, exceptId = null) {
  const { rows } = await pool.query(`SELECT 1 FROM serp_sites WHERE "userId" = $1 AND "profileJson"->>'domain' = $2 AND ($3::int IS NULL OR id <> $3) LIMIT 1`, [userId, domain, exceptId]);
  return rows.length > 0;
}

async function createSite(pool, userId, profile, clientId = null) {
  const n = Number((await pool.query('SELECT COUNT(*) AS n FROM serp_sites WHERE "userId" = $1', [userId])).rows[0].n);
  if (n >= MAX_SITES) throw new SiteError(`You already track ${MAX_SITES} sites, which is the most. Delete one to add another.`, 409);
  if (await domainTaken(pool, userId, profile.domain)) throw new SiteError(`You already track ${profile.domain}.`, 409);
  const { rows } = await pool.query('INSERT INTO serp_sites ("userId", "profileJson", "clientId") VALUES ($1, $2::jsonb, $3) RETURNING id', [userId, JSON.stringify(profile), clientId]);
  return loadSite(pool, userId, rows[0].id);
}

/** `clientId` undefined = leave the link alone, null = remove it, a number = link (the caller has already checked it is theirs). */
async function updateSite(pool, userId, id, profile, clientId) {
  // ownership first: a site that is not theirs is "not found" whatever else is wrong with the request
  if (!(await pool.query('SELECT 1 FROM serp_sites WHERE id = $1 AND "userId" = $2', [id, userId])).rows.length) return null;
  if (await domainTaken(pool, userId, profile.domain, id)) throw new SiteError(`You already track ${profile.domain}.`, 409);
  const { rowCount } = await pool.query(
    `UPDATE serp_sites SET "profileJson" = $3::jsonb, "clientId" = CASE WHEN $4::boolean THEN $5 ELSE "clientId" END, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2`,
    [id, userId, JSON.stringify(profile), clientId !== undefined, clientId === undefined ? null : clientId],
  );
  return rowCount ? loadSite(pool, userId, id) : null;
}

/** Delete a site and its saved lookups (to the recycle bin, in one transaction). @returns {{ deleted, binId }} (deleted false = not theirs) */
async function deleteSite(pool, bin, userId, id) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const site = (await db.query('SELECT id, "userId", "profileJson", "clientId", "createdAt", "updatedAt" FROM serp_sites WHERE id = $1 AND "userId" = $2 FOR UPDATE', [id, userId])).rows[0];
    if (!site) { await db.query('ROLLBACK'); return { deleted: false, binId: null }; }
    // the raw DataForSEO answers are left out on purpose: big, and getting them again would cost money
    const lookups = (await db.query(
      'SELECT id, keyword, "locationName", "languageCode", device, depth, domain, "costUsd", "summaryJson", "createdAt" FROM serp_lookups WHERE "userId" = $1 AND "siteId" = $2',
      [userId, id],
    )).rows.map((l) => ({ ...l, summaryJson: parseJson(l.summaryJson) }));
    const profile = parseJson(site.profileJson);
    const binId = await bin.moveToBin(db, {
      userId, type: BIN_TYPE, id, title: profile.name || profile.domain, detail: `${profile.domain}, ${lookups.length} saved lookup${lookups.length === 1 ? '' : 's'}`,
      payload: { site: { ...site, profileJson: profile }, lookups },
    });
    await db.query('DELETE FROM serp_lookups WHERE "userId" = $1 AND "siteId" = $2', [userId, id]);
    await db.query('DELETE FROM serp_sites WHERE id = $1 AND "userId" = $2', [id, userId]);
    await db.query('COMMIT');
    return { deleted: true, binId };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Every tracked site, for the daily job (the job is the only caller that reads across people). */
async function loadAllSites(pool) {
  const { rows } = await pool.query('SELECT id, "userId", "profileJson", "gscSiteUrl" FROM serp_sites ORDER BY id');
  return rows.map((r) => ({ id: r.id, userId: r.userId, profile: parseJson(r.profileJson), gscSiteUrl: r.gscSiteUrl || null }));
}

/** Choose (or clear, with null) the Search Console property a site reads its keywords from. Ownership is checked here too. @returns true if it was theirs */
async function setGscSiteUrl(pool, userId, id, siteUrl) {
  const { rowCount } = await pool.query('UPDATE serp_sites SET "gscSiteUrl" = $3 WHERE id = $1 AND "userId" = $2', [id, userId, siteUrl]);
  return rowCount > 0;
}

async function listRuns(pool, userId, siteId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, "startedAt", "finishedAt", "runDate"::text AS "runDate", status, trigger, "balanceUsd", "totalCostUsd", "stepsJson", "errorsJson"
       FROM serp_runs WHERE "userId" = $1 AND "siteId" = $2 ORDER BY "startedAt" DESC, id DESC LIMIT $3`,
    [userId, siteId, limit],
  );
  return rows.map((r) => ({
    id: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, runDate: r.runDate, status: r.status, trigger: r.trigger,
    balanceUsd: r.balanceUsd == null ? null : Number(r.balanceUsd), totalCostUsd: Number(r.totalCostUsd),
    steps: parseJson(r.stepsJson) || [], errors: parseJson(r.errorsJson) || [],
  }));
}

module.exports = { setGscSiteUrl, listSites, loadSite, createSite, updateSite, deleteSite, loadAllSites, listRuns, domainTaken, SiteError, MAX_SITES, BIN_TYPE };
