'use strict';

const { pool } = require('../db');

const DEFAULTS = {
  light:    'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-6',
  gemini:   'gemini-2.0-flash',
  deepseek: 'deepseek-chat',
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
 * Falls back to built-in defaults when the user has no vault_models setting
 * or the query fails.
 */
async function getModelsForUser(userId) {
  if (!userId) return { ...DEFAULTS };
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE \"userId\"=$1 AND key IN ('vault_models','default_model')",
      [userId]
    );
    const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));

    let light    = DEFAULTS.light;
    let standard = DEFAULTS.standard;
    let gemini   = DEFAULTS.gemini;
    let deepseek = DEFAULTS.deepseek;

    if (byKey.vault_models) {
      const models = JSON.parse(byKey.vault_models);
      if (Array.isArray(models) && models.length > 0) {
        const anthropicModels = models.filter(m => m.id && !m.id.startsWith('gemini-') && !m.id.startsWith('deepseek-'));
        const geminiModels    = models.filter(m => m.id &&  m.id.startsWith('gemini-'));
        const deepseekModels  = models.filter(m => m.id &&  m.id.startsWith('deepseek-'));
        // Prefer Anthropic for light/standard, fall back to DeepSeek then Gemini
        light    = anthropicModels[0]?.id || deepseekModels[0]?.id || geminiModels[0]?.id || DEFAULTS.light;
        standard = anthropicModels[1]?.id || anthropicModels[0]?.id || deepseekModels[0]?.id || geminiModels[0]?.id || DEFAULTS.standard;
        gemini   = geminiModels[0]?.id    || DEFAULTS.gemini;
        deepseek = deepseekModels[0]?.id  || DEFAULTS.deepseek;
      }
    }

    if (byKey.default_model) standard = byKey.default_model;

    return { light, standard, gemini, deepseek };
  } catch { /* fall through to defaults */ }
  return { ...DEFAULTS };
}

module.exports = { getModelsForUser, DEFAULTS };
