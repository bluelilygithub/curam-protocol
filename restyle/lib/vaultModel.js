'use strict';

// Resolves the AI model Restyle should call from the Curam Vault ecosystem's own
// "standard" model setting, instead of hardcoding an id here. Restyle has no user
// accounts and no settings UI of its own — it borrows Vault's shared Postgres
// (same DATABASE_URL) purely as a read-only config lookup: same resolution order
// as Vault's own getModelsForUser() 'standard' tier (see
// vault/server/services/modelResolver.js), narrowed to the first admin's config
// since there's no per-user identity here. Restyle never writes to this database.
//
// Falls back to FALLBACK_MODEL_ID only if Vault's DB is unreachable or has no
// vault_models configured yet — this keeps Restyle usable standalone (e.g. local
// dev without a DATABASE_URL) without ever hardcoding the model as the primary path.

const FALLBACK_MODEL_ID = 'claude-sonnet-5';
const CACHE_TTL_MS = 60_000;

let pool = null;
let cache = { value: null, expiresAt: 0 };

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('railway') || process.env.PGSSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
      max: 2,
    });
  } catch (err) {
    console.warn('[vaultModel] pg not available:', err.message);
    pool = null;
  }
  return pool;
}

function isNonTextModel(entry) {
  const provider = String(entry?.provider || '').toLowerCase();
  if (['fal', 'seedance', 'replicate', 'serper', 'serpapi'].includes(provider)) return true;
  const id = String(entry?.id || '').toLowerCase();
  if (!id) return true;
  if (id.startsWith('fal-ai/') || id.startsWith('fal/')) return true;
  if (/minimax\/|hailuo|video-01|image-to-video|\/flux/.test(id)) return true;
  return false;
}

function isAnthropicModel(entry) {
  const provider = String(entry?.provider || '').toLowerCase();
  const id = String(entry?.id || '');
  if (provider) return provider === 'anthropic';
  return !id.startsWith('gemini-') && !id.startsWith('deepseek-') && !id.startsWith('ollama:');
}

async function queryFirstAdminModelConfig() {
  const db = getPool();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT s."userId", s.key, s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE
       AND s.key IN ('vault_models','default_model')
     ORDER BY s."userId" ASC`
  );
  if (!rows.length) return null;
  const firstAdminId = rows[0].userId;
  const byKey = Object.fromEntries(rows.filter(r => r.userId === firstAdminId).map(r => [r.key, r.value]));
  return byKey;
}

/** Same tier-pick shape as Vault's pickTiers(), 'standard' slot only, Anthropic-preferred. */
function resolveStandardId(vaultModelsRaw, defaultModel) {
  let entries = [];
  try {
    const parsed = JSON.parse(vaultModelsRaw || '[]');
    if (Array.isArray(parsed)) entries = parsed;
  } catch { /* ignore */ }
  const textIds = entries.filter(m => !isNonTextModel(m)).map(m => String(m.id).trim()).filter(Boolean);
  if (!textIds.length) return null;
  return (defaultModel && textIds.includes(defaultModel)) ? defaultModel : textIds[0];
}

/**
 * Returns the model id Restyle should call for AI edits, resolved from Vault's shared
 * settings the same way Vault's own chat resolves its 'standard' tier. Cached briefly
 * to avoid a DB round trip on every /api/ai-edit call.
 */
async function getRestyleModelId() {
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  let resolved = FALLBACK_MODEL_ID;
  try {
    const cfg = await queryFirstAdminModelConfig();
    if (cfg) {
      const id = resolveStandardId(cfg.vault_models, cfg.default_model);
      if (id) resolved = id;
    }
  } catch (err) {
    console.warn('[vaultModel] falling back to default model id:', err.message);
  }
  cache = { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
  return resolved;
}

module.exports = { getRestyleModelId, FALLBACK_MODEL_ID };
