'use strict';

/**
 * Contract Review agent — model card + runtime resolver. Same pattern as
 * translateModelResolver.js / documentRedactionModelResolver.js, collapsed
 * to a single slot since the whole pipeline (type detection, parties,
 * definitions, classification, risk scoring, obligations, summary, and the
 * stage-2 LLM-segmentation fallback) uses one model throughout, unlike
 * Document Redaction's separate local/frontier slots.
 *
 * agentId: contract-review-agent
 * Slot: analysis → contract_review_model
 *
 * Resolution order: this user's own contract_review_model setting -> the
 * first admin's contract_review_model setting -> Vault's own default
 * resolution (getModelsForUser's standard tier, via pickTextModel) — never a
 * hardcoded model id, per CLAUDE.md's Model selection section.
 */

const { pool } = require('../db');
const { getVaultModelsConfigForUser, getModelsForUser, pickTextModel } = require('./modelResolver');

const AGENT_ID = 'contract-review-agent';
const MODEL_SETTING_KEY = 'contract_review_model';

const AGENT_CARD = {
  agentId: AGENT_ID,
  title: 'Contract Review agent',
  slots: [
    {
      id: 'analysis',
      settingsKey: MODEL_SETTING_KEY,
      label: 'Contract Review model',
      required: false,
      inventory: 'any_connected',
    },
  ],
};

async function loadSetting(userId, key) {
  if (!userId || !key) return null;
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

function catalogEntryById(models, modelId) {
  if (!modelId || !Array.isArray(models)) return null;
  return models.find((m) => m && String(m.id).trim() === modelId) || null;
}

/**
 * @param {number|string} userId
 * @returns {Promise<{modelId: string|null, source: 'setting'|'admin'|'vault_default', fromAdmin: boolean}>}
 */
async function resolveContractReviewModel(userId) {
  if (!userId) return { modelId: null, source: null, fromAdmin: false };

  const own = await loadSetting(userId, MODEL_SETTING_KEY);
  if (own) return { modelId: own, source: 'setting', fromAdmin: false };

  const admin = await loadFirstAdminSetting(MODEL_SETTING_KEY);
  if (admin) return { modelId: admin, source: 'admin', fromAdmin: true };

  const tiers = await getModelsForUser(userId);
  const vaultDefault = pickTextModel(tiers, 'standard');
  return { modelId: vaultDefault, source: 'vault_default', fromAdmin: false };
}

async function getContractReviewAgentCardConfig(userId) {
  const { models } = await getVaultModelsConfigForUser(userId);
  const resolved = await resolveContractReviewModel(userId);
  const entry = resolved.modelId ? catalogEntryById(models, resolved.modelId) : null;
  return {
    ...AGENT_CARD,
    analysis: resolved.modelId ? {
      slot: 'analysis',
      modelId: resolved.modelId,
      provider: entry?.provider || null,
      name: entry?.name || null,
      source: resolved.source,
      fromAdminFallback: resolved.source !== 'setting' && resolved.fromAdmin,
    } : null,
    ok: !!resolved.modelId,
    errors: resolved.modelId ? [] : ['No model available — configure vault models, or set a Contract Review model override in Settings'],
  };
}

module.exports = {
  AGENT_ID,
  MODEL_SETTING_KEY,
  AGENT_CARD,
  resolveContractReviewModel,
  getContractReviewAgentCardConfig,
};
