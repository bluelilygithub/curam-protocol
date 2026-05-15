'use strict';

const { pool } = require('../db');

const EMPTY_MODELS = {
  light: null,
  standard: null,
  gemini: null,
  deepseek: null,
};

/**
 * Resolve the user's configured models into tier slots.
 *
 * - light    : cheapest/fastest Anthropic model — for utility tasks (NLP
 *              translation, auto-title, file summaries, quick suggestions)
 * - standard : mid-tier Anthropic model — for substantive tasks (summarise,
 *              mood insights, compare fallback, PDF analysis, inquiry)
 * - gemini   : first configured Gemini model — for Gemini-specific paths
 *
 * Resolution order:
 *   1) Current user's settings
 *   2) First admin user's settings (workspace-level fallback)
 *   3) Nulls (no hardcoded model IDs)
 */
async function getModelsForUser(userId) {
  try {
    const parseConfiguredModelIds = (rawVaultModels) => {
      if (!rawVaultModels) return [];
      let parsed;
      try {
        parsed = JSON.parse(rawVaultModels);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((m) => (m && typeof m.id === 'string' ? m.id.trim() : ''))
        .filter(Boolean);
    };

    const pickTiers = (modelIds, configuredDefault) => {
      if (!Array.isArray(modelIds) || modelIds.length === 0) return { ...EMPTY_MODELS };
      const anthropicModels = modelIds.filter(id => !id.startsWith('gemini-') && !id.startsWith('deepseek-'));
      const geminiModels = modelIds.filter(id => id.startsWith('gemini-'));
      const deepseekModels = modelIds.filter(id => id.startsWith('deepseek-'));
      const firstModel = modelIds[0] || null;
      const standard = (configuredDefault && modelIds.includes(configuredDefault)) ? configuredDefault : firstModel;
      const light = anthropicModels[0] || deepseekModels[0] || geminiModels[0] || standard;
      return {
        light: light || null,
        standard: standard || null,
        gemini: geminiModels[0] || null,
        deepseek: deepseekModels[0] || null,
      };
    };

    const loadSettingsForUser = async (targetUserId) => {
      if (!targetUserId) return {};
      const { rows } = await pool.query(
        "SELECT key, value FROM settings WHERE \"userId\"=$1 AND key IN ('vault_models','default_model')",
        [targetUserId]
      );
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    };

    const loadFirstAdminSettings = async () => {
      const { rows } = await pool.query(
        `SELECT s."userId", s.key, s.value
         FROM settings s
         JOIN users u ON u.id = s."userId"
         WHERE u."isAdmin" = TRUE
           AND s.key IN ('vault_models','default_model')
         ORDER BY s."userId" ASC`
      );
      if (!rows.length) return {};
      const firstAdminId = rows[0].userId;
      const firstAdminRows = rows.filter(r => r.userId === firstAdminId);
      return Object.fromEntries(firstAdminRows.map(r => [r.key, r.value]));
    };

    const userConfig = await loadSettingsForUser(userId);
    const userModels = parseConfiguredModelIds(userConfig.vault_models);
    if (userModels.length > 0) {
      return pickTiers(userModels, userConfig.default_model || null);
    }

    const adminConfig = await loadFirstAdminSettings();
    const adminModels = parseConfiguredModelIds(adminConfig.vault_models);
    if (adminModels.length > 0) {
      return pickTiers(adminModels, adminConfig.default_model || null);
    }

    return { ...EMPTY_MODELS };
  } catch {
    return { ...EMPTY_MODELS };
  }
}

module.exports = { getModelsForUser };
