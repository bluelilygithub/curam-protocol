'use strict';

// Email Follow-Up: which model answers Summary and Ask. Chosen by the person in Settings -> Email Follow-Up, the same way as Topic Research:
// a model from the workspace's connected list (vault_models), or "use the default". NO model id is written in this code.
//
//   setting `email_follow_up_ask_model` (empty / unset = use the workspace default)
//   resolution: the person's own setting -> the first admin's setting -> the workspace `standard` model (then whatever text model exists)
//   a saved id that is no longer in the connected list is ignored (falls back), so removing a model never breaks the tool.
//
// Reading messages into the ledger (extract.js) is a separate, small job and keeps using the workspace `light` model.
// Everything outside is injectable so tests need no database.

const SETTINGS_KEY = 'email_follow_up_ask_model';

const clean = (v) => (v != null && String(v).trim() ? String(v).trim() : null);

function createModelResolver(deps = {}) {
  const d = {
    pool: deps.pool || (() => require('../../db').pool),
    getVaultModelsConfigForUser: deps.getVaultModelsConfigForUser || ((...a) => require('../modelResolver').getVaultModelsConfigForUser(...a)),
    getModelsForUser: deps.getModelsForUser || ((...a) => require('../modelResolver').getModelsForUser(...a)),
    pickTextModel: deps.pickTextModel || ((...a) => require('../modelResolver').pickTextModel(...a)),
  };
  const getPool = () => (typeof d.pool === 'function' ? d.pool() : d.pool);

  async function chosen(userId) {
    if (userId) {
      const own = await getPool().query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
      if (clean(own.rows[0]?.value)) return { modelId: clean(own.rows[0].value), fromAdmin: false };
    }
    const { rows } = await getPool().query(
      `SELECT s.value FROM settings s JOIN users u ON u.id::text = s."userId"::text WHERE u."isAdmin" = TRUE AND s.key = $1 ORDER BY s."userId" ASC LIMIT 1`,
      [SETTINGS_KEY],
    );
    return clean(rows[0]?.value) ? { modelId: clean(rows[0].value), fromAdmin: true } : { modelId: null, fromAdmin: false };
  }

  const inList = (models, id) => Array.isArray(models) && models.some((m) => String(m?.id).trim() === id);

  /** The model id that answers Summary and Ask for this person, or null when no model is set up at all. */
  async function resolveAskModel(userId) {
    const [{ models }, { modelId }] = await Promise.all([d.getVaultModelsConfigForUser(userId), chosen(userId)]);
    if (modelId && inList(models, modelId)) return modelId;
    return d.pickTextModel(await d.getModelsForUser(userId), 'standard');
  }

  /** What the Settings card needs: the saved choice (even a stale one), whether it is still valid, the list to choose from and the default. */
  async function getAskModelConfig(userId) {
    const [{ models }, { modelId, fromAdmin }] = await Promise.all([d.getVaultModelsConfigForUser(userId), chosen(userId)]);
    const fallback = d.pickTextModel(await d.getModelsForUser(userId), 'standard');
    const valid = !modelId || inList(models, modelId);
    return { settingsKey: SETTINGS_KEY, modelId: modelId || '', assignmentValid: valid, fromAdmin, globalStandard: fallback, effectiveModel: modelId && valid ? modelId : fallback, choices: models };
  }

  /** Save the person's choice, or clear it (empty) to use the default. Only a connected model is accepted. */
  async function saveAskModel(userId, modelId) {
    const id = clean(modelId);
    if (id) {
      const { models } = await d.getVaultModelsConfigForUser(userId);
      if (!inList(models, id)) throw Object.assign(new Error('Choose one of the models connected in Settings -> AI & Chat.'), { status: 400 });
      await getPool().query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
        [String(userId), SETTINGS_KEY, id],
      );
    } else {
      await getPool().query('DELETE FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), SETTINGS_KEY]);
    }
    return getAskModelConfig(userId);
  }

  return { resolveAskModel, getAskModelConfig, saveAskModel };
}

module.exports = { createModelResolver, SETTINGS_KEY, ...createModelResolver() };
