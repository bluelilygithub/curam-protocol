'use strict';

// BIP persistence. One profile row per domain/person, one source row per module run (so raw responses, status and time are kept
// separately), and a JSONB copy of the assembled profile for quick reads. No TTL deletion: profiles stay until the person deletes
// them (and then the recycle bin can put them back).

const { pool } = require('../../db');

const CACHE_DAYS = 30;

const j = (value) => JSON.stringify(value || {});

function parse(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function createProfile(userId, domain) {
  const { rows } = await pool.query(
    `INSERT INTO bip_profiles ("userId", domain, status) VALUES ($1, $2, 'running')
     RETURNING id, domain, status, "createdAt"`,
    [userId, domain]
  );
  return rows[0];
}

/** A usable cached profile: finished, scanned within the last 30 days. */
async function cachedProfile(userId, domain) {
  const { rows } = await pool.query(
    `SELECT id, domain, "businessName", status, "createdAt", "scannedAt"
       FROM bip_profiles
      WHERE "userId" = $1 AND lower(domain) = lower($2) AND status = 'done'
        AND "scannedAt" > NOW() - ($3 || ' days')::interval
      ORDER BY "scannedAt" DESC, id DESC LIMIT 1`,
    [userId, domain, CACHE_DAYS]
  );
  return rows[0] || null;
}

async function listProfiles(userId) {
  const { rows } = await pool.query(
    `SELECT id, domain, "businessName", status, "createdAt", "scannedAt", "updatedAt", "enrichmentData"
       FROM bip_profiles WHERE "userId" = $1
      ORDER BY COALESCE("scannedAt", "createdAt") DESC, id DESC LIMIT 500`,
    [userId]
  );
  return rows.map(({ enrichmentData, ...row }) => ({
    ...row,
    moduleCount: Object.keys(parse(enrichmentData)).length,
  }));
}

async function getProfile(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM bip_profiles WHERE id = $1 AND "userId" = $2`,
    [Number(id) || 0, userId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const linkedClient = row.clientId
    ? (await pool.query('SELECT id, name FROM clients WHERE id = $1 AND "userId" = $2', [row.clientId, userId])).rows[0] || null
    : null;
  const sources = await pool.query(
    `SELECT DISTINCT ON (name) name, status, reason, error, data, "rawResponse", "checkedAt"
       FROM bip_sources WHERE "profileId" = $1 AND "userId" = $2
      ORDER BY name, "checkedAt" DESC, id DESC`,
    [row.id, userId]
  );
  return {
    id: row.id,
    domain: row.domain,
    businessName: row.businessName,
    status: row.status,
    error: row.error || null,
    createdAt: row.createdAt,
    scannedAt: row.scannedAt,
    updatedAt: row.updatedAt,
    seed: parse(row.seedData),
    modules: parse(row.enrichmentData),
    reconciliation: parse(row.reconciliation),
    cards: parse(row.cards),
    decisions: parse(row.decisions),
    summary: parse(row.summary, null),
    clientId: linkedClient?.id || null,
    clientName: linkedClient?.name || null,
    sources: sources.rows.map((s) => ({
      name: s.name, status: s.status, reason: s.reason, error: s.error,
      data: parse(s.data, null), raw: parse(s.rawResponse, null), checkedAt: s.checkedAt,
    })),
  };
}

/** Save one module's result and keep its raw response as a new, timestamped source row. */
async function saveModule(profileId, userId, name, result) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bip_sources ("profileId", "userId", name, status, reason, error, data, "rawResponse")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [profileId, userId, name, result.status, result.reason || null, result.error || null,
        j(result.data), j(result.data?.raw ?? result.data ?? {})]
    );
    await client.query(
      `UPDATE bip_profiles
          SET "enrichmentData" = jsonb_set("enrichmentData", $2::text[], $3::jsonb, true),
              "updatedAt" = NOW()
        WHERE id = $1 AND "userId" = $4`,
      [profileId, `{${name}}`, j({ ...result, checkedAt: new Date().toISOString() }), userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function saveSeed(profileId, userId, seed, results) {
  const { rows } = await pool.query(
    `UPDATE bip_profiles SET "seedData" = $3::jsonb, "enrichmentData" = $4::jsonb, "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2 RETURNING id`,
    [profileId, userId, j(seed), j(results)]
  );
  return rows[0] || null;
}

async function saveSeedData(profileId, userId, seed) {
  await pool.query(
    `UPDATE bip_profiles SET "seedData" = $3::jsonb, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2`,
    [profileId, userId, j(seed)]
  );
}

async function finishProfile(profileId, userId, { businessName, reconciliation, cards, error = null }) {
  const { rows } = await pool.query(
    `UPDATE bip_profiles
        SET status = $3::text, "businessName" = $4, "reconciliation" = $5::jsonb, "cards" = $6::jsonb,
            error = $7, "scannedAt" = CASE WHEN $3::text = 'done' THEN NOW() ELSE "scannedAt" END,
            "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2 RETURNING id, status`,
    [profileId, userId, error ? 'failed' : 'done', businessName || null, j(reconciliation), j(cards), error]
  );
  return rows[0] || null;
}

async function failProfile(profileId, userId, message) {
  return finishProfile(profileId, userId, { businessName: null, reconciliation: {}, cards: {}, error: message });
}

async function saveDecisions(profileId, userId, decisions) {
  const { rows } = await pool.query(
    `UPDATE bip_profiles SET "decisions" = $3::jsonb, "reconciliation" = jsonb_set("reconciliation", '{decisions}', $3::jsonb, true), "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2 RETURNING id`,
    [profileId, userId, j(decisions)]
  );
  return rows[0] || null;
}

/** Notes that link to this profile ("](/bip/12)" in the text): the notes Save to Note made, or any the person pasted the link into. */
async function linkedNotes(userId, id) {
  const { rows } = await pool.query(
    `SELECT id, title, project_id AS "projectId", updated_at AS "updatedAt" FROM notes
      WHERE user_id = $1 AND body LIKE $2 ORDER BY updated_at DESC, id DESC LIMIT 20`,
    [userId, `%](/bip/${Number(id) || 0})%`]
  );
  return rows;
}

/** Saved questions and answers for one profile, newest first. */
async function listQa(userId, profileId) {
  const { rows } = await pool.query(
    `SELECT id, question, answer, model, "unverifiedFigures", "createdAt" FROM bip_qa
      WHERE "userId" = $1 AND "profileId" = $2 ORDER BY "createdAt" DESC, id DESC LIMIT 200`,
    [userId, profileId]
  );
  return rows.map((r) => ({ ...r, unverifiedFigures: parse(r.unverifiedFigures, []) }));
}

async function saveQa(userId, profileId, { question, answer, model, unverifiedFigures }) {
  const { rows } = await pool.query(
    `INSERT INTO bip_qa ("userId", "profileId", question, answer, model, "unverifiedFigures")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id, question, answer, model, "unverifiedFigures", "createdAt"`,
    [userId, profileId, question, answer, model || null, JSON.stringify(unverifiedFigures || [])]
  );
  return { ...rows[0], unverifiedFigures: parse(rows[0].unverifiedFigures, []) };
}

async function deleteQa(userId, profileId, qaId) {
  const { rowCount } = await pool.query('DELETE FROM bip_qa WHERE id = $1 AND "userId" = $2 AND "profileId" = $3', [Number(qaId) || 0, userId, profileId]);
  return rowCount > 0;
}

/** The written summary (services/bip/summary.js): { text, model, generatedAt, unverifiedFigures }. */
async function saveSummary(profileId, userId, summary) {
  await pool.query('UPDATE bip_profiles SET summary = $3::jsonb, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2', [profileId, userId, JSON.stringify(summary)]);
}

/** File the profile under one of the person's clients (or none). Returns false when the client is not theirs. */
async function setClient(profileId, userId, clientId) {
  if (clientId != null) {
    const owned = await pool.query('SELECT 1 FROM clients WHERE id = $1 AND "userId" = $2', [clientId, userId]);
    if (!owned.rows.length) return false;
  }
  await pool.query('UPDATE bip_profiles SET "clientId" = $3, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2', [profileId, userId, clientId]);
  return true;
}

/** The profiles filed under one client, for that client's page. */
async function profilesForClient(userId, clientId) {
  const { rows } = await pool.query(
    `SELECT id, domain, "businessName", status, "scannedAt", "createdAt" FROM bip_profiles
      WHERE "userId" = $1 AND "clientId" = $2 ORDER BY COALESCE("scannedAt", "createdAt") DESC, id DESC LIMIT 50`,
    [userId, clientId]
  );
  return rows;
}

async function getRow(userId, id) {
  const { rows } = await pool.query('SELECT * FROM bip_profiles WHERE id = $1 AND "userId" = $2', [Number(id) || 0, userId]);
  return rows[0] || null;
}

async function deleteProfile(userId, id) {
  const { rows } = await pool.query('DELETE FROM bip_profiles WHERE id = $1 AND "userId" = $2 RETURNING *', [Number(id) || 0, userId]);
  return rows[0] || null;
}

module.exports = {
  CACHE_DAYS, createProfile, cachedProfile, listProfiles, getProfile, getRow,
  saveModule, saveSeed, saveSeedData, finishProfile, failProfile, saveDecisions, deleteProfile, parse,
  linkedNotes, setClient, profilesForClient, saveSummary, listQa, saveQa, deleteQa,
};
