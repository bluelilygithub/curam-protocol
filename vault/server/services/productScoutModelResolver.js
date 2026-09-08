'use strict';

/**
 * Product Scout — optional model override.
 *
 * Product Scout (brief, tier compare, final recommendation) normally uses
 * the workspace `standard` tier like everything else (see modelResolver.js).
 * This lets a user (or admin, as a workspace-wide fallback) pin Product
 * Scout to a specific connected model instead — e.g. to avoid a reasoning
 * model like deepseek-v4-flash that can burn its whole token budget on
 * hidden reasoning and return an empty structured-JSON response.
 *
 * Settings key: product_scout_model (empty/unset = inherit `standard`).
 * Resolution order: user's own setting → first admin's setting → `standard`.
 */

const { pool } = require('../db');
const { getModelsForUser, getVaultModelsConfigForUser } = require('./modelResolver');

const SETTINGS_KEY = 'product_scout_model';

async function loadSetting(userId, key) {
  if (!userId) return null;
  const { rows } = await pool.query(
    'SELECT value FROM settings WHERE "userId"=$1 AND key=$2',
    [userId, key],
  );
  const v = rows[0]?.value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function loadFirstAdminSetting(key) {
  const { rows } = await pool.query(
    `SELECT s.value
     FROM settings s
     JOIN users u ON u.id = s."userId"
     WHERE u."isAdmin" = TRUE AND s.key = $1
     ORDER BY s."userId" ASC
     LIMIT 1`,
    [key],
  );
  const v = rows[0]?.value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function resolveOverrideSetting(userId) {
  const own = await loadSetting(userId, SETTINGS_KEY);
  if (own) return { modelId: own, fromAdmin: false };
  const admin = await loadFirstAdminSetting(SETTINGS_KEY);
  if (admin) return { modelId: admin, fromAdmin: true };
  return { modelId: null, fromAdmin: false };
}

/** Product Scout's model for this user: valid override, else the global `standard` tier. */
async function resolveProductScoutModel(userId) {
  const { models } = await getVaultModelsConfigForUser(userId);
  const { modelId } = await resolveOverrideSetting(userId);
  if (modelId && Array.isArray(models) && models.some((m) => String(m?.id).trim() === modelId)) {
    return modelId;
  }
  const { standard } = await getModelsForUser(userId);
  return standard;
}

/** Settings UI config: current override (valid or not) + connected inventory + what it'd fall back to. */
async function getProductScoutModelConfig(userId) {
  const { models } = await getVaultModelsConfigForUser(userId);
  const { modelId, fromAdmin } = await resolveOverrideSetting(userId);
  const { standard } = await getModelsForUser(userId);
  const valid = !modelId || models.some((m) => String(m?.id).trim() === modelId);
  return {
    settingsKey: SETTINGS_KEY,
    modelId: modelId || '',
    assignmentValid: valid,
    fromAdmin,
    globalStandard: standard,
    choices: models,
  };
}

/** Save (or clear, when modelId is empty) this user's Product Scout model override. */
async function saveProductScoutModel(userId, modelId) {
  const id = String(modelId || '').trim();
  if (id) {
    const { models } = await getVaultModelsConfigForUser(userId);
    if (!models.some((m) => String(m?.id).trim() === id)) {
      const err = new Error('Model must be a connected model in the vault_models inventory');
      err.status = 400;
      throw err;
    }
    await pool.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3)
       ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
      [userId, SETTINGS_KEY, id],
    );
  } else {
    await pool.query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [userId, SETTINGS_KEY]);
  }
  return getProductScoutModelConfig(userId);
}

module.exports = {
  SETTINGS_KEY,
  resolveProductScoutModel,
  getProductScoutModelConfig,
  saveProductScoutModel,
};
