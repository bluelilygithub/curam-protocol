'use strict';

// SERP Tracker: reading and writing the site profile. Every query is filtered by "userId" (one tracked site per person for now).

function parseProfile(v) { return typeof v === 'string' ? JSON.parse(v) : v; }

async function loadSite(pool, userId) {
  const { rows } = await pool.query('SELECT id, "userId", "profileJson", "updatedAt" FROM serp_sites WHERE "userId" = $1', [userId]);
  if (!rows.length) return null;
  return { id: rows[0].id, userId: rows[0].userId, profile: parseProfile(rows[0].profileJson), updatedAt: rows[0].updatedAt };
}

async function saveSite(pool, userId, profile) {
  const { rows } = await pool.query(
    `INSERT INTO serp_sites ("userId", "profileJson") VALUES ($1, $2::jsonb)
     ON CONFLICT ("userId") DO UPDATE SET "profileJson" = EXCLUDED."profileJson", "updatedAt" = NOW()
     RETURNING id, "userId", "profileJson", "updatedAt"`,
    [userId, JSON.stringify(profile)],
  );
  return { id: rows[0].id, userId: rows[0].userId, profile: parseProfile(rows[0].profileJson), updatedAt: rows[0].updatedAt };
}

/** Every tracked site, for the daily job (the job is the only caller that reads across people). */
async function loadAllSites(pool) {
  const { rows } = await pool.query('SELECT id, "userId", "profileJson" FROM serp_sites ORDER BY id');
  return rows.map((r) => ({ id: r.id, userId: r.userId, profile: parseProfile(r.profileJson) }));
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
    steps: parseProfile(r.stepsJson) || [], errors: parseProfile(r.errorsJson) || [],
  }));
}

module.exports = { loadSite, saveSite, loadAllSites, listRuns };
