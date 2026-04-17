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
      "SELECT value FROM settings WHERE \"userId\"=$1 AND key='vault_models'",
      [userId]
    );
    if (rows[0]?.value) {
      const models = JSON.parse(rows[0].value);
      if (Array.isArray(models) && models.length > 0) {
        const anthropicModels = models.filter(m => m.id && !m.id.startsWith('gemini-') && !m.id.startsWith('deepseek-'));
        const geminiModels    = models.filter(m => m.id &&  m.id.startsWith('gemini-'));
        const deepseekModels  = models.filter(m => m.id &&  m.id.startsWith('deepseek-'));
        return {
          light:    anthropicModels[0]?.id || DEFAULTS.light,
          standard: anthropicModels[1]?.id || anthropicModels[0]?.id || DEFAULTS.standard,
          gemini:   geminiModels[0]?.id    || DEFAULTS.gemini,
          deepseek: deepseekModels[0]?.id  || DEFAULTS.deepseek,
        };
      }
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULTS };
}

module.exports = { getModelsForUser, DEFAULTS };
